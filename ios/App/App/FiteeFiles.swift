import Foundation
import Darwin

/// The app's own files, for FiteeNativePlugin.swift. Foundation only (no Capacitor, no UIKit), so it reads on its own.
/// src/native/bridge.ts is the contract: what each method does, and the error codes.
///
///   Library/Application Support/fitee/
///     data/  snapshot.json, snapshot.next.json, snapshot.prev.json: the copy of the log (src/native/snapshot.ts).
///            In the iPhone's backups, like any app's data.
///     sets/  index.json, index.unreadable-<ms>.json, <id>.replay.json, <id>.<ext>, and <id>.<ext>.part while an
///            upload runs. The folder and every file are marked excluded from backup: guidance to iOS (Apple,
///            "Optimizing your app's data for iCloud backup"), set again at every save because some file operations
///            reset it.
///   Library/Application Support/fitee-deleting
///            An empty file while Delete all my data runs (deleteAll() writes it before it removes anything, and
///            finishDeleting() removes it once the web view's stores are gone too): if the app or its page stops part
///            way, the next launch finishes the delete (AppInfo.deleting) instead of copying the data back. A delete
///            that fails before the web view's stores are touched leaves it as it was before (deleteAll()). Outside
///            fitee/, so it outlives the folder it guards; excluded from backup (it's about this phone, not the user).
///   tmp/     fitee-export/<name> while a Save to Files panel is open, and the copies iOS makes of a video picked for a
///            technique check or filmed with Take Video (WebKit's file panel puts them here and would keep them until
///            the web view goes away). Emptied at launch (SceneDelegate.swift), by clearPickedFiles() and by
///            deleteAll().
///
/// Every name comes from the page and is checked against the contract's patterns (src/native/setFiles.ts, the same
/// strings character for character; tests/native-project.test.ts compares them): a call never names a path.
/// Nothing here uses a required-reason API (file dates, attributesOfItem, stat, volume capacity keys, systemUptime,
/// UserDefaults): fileSizeKey and isExcludedFromBackupKey aren't on Apple's list, so the app's privacy manifest
/// declares none.
///
/// Capacitor calls the plugin's methods one at a time on its bridge queue (CapacitorBridge.swift:535-560); the state
/// below is also touched from the main queue (the Save to Files panel), hence the lock.
final class FiteeFiles {
    /// SET_FILE_NAME: a file in sets/.
    static let setFileName = #"^(index\.json|index\.unreadable-[0-9]{1,16}\.json|[A-Za-z0-9_-]{1,64}\.(replay\.json|mp4|mov|m4v|webm))$"#
    /// SET_ID: a saved set's id, the first part of its file names.
    static let setId = #"^[A-Za-z0-9_-]{1,64}$"#
    /// EXPORT_NAME: a file exportFile saves.
    static let exportName = #"^[A-Za-z0-9._-]{1,100}\.json$"#
    /// VIDEO_EXTS.
    static let videoExts: [String] = ["mp4", "mov", "m4v", "webm"]
    /// CHUNK: the most bytes one appendVideo may carry (1 MiB).
    static let chunk = 1_048_576
    /// The base64 of `chunk` bytes is at most this long.
    static let chunkBase64 = 1_398_104
    /// tmp/<this>/ holds the file a Save to Files panel saves.
    static let exportFolderName = "fitee-export"

    /// A refusal for the page: `code` is one of NATIVE_ERROR_CODES (src/native/bridge.ts).
    struct Failure: Error {
        let code: String
        let message: String

        static func badName(_ what: String) -> Failure {
            return Failure(code: "BAD_NAME", message: "\(what) isn't one this app uses.")
        }
        static func badData(_ message: String) -> Failure { return Failure(code: "BAD_DATA", message: message) }
        static func badOffset(_ message: String) -> Failure { return Failure(code: "BAD_OFFSET", message: message) }
        static func sizeMismatch(_ message: String) -> Failure { return Failure(code: "SIZE_MISMATCH", message: message) }
        static func notFound(_ message: String) -> Failure { return Failure(code: "NOT_FOUND", message: message) }
        static let noRoom = Failure(code: "NO_ROOM", message: "There isn't enough free space on this iPhone.")

