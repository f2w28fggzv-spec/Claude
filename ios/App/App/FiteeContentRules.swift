import Foundation
import WebKit

/// The third network guard, with src/privacy.ts and the page's CSP, in place of the web app's service worker (a
/// WKWebView doesn't run one): a content blocker on the app's web view that blocks every load but the app's own files
/// and the blob: and data: URLs the page makes itself.
enum FiteeContentRules {
    static let identifier = "fitee-own-files-only"

    /// No trailing slash in the second filter: the first page Capacitor loads is capacitor://localhost itself
    /// (CAPInstanceConfiguration.m:45-50, CAPInstanceConfiguration.swift:11-15), and a URL with a non-special scheme
    /// keeps an empty path, so "^capacitor://localhost/" would block the app's own page. Content-blocker regexes have no
    /// alternation (|), hence one rule per allowed prefix. Every capacitor: URL is answered inside the app by Capacitor's
    /// scheme handler, never the network (its HTTP proxy route is off: capacitor.config.ts). WebKit leaves only data:
    /// URLs out of content blocking (ContentExtensionsBackend.cpp:175-178), so the capacitor: and blob: rules are needed.
    static let json = """
    [
      {"trigger": {"url-filter": ".*"}, "action": {"type": "block"}},
      {"trigger": {"url-filter": "^capacitor://localhost"}, "action": {"type": "ignore-previous-rules"}},
      {"trigger": {"url-filter": "^blob:"}, "action": {"type": "ignore-previous-rules"}},
      {"trigger": {"url-filter": "^data:"}, "action": {"type": "ignore-previous-rules"}}
    ]
    """

    /// True once the rules are on the app's web view (FiteeViewController.capacitorDidLoad). Written and read on the
    /// main queue only (appInfo reads it there).
    static var installed = false

    /// Compiled at every launch, in milliseconds, before the bridge view controller exists (SceneDelegate.swift): the
    /// rules must be on the web view before its first request. `done` runs on the main queue with nil if they didn't
    /// compile (the store writes to disk, so a full one can refuse): the app then starts guarded by its own code and
    /// its CSP, as a browser without the service worker would be.
    static func compile(_ done: @escaping (WKContentRuleList?) -> Void) {
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: json) { list, error in
            #if DEBUG
            if let error = error {
                print("fitee: content rules didn't compile: \(error)")
            }
            #endif
            DispatchQueue.main.async {
                done(list)
            }
        }
    }

    #if DEBUG
    /// CI only (a Debug build launched with -fiteeSelfTest): fetches `url`, the address after -fiteeProbeURL (a loopback
    /// server the CI job runs, never another site), from a blank page in throwaway web views with a non-persistent data
    /// store, first with the app's rules and then without, and reports both as one line:
    /// fitee:rules {"url":…,"withRules":…,"withoutRules":…} (RulesMarker in src/native/bridge.ts). CI requires "blocked"
    /// with the rules; "loaded" without them shows the probe can tell the difference. The URL should name the host
    /// localhost, not 127.0.0.1: since iOS 17, App Transport Security refuses plain-HTTP loads from IP addresses unless
    /// the app lists them, and it allows unqualified hosts such as localhost (Apple: NSAllowsLocalNetworking), so with
    /// an IP address the probe without the rules would read "blocked" too.
    static func probe(rules: WKContentRuleList?, url: String?, report: @escaping (String) -> Void) {
        let url = url ?? ""
        guard !url.isEmpty else {
            report(marker(url: "", withRules: "failed: no probe URL", withoutRules: "failed: no probe URL"))
            return
        }
        let thenWithout = { (first: String) in
            ProbePage(rules: nil).fetch(url) { second in
                report(marker(url: url, withRules: first, withoutRules: second))
            }
        }
        if let rules = rules {
            ProbePage(rules: rules).fetch(url, thenWithout)
        } else {
            thenWithout("failed: the rules didn't compile")
        }
    }

    /// The argument after PROBE_URL_ARG among the launch arguments, if there is one.
    static func probeURL() -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let at = arguments.firstIndex(of: FiteeNativePlugin.probeURLArgument), at + 1 < arguments.count else { return nil }
        return arguments[at + 1]
    }

    static func marker(url: String, withRules: String, withoutRules: String) -> String {
        let fields = ["url": url, "withRules": withRules, "withoutRules": withoutRules]
        let data = (try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data("{}".utf8)
        return "fitee:rules " + (String(data: data, encoding: .utf8) ?? "{}")
    }

    /// One throwaway web view: loads a blank page, then fetches the URL from it. Keeps itself alive until it answers.
    /// The page is a data: URL, the one kind of URL content blockers never act on (ContentExtensionsBackend.cpp:175-178),
    /// so the rules' ".*" can't block the page itself (as it could an about:blank from loadHTMLString), only the fetch.
    private final class ProbePage: NSObject, WKNavigationDelegate {
        private static let blankPage = "data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Ctitle%3Eprobe%3C%2Ftitle%3E"
        private let webView: WKWebView
        private var url = ""
        private var done: ((String) -> Void)?
        private var keepAlive: ProbePage?

        init(rules: WKContentRuleList?) {
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = WKWebsiteDataStore.nonPersistent()
            if let rules = rules {
                configuration.userContentController.add(rules)
            }
            webView = WKWebView(frame: .zero, configuration: configuration)
            super.init()
            webView.navigationDelegate = self
        }

        func fetch(_ url: String, _ done: @escaping (String) -> Void) {
            self.url = url
            self.done = done
            keepAlive = self
            guard let page = URL(string: ProbePage.blankPage) else {
                finish("failed: the probe page's URL")
                return
            }
            webView.load(URLRequest(url: page))
            DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
                self?.finish("failed: no answer in 30 s")
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            let body = """
            const late = new Promise((resolve) => setTimeout(() => resolve('failed: no answer in 10 s'), 10000));
            const attempt = fetch(url, { mode: 'no-cors', cache: 'no-store' }).then(() => 'loaded', () => 'blocked');
            return await Promise.race([attempt, late]);
            """
            webView.callAsyncJavaScript(body, arguments: ["url": url], in: nil, in: .page) { [weak self] result in
                switch result {
                case .success(let value):
                    self?.finish(value as? String ?? "failed: the page answered \(value)")
                case .failure(let error):
                    self?.finish("failed: \(error.localizedDescription)")
                }
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            finish("failed: \(error.localizedDescription)")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            finish("failed: \(error.localizedDescription)")
        }

        private func finish(_ result: String) {
            guard let done = done else { return }
            self.done = nil
            done(result)
            // Let go of itself after this call has returned (WebKit holds its navigation delegate weakly).
            DispatchQueue.main.async {
                self.keepAlive = nil
            }
        }
    }
    #endif
}
