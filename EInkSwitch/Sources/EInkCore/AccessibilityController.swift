import Foundation

public protocol CommandRunning {
    func run(executable: String, arguments: [String]) throws -> String
}

public struct ProcessCommandRunner: CommandRunning {
    public init() {}

    public func run(executable: String, arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        try process.run()
        let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
        let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        let output = String(decoding: outputData, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        let error = String(decoding: errorData, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard process.terminationStatus == 0 else {
            throw EInkError.commandFailed(command: executable, message: error.isEmpty ? output : error)
        }
        return output
    }
}

public enum EInkError: LocalizedError {
    case commandFailed(command: String, message: String)
    case invalidStateOutput(String)

    public var errorDescription: String? {
        switch self {
        case .commandFailed(_, let message):
            return message
        case .invalidStateOutput(let output):
            return "无法解析系统设置状态：\(output)"
        }
    }
}

public struct SystemSettingsController {
    private let runner: CommandRunning

    public init(runner: CommandRunning = ProcessCommandRunner()) {
        self.runner = runner
    }

    public static let einkBaseline = AccessibilityBaseline(
        increaseContrast: true,
        differentiateWithoutColor: true,
        colorFilterEnabled: true,
        colorFilterType: "灰度"
    )

    public static let disabledBaseline = AccessibilityBaseline(
        increaseContrast: false,
        differentiateWithoutColor: false,
        colorFilterEnabled: false,
        colorFilterType: "灰度"
    )

    public func read() throws -> AccessibilityBaseline {
        let output = try runner.run(executable: "/usr/bin/osascript", arguments: ["-e", AppleScriptBuilder.readScript()])
        let values = output.components(separatedBy: "|")
        guard values.count == 4 else {
            throw EInkError.invalidStateOutput(output)
        }

        return AccessibilityBaseline(
            increaseContrast: values[0] == "1",
            differentiateWithoutColor: values[1] == "1",
            colorFilterEnabled: values[2] == "1",
            colorFilterType: values[3]
        )
    }

    public func apply(_ baseline: AccessibilityBaseline) throws {
        let current = try? read()
        let script = try AppleScriptBuilder.applyScript(baseline, currentFilterType: current?.colorFilterType)
        _ = try runner.run(executable: "/usr/bin/osascript", arguments: ["-e", script])
    }
}
