import UIKit
import WebKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // iOS's copies of videos picked for a technique check or filmed with Take Video (WebKit's file panel puts them
        // in tmp/ and would keep them until the web view goes away, which a killed app never reaches) are deleted
        // before anything else starts, while no web view exists that could still be reading one.
        FiteeFiles.empty(FileManager.default.temporaryDirectory, keeping: nil)

        // The window is built in code (Info.plist names no storyboard: one would make a second, unconfigured bridge
        // view controller). Until the bridge view controller is made, a placeholder shows the launch colour.
        let window = UIWindow(windowScene: windowScene)
        let page = UIColor(named: "LaunchBackground")
        window.backgroundColor = page
        let placeholder = UIViewController()
        placeholder.view.backgroundColor = page
        window.rootViewController = placeholder
        window.makeKeyAndVisible()
        self.window = window

        // The content rules must be on the web view before its first request (FiteeContentRules.swift), so the bridge
        // view controller is made once they've compiled: a few milliseconds of the launch colour.
        FiteeContentRules.compile { rules in
            let bridge = FiteeViewController()
            bridge.contentRules = rules
            window.rootViewController = bridge
        }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