        /// What the page is told about an error: a Failure as it is, NO_ROOM for a full disk, else IO_ERROR.
        static func from(_ error: Error) -> Failure {
            if let failure = error as? Failure { return failure }
            if FiteeFiles.isOutOfSpace(error) { return noRoom }
            return Failure(code: "IO_ERROR", message: "A file couldn't be read or written.")
        }
    }

    /// Library/Application Support/fitee.
    let root: URL
    /// The app's temporary folder (FileManager.default.temporaryDirectory).
    let temporaryFolder: URL
    var dataFolder: URL { return root.appendingPathComponent("data", isDirectory: true) }
    /// Library/Application Support/fitee-deleting: there while a Delete all my data hasn't finished.
    var deletingMarker: URL { return root.deletingLastPathComponent().appendingPathComponent("fitee-deleting", isDirectory: false) }
    var setsFolder: URL { return root.appendingPathComponent("sets", isDirectory: true) }
    var exportFolder: URL { return temporaryFolder.appendingPathComponent(FiteeFiles.exportFolderName, isDirectory: true) }

    private let lock = NSLock()
    /// The .part files of the uploads running now (in memory: a part not in here is a leftover).
    private var activeParts = Set<String>()
    /// How many Save to Files panels have a file in tmp/fitee-export/ (one at most, in practice).
    private var openExports = 0

    init(root: URL, temporaryFolder: URL) {
        self.root = root
        self.temporaryFolder = temporaryFolder
    }

