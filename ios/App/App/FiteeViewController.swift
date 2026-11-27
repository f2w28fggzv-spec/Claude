import UIKit
import WebKit
import Capacitor

/// The app's bridge view controller: Capacitor's own, with the content rules on its web view (FiteeContentRules.swift),
/// the bridge gate on every way out of the page (FiteeBridgeGate, below: Capacitor's message handler, its UI delegate
/// and its navigations), fitee's plugin (FiteeNativePlugin.swift), AirPlay off and the launch colour behind the page.
/// SceneDelegate.swift makes it once the rules have compiled.
final class FiteeViewController: CAPBridgeViewController {
    /// The compiled content rules, or nil if they didn't compile.
    var contentRules: WKContentRuleList?
    /// The web view's UI delegate (FiteeUIDelegate, below), held here: WKWebView keeps its uiDelegate weakly.
    private var pageUIDelegate: FiteeUIDelegate?

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
        var gated = false
        if let capacitor = bridge as? CapacitorBridge {
            let handler = capacitor.webViewDelegationHandler
            if let rules = contentRules {
                handler.contentController.add(rules)
                FiteeContentRules.installed = true
            }
            // The bridge gate (FiteeBridgeGate, below), on all three ways out: the "bridge" message handler, the UI
            // delegate, which loadView made Capacitor's handler before this runs (prepareWebView,
            // CAPBridgeViewController.swift:44-53, 320), and navigations (FiteeNativePlugin.shouldOverrideLoad,
            // registered below).
            FiteeBridgeGate.install(in: handler.contentController, forwardingTo: handler)
            let ui = FiteeUIDelegate(forwardingTo: handler)
            webView?.uiDelegate = ui
            pageUIDelegate = ui
            gated = true
        }
        bridge?.registerPluginInstance(FiteeNativePlugin())
        FiteeBridgeGate.installed = gated && FiteeUIDelegate.isWired(webView) && bridge?.plugin(withName: "FiteeNative") is FiteeNativePlugin
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

/// The bridge gate: of Capacitor's native code the page reaches only fitee's own plugin, console logging, the status bar
/// style and the web view's own dialogs and permissions (alert, confirm, the camera), and it never leaves the app. A
/// page has three ways to native code, all of them Capacitor's WebViewDelegationHandler, and the gate stands in each:
///   1. Messages. native-bridge.js posts every plugin call to the "bridge" script message handler
///      (webkit.messageHandlers.bridge.postMessage), and Capacitor calls any plugin the message names, loading a plugin
///      class by name if none is registered under it (CapacitorBridge.swift:499-509): so a page could reach Capacitor's
///      HTTP plugin (a native URLSession request that no other guard sees), its cookie plugin or its web view plugin
///      (which can point the web view at another folder) under one of their class names. FiteeBridgeGate (this class)
///      replaces that handler, the same way Capacitor added it, and passes on to Capacitor's own handler
///      (userContentController(_:didReceive:) is open: WebViewDelegationHandler.swift:192) only:
///        - type "message" (native-bridge.js sets it when a call has none, :844) to a plugin in `allowedPlugins`:
///          FiteeNative (src/native/bridge.ts), Console (native-bridge.js sends every console call there, :771-788;
///          only Debug builds print them) and SystemBars (the page sets the status bar text, src/native/statusBar.ts);
///        - type "js.error" (native-bridge.js's window.onerror in Debug builds, :852-874; printed, never answered).
///      native-bridge.js 8.6.3 calls no other plugin by itself: App (navigator.app.exitApp, a "backbutton" listener)
///      and WebView (Ionic.WebView.*) only when the page calls them (:247-315; fitee doesn't), and CapacitorHttp only
///      when it's enabled (it's off: capacitor.config.ts); none of those, and nothing that can make a request, set
///      cookies or change the server path, is ever let through. Everything else is dropped ("cordova" included) and
///      gets no answer; a Debug build prints "fitee:dropped <type> <pluginId>.<method>" for each.
///   2. Prompts and new windows: the web view's UI delegate. Capacitor's reads a prompt() whose text is
///      {"type": "CapacitorCookies.get" or ".set"} as a cookie request whatever CapacitorCookies.enabled says (a cookie
///      for any domain, in HTTPCookieStorage.shared and the web view's store: WebViewDelegationHandler.swift:271-293),
///      and hands a window.open's URL to iOS, which opens Safari (:324-329). FiteeUIDelegate (below) takes its place:
///      every prompt is answered with nothing, and no window opens.
///   3. Navigations: Capacitor hands a top-level navigation to a URL outside the app to iOS too (:107-121), but asks
///      every plugin first (:83-99), and FiteeNativePlugin.shouldOverrideLoad cancels every navigation that isn't to
///      capacitor://localhost, the app's own pages.
/// AppInfo.gate is true once all three are in place; the self-test's gate step tries each (src/native/bridge.ts).
final class FiteeBridgeGate: NSObject, WKScriptMessageHandler {
    /// GATE_ALLOWED in src/native/bridge.ts.
    static let allowedPlugins: Set<String> = ["FiteeNative", "Console", "SystemBars"]
    /// Capacitor's handler name (WebViewDelegationHandler.swift:18).
    static let handlerName = "bridge"
    /// True once the gate is in place on all three ways out (capacitorDidLoad): AppInfo.gate. Written and read on the main
    /// queue only.
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

/// The web view's UI delegate, in place of Capacitor's WebViewDelegationHandler (the bridge gate's second part, above):
/// it answers every prompt() with nothing (fitee never calls prompt(); Capacitor's handler would read one as a cookie
/// request), opens no window (no webView(_:createWebViewWith:for:windowFeatures:), so WebKit gets none, where
/// Capacitor's would hand the URL to iOS), and passes everything else Capacitor's handler answers on to it, as it
/// would have answered: alert(), confirm() (fitee asks before every delete with it), the camera's permission (granted
/// there, so only iOS asks the person) and motion's. The signatures are Capacitor's own
/// (WebViewDelegationHandler.swift:50-65, 234-269), which the same compiler takes as WKUIDelegate's.
final class FiteeUIDelegate: NSObject, WKUIDelegate {
    private weak var capacitor: WebViewDelegationHandler?

