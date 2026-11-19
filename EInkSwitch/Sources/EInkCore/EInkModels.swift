import Foundation

public enum SwitchMode: String {
    case eink
    case normal
}

public enum SwitchAction: Equatable {
    case applyEInk
    case captureAndRestore
    case restore(AccessibilityBaseline)
}

public struct AccessibilityBaseline: Codable, Equatable {
    public var increaseContrast: Bool
    public var differentiateWithoutColor: Bool
    public var colorFilterEnabled: Bool
    public var colorFilterType: String

    public init(
        increaseContrast: Bool,
        differentiateWithoutColor: Bool,
        colorFilterEnabled: Bool,
        colorFilterType: String
    ) {
        self.increaseContrast = increaseContrast
        self.differentiateWithoutColor = differentiateWithoutColor
        self.colorFilterEnabled = colorFilterEnabled
        self.colorFilterType = colorFilterType
    }
}

public enum SwitchPlanner {
    public static func action(for mode: SwitchMode, baseline: AccessibilityBaseline?) -> SwitchAction {
        switch mode {
        case .eink:
            return .applyEInk
        case .normal:
            if let baseline {
                return .restore(baseline)
            }
            return .captureAndRestore
        }
    }
}