    convenience init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        self.init(root: support.appendingPathComponent("fitee", isDirectory: true),
                  temporaryFolder: FileManager.default.temporaryDirectory)
    }

    private var fileManager: FileManager { return FileManager.default }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    // MARK: - The copy of the log (data/)

    private var current: URL { return dataFolder.appendingPathComponent("snapshot.json", isDirectory: false) }
    private var next: URL { return dataFolder.appendingPathComponent("snapshot.next.json", isDirectory: false) }
    private var prev: URL { return dataFolder.appendingPathComponent("snapshot.prev.json", isDirectory: false) }

    /// readSnapshot: the text of each file that exists ("current", "next", "prev"); a file that isn't UTF-8 comes back
    /// as "" (unreadable, like bad JSON). A file that exists but can't be read throws IO_ERROR.
    func readSnapshot() throws -> [String: String] {
        var files: [String: String] = [:]
        for (key, url) in [("current", current), ("next", next), ("prev", prev)] {
            if let data = try readIfPresent(url) {
                files[key] = String(data: data, encoding: .utf8) ?? ""
            }
        }
        return files
    }

    /// writeSnapshot: writes snapshot.next.json, moves snapshot.json to snapshot.prev.json, then snapshot.next.json to
    /// snapshot.json (POSIX rename(2), each an atomic replace), so a crash at any point leaves a complete copy in one of
    /// the three files. Returns the bytes written.
    func writeSnapshot(_ text: String?) throws -> Int {
        guard let text = text, !text.isEmpty else { throw Failure.badData("There's no copy to write.") }
        let bytes = Data(text.utf8)
        do {
            try fileManager.createDirectory(at: dataFolder, withIntermediateDirectories: true, attributes: nil)
            try bytes.write(to: next, options: [.atomic, .completeFileProtectionUnlessOpen])
            if fileManager.fileExists(atPath: current.path) {
                try FiteeFiles.rename(current, to: prev)
            }
            try FiteeFiles.rename(next, to: current)
        } catch {
            throw Failure.from(error)
        }
        return bytes.count
    }

    /// dropSnapshot: deletes snapshot.json only (a missing one is fine).
    func dropSnapshot() throws {
        do {
            try removeIfPresent(current)
        } catch {
            throw Failure.from(error)
        }
    }

    // MARK: - Saved sets (sets/)

    /// readSetFile: the text of a JSON file in sets/, or nil if it doesn't exist.
    func readSetFile(_ name: String?) throws -> String? {
        let url = try jsonSetFile(name)
        guard let data = try readIfPresent(url) else { return nil }
        guard let text = String(data: data, encoding: .utf8) else {
            throw Failure.badData("\(url.lastPathComponent) isn't UTF-8 text.")
        }
        return text
    }

    /// writeSetFile: an atomic write, then the file is marked excluded from backup (again: the write made a new file).
    func writeSetFile(_ name: String?, _ text: String?) throws {
        let url = try jsonSetFile(name)
        guard let text = text, !text.isEmpty else { throw Failure.badData("There's no text to write.") }
        do {
            try makeSetsFolder()
            try Data(text.utf8).write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
            try FiteeFiles.exclude(url)
        } catch {
            throw Failure.from(error)
        }
    }

    /// renameSetFile: POSIX rename(2), replacing `to` if it exists; `to` stays excluded from backup.
    func renameSetFile(_ from: String?, _ to: String?) throws {
        let source = try setFile(from)
        let target = try setFile(to)
        guard fileManager.fileExists(atPath: source.path) else {
            throw Failure.notFound("\(source.lastPathComponent) doesn't exist.")
        }
        do {
            try FiteeFiles.rename(source, to: target)
            try FiteeFiles.exclude(target)
        } catch {
            throw Failure.from(error)
        }
    }

    /// removeSetFiles: checks every name first, then deletes each file (a missing one is fine).
    func removeSetFiles(_ names: [String]?) throws {
        guard let names = names else { throw Failure.badName("The list of file names") }
        let urls = try names.map { try setFile($0) }
        do {
            for url in urls {
                try removeIfPresent(url)
            }
        } catch {
            throw Failure.from(error)
        }
    }

    /// listSetFiles: first deletes every *.part whose upload isn't running, then lists the files whose names match
    /// SET_FILE_NAME (anything else is left alone, unlisted) with their size and backup flag, sorted by name, and the
    /// folder's flag. An absent folder lists nothing.
    func listSetFiles() throws -> (files: [[String: Any]], folderExcluded: Bool) {
        let folder = setsFolder
        guard fileManager.fileExists(atPath: folder.path) else { return ([], false) }
        let keys: [URLResourceKey] = [.fileSizeKey, .isExcludedFromBackupKey, .isRegularFileKey]
        do {
            let items = try fileManager.contentsOfDirectory(at: folder, includingPropertiesForKeys: keys, options: [])
            let running = locked { activeParts }
            for item in items where item.pathExtension == "part" && !running.contains(item.lastPathComponent) {
                try? fileManager.removeItem(at: item)
            }
            var files: [[String: Any]] = []
            for item in items.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                let name = item.lastPathComponent
                guard FiteeFiles.matches(name, FiteeFiles.setFileName),
                      let values = try? item.resourceValues(forKeys: Set(keys)),
                      values.isRegularFile == true else { continue }
                files.append(["name": name, "bytes": values.fileSize ?? 0, "excluded": values.isExcludedFromBackup ?? false])
            }
            let folderValues = try folder.resourceValues(forKeys: [.isExcludedFromBackupKey])
            return (files, folderValues.isExcludedFromBackup ?? false)
        } catch {
            throw Failure.from(error)
        }
    }

    // MARK: - Videos (sets/<id>.<ext>, written in chunks)

    /// beginVideo: an empty sets/<id>.<ext>.part (file protection completeUnlessOpen), replacing a part of that name,
    /// added to activeParts. Returns the chunk size.
    func beginVideo(id: String?, ext: String?, bytes: Int?) throws -> Int {
        let upload = try videoUpload(id, ext)
        guard (bytes ?? -1) >= 0 else { throw Failure.badData("The video's size isn't a whole number of bytes.") }
        do {
            try makeSetsFolder()
            try removeIfPresent(upload.part)
            try Data().write(to: upload.part, options: [.completeFileProtectionUnlessOpen])
            try FiteeFiles.exclude(upload.part)
        } catch {
            throw Failure.from(error)
        }
        _ = locked { activeParts.insert(upload.partName) }
        return FiteeFiles.chunk
    }

    /// appendVideo: `data` (base64 of at most `chunk` bytes) goes at `offset`, which must be the part's size so far.
    /// Returns the part's size after it.
    func appendVideo(id: String?, ext: String?, offset: Int?, data: String?) throws -> Int {
        let upload = try videoUpload(id, ext)
        guard locked({ activeParts.contains(upload.partName) }) else {
            throw Failure.notFound("No upload is running for \(upload.partName).")
        }
        guard let offset = offset, offset >= 0 else { throw Failure.badOffset("The offset isn't a whole number of bytes.") }
        guard let base64 = data, base64.utf8.count <= FiteeFiles.chunkBase64,
              let bytes = Data(base64Encoded: base64), bytes.count <= FiteeFiles.chunk else {
            throw Failure.badData("The chunk isn't base64 of at most \(FiteeFiles.chunk) bytes.")
        }
        do {
            let handle = try FileHandle(forWritingTo: upload.part)
            // FileHandle writes go straight to write(2), so a full disk shows in write(contentsOf:), not at close.
            defer { try? handle.close() }
            let end = try handle.seekToEnd()
            guard end == UInt64(offset) else {
                throw Failure.badOffset("The part holds \(end) bytes, not \(offset).")
            }
            try handle.write(contentsOf: bytes)
        } catch {
            throw Failure.from(error)
        }
        return offset + bytes.count
    }

    /// finishVideo: the part must hold exactly `bytes` (else SIZE_MISMATCH, and the part stays for abortVideo); it
    /// then replaces sets/<id>.<ext> (rename(2)), is marked excluded from backup and leaves activeParts.
    func finishVideo(id: String?, ext: String?, bytes: Int?) throws -> Int {
        let upload = try videoUpload(id, ext)
        guard locked({ activeParts.contains(upload.partName) }) else {
            throw Failure.notFound("No upload is running for \(upload.partName).")
        }
        let size: Int
        do {
            size = try upload.part.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? -1
        } catch {
            throw Failure.from(error)
        }
        guard let bytes = bytes, size == bytes else {
            throw Failure.sizeMismatch("The part holds \(size) bytes, not the size given.")
        }
        do {
            try FiteeFiles.rename(upload.part, to: upload.video)
            try FiteeFiles.exclude(upload.video)
        } catch {
            throw Failure.from(error)
        }
        _ = locked { activeParts.remove(upload.partName) }
        return bytes
    }

    /// abortVideo: deletes the part (a missing one is fine) and removes it from activeParts.
    func abortVideo(id: String?, ext: String?) throws {
        let upload = try videoUpload(id, ext)
        _ = locked { activeParts.remove(upload.partName) }
        do {
            try removeIfPresent(upload.part)
        } catch {
            throw Failure.from(error)
        }
    }

    /// videoUrl's file: a saved video's file, which must exist.
    func videoFile(_ name: String?) throws -> URL {
        let url = try setFile(name)
        guard FiteeFiles.videoExts.contains(url.pathExtension) else { throw Failure.badName("The video's file name") }
        guard fileManager.fileExists(atPath: url.path) else { throw Failure.notFound("\(url.lastPathComponent) isn't saved.") }
        return url
    }

    // MARK: - Everything

    /// Whether a Delete all my data began and didn't finish (the marker is there): AppInfo.deleting.
    var isDeleting: Bool { return fileManager.fileExists(atPath: deletingMarker.path) }

    /// deleteAllData's files: first the marker, then the whole fitee/ folder (the copy of the log and every saved set)
    /// and everything in tmp/. The marker is written as well as it can be: a phone too full for an empty file still
    /// gets its data deleted (only a stop part way through then goes unnoticed). A failure to remove fitee/ throws
    /// (IO_ERROR) before anything of the web view's is touched, leaving tmp/ as it was and the marker as it was before
    /// the call: a delete that began with this call takes its marker away again (the page keeps its data, says the
    /// delete failed and copies the data again, so the next launch mustn't finish it), while one already under way
    /// (the launch finishing a delete that stopped part way) keeps it, so the next launch tries again.
    func deleteAll() throws {
        let underWay = isDeleting
        markDeleting()
        _ = locked { activeParts.removeAll() }
        do {
            try removeIfPresent(root)
        } catch {
            if !underWay {
                try? removeIfPresent(deletingMarker)
            }
            throw Failure.from(error)
        }
        FiteeFiles.empty(temporaryFolder, keeping: nil)
    }

    /// The marker: an empty file, excluded from backup (a phone restored from a backup made mid-delete mustn't delete
    /// what it restored).
    private func markDeleting() {
        let marker = deletingMarker
        do {
            try fileManager.createDirectory(at: marker.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: nil)
            try Data().write(to: marker, options: [.atomic])
            try FiteeFiles.exclude(marker)
        } catch {
            // Best effort (above).
        }
    }

    /// Delete all my data has finished (the web view's stores are gone too): the marker goes.
    func finishDeleting() throws {
        do {
            try removeIfPresent(deletingMarker)
        } catch {
            throw Failure.from(error)
        }
    }

    // MARK: - The temporary folder (tmp/)

    /// exportFile's file: tmp/fitee-export/<name>, counted as open until closeExport(_:), so clearPickedFiles leaves
    /// it alone while the panel shows.
    func openExport(_ name: String?, _ text: String?) throws -> URL {
        guard let name = name, FiteeFiles.matches(name, FiteeFiles.exportName) else { throw Failure.badName("The file name") }
        guard let text = text, !text.isEmpty else { throw Failure.badData("There's nothing to save.") }
        locked { openExports += 1 }
        let url = exportFolder.appendingPathComponent(name, isDirectory: false)
        do {
            try fileManager.createDirectory(at: exportFolder, withIntermediateDirectories: true, attributes: nil)
            try Data(text.utf8).write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
        } catch {
            closeExport(url)
            throw Failure.from(error)
        }
        return url
    }

    /// The Save to Files panel closed (or never showed): its file goes.
    func closeExport(_ url: URL) {
        try? fileManager.removeItem(at: url)
        locked { openExports = max(0, openExports - 1) }
    }

    /// clearPickedFiles: everything in tmp/ goes, except tmp/fitee-export/ while a Save to Files panel is open.
    func clearPickedFiles() {
        let exporting = locked { openExports > 0 }
        FiteeFiles.empty(temporaryFolder, keeping: exporting ? FiteeFiles.exportFolderName : nil)
    }

    /// Deletes everything in `folder` but the item named `keeping`. What can't be deleted now is left for the next
    /// time (the next launch empties tmp/ before the web view exists).
    static func empty(_ folder: URL, keeping: String?) {
        let fileManager = FileManager.default
        guard let items = try? fileManager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil, options: []) else { return }
        for item in items where item.lastPathComponent != keeping {
            try? fileManager.removeItem(at: item)
        }
    }

    // MARK: - Helpers

    /// Whether `name` matches `pattern` as a whole (ICU's `$` also matches before a final newline, so the match must
    /// cover every character).
    static func matches(_ name: String, _ pattern: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else { return false }
        let whole = NSRange(location: 0, length: (name as NSString).length)
        guard let match = regex.firstMatch(in: name, options: [], range: whole) else { return false }
        return match.range == whole
    }

    /// A file in sets/ (SET_FILE_NAME).
    private func setFile(_ name: String?) throws -> URL {
        guard let name = name, FiteeFiles.matches(name, FiteeFiles.setFileName) else { throw Failure.badName("The file name") }
        return setsFolder.appendingPathComponent(name, isDirectory: false)
    }

    /// A JSON file in sets/: the index, an index set aside, or a replay.
    private func jsonSetFile(_ name: String?) throws -> URL {
        let url = try setFile(name)
        guard url.pathExtension == "json" else { throw Failure.badName("The file name") }
        return url
    }

    /// A video upload's files: sets/<id>.<ext> and sets/<id>.<ext>.part.
    private func videoUpload(_ id: String?, _ ext: String?) throws -> (part: URL, video: URL, partName: String) {
        guard let id = id, FiteeFiles.matches(id, FiteeFiles.setId) else { throw Failure.badName("The set's id") }
        guard let ext = ext, FiteeFiles.videoExts.contains(ext) else { throw Failure.badName("The video's extension") }
        let name = "\(id).\(ext)"
        return (setsFolder.appendingPathComponent(name + ".part", isDirectory: false),
                setsFolder.appendingPathComponent(name, isDirectory: false),
                name + ".part")
    }

    /// sets/, created when needed and marked excluded from backup (again each time: cheap, and it can be reset).
    private func makeSetsFolder() throws {
        try fileManager.createDirectory(at: setsFolder, withIntermediateDirectories: true, attributes: nil)
        try FiteeFiles.exclude(setsFolder)
    }

    /// A file's bytes, or nil if it doesn't exist.
    private func readIfPresent(_ url: URL) throws -> Data? {
        guard fileManager.fileExists(atPath: url.path) else { return nil }
        do {
            return try Data(contentsOf: url)
        } catch {
            if FiteeFiles.isNoSuchFile(error) { return nil }
            throw Failure.from(error)
        }
    }

    private func removeIfPresent(_ url: URL) throws {
        do {
            try fileManager.removeItem(at: url)
        } catch {
            if !FiteeFiles.isNoSuchFile(error) { throw error }
        }
    }

    /// Marks a file or folder to be left out of iCloud and computer backups.
    static func exclude(_ url: URL) throws {
        var url = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
    }

    /// POSIX rename(2): moves `from` to `to`, replacing `to` atomically if it exists.
    static func rename(_ from: URL, to: URL) throws {
        var failure: Int32 = 0
        let renamed = from.withUnsafeFileSystemRepresentation { source -> Bool in
            to.withUnsafeFileSystemRepresentation { target -> Bool in
                guard let source = source, let target = target else {
                    failure = EINVAL
                    return false
                }
                if Darwin.rename(source, target) == 0 { return true }
                failure = errno
                return false
            }
        }
        if !renamed {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(failure), userInfo: nil)
        }
    }

    /// A full disk: Cocoa's NSFileWriteOutOfSpaceError or POSIX ENOSPC, the error itself or the one under it.
    static func isOutOfSpace(_ error: Error) -> Bool {
        let error = error as NSError
        if error.domain == NSCocoaErrorDomain && error.code == NSFileWriteOutOfSpaceError { return true }
        if error.domain == NSPOSIXErrorDomain && error.code == Int(ENOSPC) { return true }
        if let underlying = error.userInfo[NSUnderlyingErrorKey] as? Error { return isOutOfSpace(underlying) }
        return false
    }

    static func isNoSuchFile(_ error: Error) -> Bool {
        let error = error as NSError
        if error.domain == NSCocoaErrorDomain && (error.code == NSFileNoSuchFileError || error.code == NSFileReadNoSuchFileError) {
            return true
        }
        return error.domain == NSPOSIXErrorDomain && error.code == Int(ENOENT)
    }
}
