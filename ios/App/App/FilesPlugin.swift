import Capacitor
import UniformTypeIdentifiers
import UIKit

/// Deliberate Files access only: no cloud APIs, background uploads, or database writes.
@objc(FilesPlugin)
public class FilesPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FilesPlugin"
    public let jsName = "StudentOrganizerFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "exportBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importBackup", returnType: CAPPluginReturnPromise)
    ]
    private var pendingCall: CAPPluginCall?
    private var exportURL: URL?

    @objc func exportBackup(_ call: CAPPluginCall) {
        guard let filename = call.getString("filename"), filename == URL(fileURLWithPath: filename).lastPathComponent,
              (filename.hasSuffix(".json") || filename.hasSuffix(".html")), let content = call.getString("content") else {
            call.reject("Invalid local file export.")
            return
        }
        DispatchQueue.main.async {
            guard self.pendingCall == nil else { call.reject("A Files operation is already open."); return }
            do {
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let url = directory.appendingPathComponent(filename)
                self.exportURL = url
                try Data(content.utf8).write(to: url, options: [.atomic, .completeFileProtection])
                let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
                self.present(picker, call: call)
            } catch {
                self.cleanup()
                call.reject("Backup could not be prepared. Check available storage.")
            }
        }
    }

    @objc func importBackup(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pendingCall == nil else { call.reject("A Files operation is already open."); return }
            self.present(UIDocumentPickerViewController(forOpeningContentTypes: [.json], asCopy: true), call: call)
        }
    }

    private func present(_ picker: UIDocumentPickerViewController, call: CAPPluginCall) {
        guard let controller = bridge?.viewController, controller.presentedViewController == nil else {
            cleanup()
            call.reject("Close the current dialog before opening Files.")
            return
        }
        pendingCall = call
        picker.delegate = self
        picker.allowsMultipleSelection = false
        controller.present(picker, animated: true)
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingCall?.resolve(["cancelled": true])
        cleanup()
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        defer { cleanup() }
        guard let call = pendingCall else { return }
        if exportURL != nil {
            call.resolve(["cancelled": false])
            return
        }
        guard let url = urls.first else { call.resolve(["cancelled": true]); return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        // Coordinate provider reads; validation and transactional replacement remain in JS.
        var coordinationError: NSError?
        var readError: Error?
        var content: String?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinatedURL in
            do { content = try String(contentsOf: coordinatedURL, encoding: .utf8) }
            catch { readError = error }
        }
        guard coordinationError == nil, readError == nil, let content else {
            call.reject("The selected backup could not be read. Existing records are unchanged.")
            return
        }
        call.resolve(["cancelled": false, "content": content])
    }

    private func cleanup() {
        if let url = exportURL { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        exportURL = nil
        pendingCall = nil
    }
}
