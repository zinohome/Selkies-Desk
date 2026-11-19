import Foundation

public struct SettingsStore {
    private let baseURL: URL
    private let fileManager: FileManager

    public init(directory: URL, fileManager: FileManager = .default) {
        self.baseURL = directory
        self.fileManager = fileManager
    }

    public static func defaultDirectory(fileManager: FileManager = .default) throws -> URL {
        let applicationSupport = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return applicationSupport.appendingPathComponent("EInkSwitch", isDirectory: true)
    }

    public var directory: URL {
        baseURL
    }

    private var baselineURL: URL {
        baseURL.appendingPathComponent("baseline.json")
    }

    public func save(_ baseline: AccessibilityBaseline) throws {
        try fileManager.createDirectory(at: baseURL, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(baseline)
        try data.write(to: baselineURL, options: .atomic)
    }

    public func load() throws -> AccessibilityBaseline? {
        guard fileManager.fileExists(atPath: baselineURL.path) else { return nil }
        let data = try Data(contentsOf: baselineURL)
        return try JSONDecoder().decode(AccessibilityBaseline.self, from: data)
    }

    public func delete() throws {
        guard fileManager.fileExists(atPath: baselineURL.path) else { return }
        try fileManager.removeItem(at: baselineURL)
    }
}