    init(forwardingTo capacitor: WebViewDelegationHandler) {
        self.capacitor = capacitor
        super.init()
    }

    /// The Objective-C selectors of what this delegate answers, and of the one it mustn't (a new window).
    static let answered = [
        "webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:",
        "webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:",
        "webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:",
        "webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:",
        "webView:requestDeviceOrientationAndMotionPermissionForOrigin:initiatedByFrame:decisionHandler:"
    ]
    static let newWindow = "webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:"

    /// Whether the web view's UI delegate is this one, answering exactly what it should: a method whose signature didn't
    /// match WKUIDelegate's would be left out without a word (confirm() would then always answer false), so this is
    /// checked at run time, for AppInfo.gate.
    static func isWired(_ webView: WKWebView?) -> Bool {
        guard let delegate = webView?.uiDelegate as? FiteeUIDelegate else { return false }
        return answered.allSatisfy { delegate.responds(to: NSSelectorFromString($0)) }
            && !delegate.responds(to: NSSelectorFromString(newWindow))
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard let capacitor = capacitor else {
            completionHandler()
            return
        }
        capacitor.webView(webView, runJavaScriptAlertPanelWithMessage: message, initiatedByFrame: frame, completionHandler: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let capacitor = capacitor else {
            completionHandler(false)
            return
        }
        capacitor.webView(webView, runJavaScriptConfirmPanelWithMessage: message, initiatedByFrame: frame, completionHandler: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        completionHandler(nil)
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        guard let capacitor = capacitor else {
            decisionHandler(.prompt)
            return
        }
        capacitor.webView(webView, requestMediaCapturePermissionFor: origin, initiatedByFrame: frame, type: type, decisionHandler: decisionHandler)
    }

    func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        guard let capacitor = capacitor else {
            decisionHandler(.prompt)
            return
        }
        capacitor.webView(webView, requestDeviceOrientationAndMotionPermissionFor: origin, initiatedByFrame: frame, decisionHandler: decisionHandler)
    }
}
