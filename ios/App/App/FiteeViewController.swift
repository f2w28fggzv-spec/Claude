import UIKit
import WebKit
import Capacitor

/// The app's bridge view controller: Capacitor's own, with the content rules on its web view (FiteeContentRules.swift),
/// the bridge gate in front of Capacitor's message handler (FiteeBridgeGate, below), fitee's plugin
/// (FiteeNativePlugin.swift), AirPlay off and the launch colour behind the page. SceneDelegate.swift makes it once
/// the rules have compiled.
final class FiteeViewController: CAPBridgeViewController {
    /// The compiled content rules, or nil if they didn't compile.
    var contentRules: WKContentRuleList?

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        // Capacitor turns AirPlay on (CAPBridgeViewController.swift:124): a saved set's video never goes to another screen.
        configuration.allowsAirPlayForMediaPlayback = false
        return configuration
    }

    override func capacitorDidLoad() {
        // Called from loadView once the web view and the bridge exist, before viewDidLoad loads the page
        // (CAPBridgeViewController.swift:30-58, 60-62). Capacitor gave the web view its own user content controller
        // after webViewConfiguration(for:) (:296-298) and keeps adding the page's scripts to it once the web view exists
        // (CapacitorBridge.swift:249-255, 394), so that controller is the web view's live one: rules added to the
        // configuration earlier would have been lost.
        if let capacitor = bridge as? CapacitorBridge {
            let handler = capacitor.webViewDelegationHandler
            if let rules = contentRules {
                handler.contentController.add(rules)
                FiteeContentRules.installed = true
            }
            FiteeBridgeGate.install(in: handler.contentController, forwardingTo: handler)
        }
        bridge?.registerPluginInstance(FiteeNativePlugin())
        // The view is the web view (loadView: view = webView). Until the page paints, the launch colour shows.
        let page = UIColor(named: "LaunchBackground")
        webView?.isOpaque = false
        webView?.backgroundColor = page
        webView?.scrollView.backgroundColor = page
    }

    #if DEBUG
    /// SystemBars ends here (CapacitorBridge.swift:75-84, Plugins/SystemBars.swift:74-89). CI reads the last line.
    override func setStatusBarStyle(_ statusBarStyle: UIStatusBarStyle) {
        super.setStatusBarStyle(statusBarStyle)
        let text: String
        switch statusBarStyle {
        case .lightContent:
            text = "light-text"
        case .darkContent:
            text = "dark-text"
        default:
            text = "default"
        }
        print("fitee:statusbar " + text)
    }

    private var probed = false

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !probed, FiteeNativePlugin.isSelfTest else { return }
        probed = true
        FiteeContentRules.probe(rules: contentRules, url: FiteeContentRules.probeURL()) { line in
            print(line)
        }
    }
    #endif
}

/// The bridge gate. The page reaches native code only by posting to the "bridge" script message handler
/// (native-bridge.js: webkit.messageHandlers.bridge.postMessage), which Capacitor's WebViewDelegationHandler answers.
/// Capacitor calls any plugin the message names, and loads a plugin class by name if none is registered under it
/// (CapacitorBridge.swift:499-509), so a page could reach Capacitor's HTTP plugin (a native URLSession request that no
/// other guard sees), its cookie plugin or its web view plugin (which can point the web view at another folder) under
/// one of their class names. The gate replaces Capacitor's handler, the same way Capacitor added it, and passes on to
/// Capacitor's own handler (userContentController(_:didReceive:) is open: WebViewDelegationHandler.swift:192) only:
///   - type "message" (native-bridge.js sets it when a call has none, :844) to a plugin in `allowedPlugins`:
///     FiteeNative (src/native/bridge.ts), Console (native-bridge.js sends every console call there, :771-788; only
///     Debug builds print them) and SystemBars (the page sets the status bar text, src/native/statusBar.ts);
///   - type "js.error" (native-bridge.js's window.onerror in Debug builds, :852-874; printed, never answered).
/// native-bridge.js 8.6.3 calls no other plugin by itself: App (navigator.app.exitApp, a "backbutton" listener) and
/// WebView (Ionic.WebView.*) only when the page calls them (:247-315; fitee doesn't), and CapacitorHttp only when it's
/// enabled (it's off: capacitor.config.ts); none of those, and nothing that can make a request, set cookies or change
/// the server path, is ever let through. Everything else is dropped ("cordova" included) and gets no answer; a Debug
/// build prints "fitee:dropped <type> <pluginId>.<method>" for each.
final class FiteeBridgeGate: NSObject, WKScriptMessageHandler {
    /// GATE_ALLOWED in src/native/bridge.ts.
    static let allowedPlugins: Set<String> = ["FiteeNative", "Console", "SystemBars"]
    /// Capacitor's handler name (WebViewDelegationHandler.swift:18).
    static let handlerName = "bridge"
    /// True once the gate is in place (AppInfo.gate). Written and read on the main queue only.
    static var installed = false

    private weak var capacitor: WebViewDelegationHandler?

    private init(forwardingTo capacitor: WebViewDelegationHandler) {
        self.capacitor = capacitor
        super.init()
    }

    /// Takes Capacitor's handler off the controller and puts the gate in its place. Capacitor added its handler with
    /// add(_:name:) (WebViewDelegationHandler.swift:22), which is the page's content world, so it comes off with
    /// removeScriptMessageHandler(forName:) and the gate goes on with add(_:name:), in that same world.
    static func install(in controller: WKUserContentController, forwardingTo capacitor: WebViewDelegationHandler) {
        controller.removeScriptMessageHandler(forName: handlerName)
        controller.add(FiteeBridgeGate(forwardingTo: capacitor), name: handlerName)
        installed = true
    }

    /// Whether a message's body may go on to Capacitor.
    static func allows(_ body: Any) -> Bool {
        guard let message = body as? [String: Any], let type = message["type"] as? String else { return false }
        if type == "js.error" { return true }
        guard type == "message", let pluginId = message["pluginId"] as? String else { return false }
        return allowedPlugins.contains(pluginId)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard FiteeBridgeGate.allows(message.body) else {
            #if DEBUG
            print(FiteeBridgeGate.droppedLine(message.body))
            #endif
            return
        }
        capacitor?.userContentController(userContentController, didReceive: message)
    }

    #if DEBUG
    /// "fitee:dropped <type> <pluginId>.<method>" (for "cordova": service and action); a missing value is "-".
    static func droppedLine(_ body: Any) -> String {
        guard let message = body as? [String: Any] else { return "fitee:dropped - -.-" }
        func field(_ key: String) -> String {
            guard let value = message[key] as? String, !value.isEmpty else { return "-" }
            return value
        }
        let type = field("type")
        let cordova = type == "cordova"
        return "fitee:dropped \(type) \(field(cordova ? "service" : "pluginId")).\(field(cordova ? "action" : "methodName"))"
    }
    #endif
}
