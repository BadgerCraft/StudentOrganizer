import Capacitor

/// `CapacitorHttp.enabled = false` disables fetch patching, but does not disable
/// direct bridge calls. Replace the built-in plugin before any page is loaded.
@objc(LocalOnlyHttpPlugin)
public final class LocalOnlyHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocalOnlyHttpPlugin"
    public let jsName = "CapacitorHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "post", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "put", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "patch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "delete", returnType: CAPPluginReturnPromise)
    ]
    private func deny(_ call: CAPPluginCall) { call.reject("External connections are disabled in the local iPad pilot.") }
    @objc func request(_ call: CAPPluginCall) { deny(call) }
    @objc func get(_ call: CAPPluginCall) { deny(call) }
    @objc func post(_ call: CAPPluginCall) { deny(call) }
    @objc func put(_ call: CAPPluginCall) { deny(call) }
    @objc func patch(_ call: CAPPluginCall) { deny(call) }
    @objc func delete(_ call: CAPPluginCall) { deny(call) }
}

/// Updates must replace the signed bundled app, never swap its web asset path.
@objc(BundledOnlyWebViewPlugin)
public final class BundledOnlyWebViewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BundledOnlyWebViewPlugin"
    public let jsName = "WebView"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setServerAssetPath", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setServerBasePath", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "persistServerBasePath", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getServerBasePath", returnType: CAPPluginReturnPromise)
    ]
    private func deny(_ call: CAPPluginCall) { call.reject("The local iPad pilot only loads its signed bundled assets.") }
    @objc func setServerAssetPath(_ call: CAPPluginCall) { deny(call) }
    @objc func setServerBasePath(_ call: CAPPluginCall) { deny(call) }
    @objc func persistServerBasePath(_ call: CAPPluginCall) { deny(call) }
    @objc func getServerBasePath(_ call: CAPPluginCall) {
        guard let controller = bridge?.viewController as? CAPBridgeViewController else {
            call.reject("The bundled application is unavailable.")
            return
        }
        call.resolve(["path": controller.getServerBasePath()])
    }
}
