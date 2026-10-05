import Capacitor
import WebKit

/// Deny network subresources before the first bundled page is loaded.
final class PilotViewController: CAPBridgeViewController {
    private var guardedUI: LocalOnlyUIDelegate?

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(FilesPlugin())
        bridge?.registerPluginInstance(LocalOnlyHttpPlugin())
        bridge?.registerPluginInstance(BundledOnlyWebViewPlugin())
        bridge?.registerPluginInstance(LocalNavigationPlugin())
        if let original = webView?.uiDelegate {
            guardedUI = LocalOnlyUIDelegate(original: original)
            webView?.uiDelegate = guardedUI
        }
    }

    override func viewDidLoad() {
        let rules = #"[{"trigger":{"url-filter":"^(https?|wss?)://"},"action":{"type":"block"}}]"#
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "LocalOnlyPilot-v1", encodedContentRuleList: rules) { [weak self] rules, error in
            DispatchQueue.main.async {
                guard let self else { return }
                guard let rules, error == nil else {
                    // Fail closed: never load the application without its network guard.
                    let message = UILabel()
                    message.text = "The app could not start safely. Close and reopen it. Your local records have not been changed."
                    message.numberOfLines = 0
                    message.textAlignment = .center
                    message.frame = self.view.bounds.insetBy(dx: 24, dy: 24)
                    message.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                    self.view.addSubview(message)
                    return
                }
                self.webView?.configuration.userContentController.add(rules)
                self.loadProtectedApp()
            }
        }
    }

    private func loadProtectedApp() { super.viewDidLoad() }
}

@objc(LocalNavigationPlugin)
final class LocalNavigationPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "LocalNavigationPlugin"
    let jsName = "LocalNavigation"
    let pluginMethods: [CAPPluginMethod] = []
    override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url else { return NSNumber(value: true) }
        // Exact stable origin only; also deny Capacitor's remote HTTP proxy route.
        return NSNumber(value: url.scheme != "capacitor" || url.host != "localhost" || url.path.hasPrefix("/_capacitor_http_interceptor_"))
    }
}

/// Keep Capacitor's alerts/prompts, but never hand new windows to UIApplication.open.
private final class LocalOnlyUIDelegate: NSObject, WKUIDelegate {
    private let original: WKUIDelegate
    init(original: WKUIDelegate) { self.original = original }
    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || (original as? NSObject)?.responds(to: selector) == true
    }
    override func forwardingTarget(for selector: Selector!) -> Any? { original }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
}
