import UIKit
import WebKit
import Capacitor

/// FiteeNative, the page's one plugin. src/native/bridge.ts is the contract: method names, arguments, results and
/// error codes; change the two together. Registered by FiteeViewController.capacitorDidLoad (registerPluginInstance:
/// CapacitorBridge.swift:378-395); the bridge gate lets the page reach it by its JS name only.
///
/// Capacitor calls every method on its bridge queue, one at a time in the order sent (CapacitorBridge.swift:133,
/// 535-560), so a video's chunks arrive in order; file work runs there (FiteeFiles.swift), UIKit work hops to the main
/// queue. A method answers with call.resolve (a dictionary: an empty one is {} in the page, while resolve() with no
/// argument would be undefined) or call.reject(message, code) (CAPPluginCall.swift:37-47).
@objc(FiteeNativePlugin)
public class FiteeNativePlugin: CAPPlugin, CAPBridgedPlugin {
    // CAPBridgedPlugin (CAPBridgedPlugin.h:16-20); each method's selector is "<name>:" (CAPPluginMethod.m:27-31).
    public let identifier = "FiteeNativePlugin"
    public let jsName = "FiteeNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "appInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAppearance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearPickedFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dropSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readSetFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeSetFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "renameSetFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeSetFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listSetFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginVideo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendVideo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishVideo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abortVideo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "videoUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteAllData", returnType: CAPPluginReturnPromise)
    ]

    /// SELF_TEST_ARG: a Debug build launched with it runs the page's self-test and the rules probe.
    static let selfTestArgument = "-fiteeSelfTest"
    /// PROBE_URL_ARG: followed by the URL the rules probe fetches.
    static let probeURLArgument = "-fiteeProbeURL"

    #if DEBUG
    static let isDebugBuild = true
    static let isSelfTest = ProcessInfo.processInfo.arguments.contains(selfTestArgument)
    #else
    static let isDebugBuild = false
    static let isSelfTest = false
    #endif

    private let files = FiteeFiles()
    private var observers: [NSObjectProtocol] = []
    /// Main queue only: the background task held after going to the background.
    private var backgroundTask = UIBackgroundTaskIdentifier.invalid
    /// Main queue only: the open Save to Files panel's delegate.
    private var exportPanel: FiteeExportPanel?

    override public func load() {
        // Going to the background: the screen may sleep again, and a 5 s background task lets the copy of the log that
        // the page writes on visibilitychange (src/native/snapshot.ts) finish. Capacitor observes the scene's
        // notification (CapacitorBridge.swift:280); the app's comes too, and either is enough.
        let center = NotificationCenter.default
        for name in [UIScene.didEnterBackgroundNotification, UIApplication.didEnterBackgroundNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.wentToBackground()
            })
        }
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    /// Main queue.
    private func wentToBackground() {
        UIApplication.shared.isIdleTimerDisabled = false
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "fitee: save a copy of your data") { [weak self] in
            self?.endBackgroundTask()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            self?.endBackgroundTask()
        }
    }

    /// Main queue.
    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    /// Runs file work here, on the bridge queue, and answers the call with its result or a rejection whose code is a
    /// NativeErrorCode (FiteeFiles.Failure).
    private func answer(_ call: CAPPluginCall, _ work: () throws -> PluginCallResultData) {
        let result: PluginCallResultData
        do {
            result = try work()
        } catch {
            let failure = FiteeFiles.Failure.from(error)
            call.reject(failure.message, failure.code)
            return
        }
        call.resolve(result)
    }

    // MARK: - App

    @objc func appInfo(_ call: CAPPluginCall) {
        let info = Bundle.main.infoDictionary ?? [:]
        let version = info["CFBundleShortVersionString"] as? String ?? ""
        let build = info["CFBundleVersion"] as? String ?? ""
        DispatchQueue.main.async {
            // Every page load calls this first: a page that reloaded after its web process died can't have left the
            // screen kept awake.
            UIApplication.shared.isIdleTimerDisabled = false
            call.resolve([
                "version": version,
                "build": build,
                "debug": FiteeNativePlugin.isDebugBuild,
                "selfTest": FiteeNativePlugin.isSelfTest,
                "rules": FiteeContentRules.installed,
                "gate": FiteeBridgeGate.installed
            ])
        }
    }

    @objc func setKeepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve([:])
        }
    }

    @objc func setAppearance(_ call: CAPPluginCall) {
        let styles: [String: UIUserInterfaceStyle] = ["light": .light, "dark": .dark, "system": .unspecified]
        guard let name = call.getString("style"), let style = styles[name] else {
            call.reject("The style must be light, dark or system.", "BAD_DATA")
            return
        }
        let bridge = self.bridge
        DispatchQueue.main.async {
            // What iOS draws over the page (confirm() alerts, Save to Files, the file picker) follows the window.
            bridge?.viewController?.view.window?.overrideUserInterfaceStyle = style
            call.resolve([:])
        }
    }

    // MARK: - Save to Files

    @objc func exportFile(_ call: CAPPluginCall) {
        let store = files
        let file: URL
        do {
            file = try store.openExport(call.getString("name"), call.getString("text"))
        } catch {
            let failure = FiteeFiles.Failure.from(error)
            call.reject(failure.message, failure.code)
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let presenter = self.bridge?.viewController, presenter.view.window != nil else {
                store.closeExport(file)
                call.reject("There's nothing to show Save to Files from.", "UNAVAILABLE")
                return
            }
            guard self.exportPanel == nil, presenter.presentedViewController == nil else {
                store.closeExport(file)
                call.reject("Another panel is open.", "EXPORT_FAILED")
                return
            }
            // Save to Files (iOS 14+): the person picks the place and the file is copied there, as with a download
            // in a browser; the copy in tmp/fitee-export/ goes when the panel closes.
            let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
            let panel = FiteeExportPanel { [weak self] saved in
                self?.exportPanel = nil
                store.closeExport(file)
                call.resolve(["saved": saved])
            }
            picker.delegate = panel
            picker.presentationController?.delegate = panel
            self.exportPanel = panel
            presenter.present(picker, animated: true)
        }
    }

    @objc func clearPickedFiles(_ call: CAPPluginCall) {
        files.clearPickedFiles()
        call.resolve([:])
    }

    // MARK: - The copy of the log

    @objc func readSnapshot(_ call: CAPPluginCall) {
        answer(call) {
            return try files.readSnapshot()
        }
    }

    @objc func writeSnapshot(_ call: CAPPluginCall) {
        answer(call) {
            let bytes = try files.writeSnapshot(call.getString("text"))
            return ["bytes": bytes]
        }
    }

    @objc func dropSnapshot(_ call: CAPPluginCall) {
        answer(call) {
            try files.dropSnapshot()
            return [:]
        }
    }

    // MARK: - Saved sets

    @objc func readSetFile(_ call: CAPPluginCall) {
        answer(call) {
            guard let text = try files.readSetFile(call.getString("name")) else { return [:] }
            return ["text": text]
        }
    }

    @objc func writeSetFile(_ call: CAPPluginCall) {
        answer(call) {
            try files.writeSetFile(call.getString("name"), call.getString("text"))
            return [:]
        }
    }

    @objc func renameSetFile(_ call: CAPPluginCall) {
        answer(call) {
            try files.renameSetFile(call.getString("from"), call.getString("to"))
            return [:]
        }
    }

    @objc func removeSetFiles(_ call: CAPPluginCall) {
        answer(call) {
            try files.removeSetFiles(call.getArray("names", String.self))
            return [:]
        }
    }

    @objc func listSetFiles(_ call: CAPPluginCall) {
        answer(call) {
            let list = try files.listSetFiles()
            return ["files": list.files, "folderExcluded": list.folderExcluded]
        }
    }

    @objc func beginVideo(_ call: CAPPluginCall) {
        answer(call) {
            let chunk = try files.beginVideo(id: call.getString("id"), ext: call.getString("ext"), bytes: call.getInt("bytes"))
            return ["chunk": chunk]
        }
    }

    @objc func appendVideo(_ call: CAPPluginCall) {
        answer(call) {
            let length = try files.appendVideo(id: call.getString("id"), ext: call.getString("ext"),
                                               offset: call.getInt("offset"), data: call.getString("data"))
            return ["length": length]
        }
    }

    @objc func finishVideo(_ call: CAPPluginCall) {
        answer(call) {
            let bytes = try files.finishVideo(id: call.getString("id"), ext: call.getString("ext"), bytes: call.getInt("bytes"))
            return ["bytes": bytes]
        }
    }

    @objc func abortVideo(_ call: CAPPluginCall) {
        answer(call) {
            try files.abortVideo(id: call.getString("id"), ext: call.getString("ext"))
            return [:]
        }
    }

    @objc func videoUrl(_ call: CAPPluginCall) {
        answer(call) {
            let file = try files.videoFile(call.getString("name"))
            // capacitor://localhost/_capacitor_file_/<absolute path> (CapacitorBridge.swift:762-768), served by
            // Capacitor's own handler, Range requests included (WebViewAssetHandler.swift:71-89).
            guard let url = bridge?.portablePath(fromLocalURL: file) else {
                throw FiteeFiles.Failure(code: "UNAVAILABLE", message: "The bridge isn't ready.")
            }
            return ["url": url.absoluteString]
        }
    }

    // MARK: - Everything

    @objc func deleteAllData(_ call: CAPPluginCall) {
        do {
            try files.deleteAll()
        } catch {
            let failure = FiteeFiles.Failure.from(error)
            call.reject(failure.message, failure.code)
            return
        }
        DispatchQueue.main.async {
            // Then the web view's own stores (localStorage, IndexedDB and the rest), which are SQLite files that could
            // keep deleted rows in their free pages; the page reloads to the Welcome screen once this answers.
            let store = WKWebsiteDataStore.default()
            store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: Date.distantPast) {
                call.resolve([:])
            }
        }
    }
}

/// The Save to Files panel's delegate: answers once, whether the person saved the file or cancelled (with the panel's
/// Cancel button or by swiping it away).
final class FiteeExportPanel: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    private var done: ((Bool) -> Void)?

    init(_ done: @escaping (Bool) -> Void) {
        self.done = done
        super.init()
    }

    private func finish(saved: Bool) {
        guard let done = done else { return }
        self.done = nil
        done(saved)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finish(saved: true)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finish(saved: false)
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        finish(saved: false)
    }
}
