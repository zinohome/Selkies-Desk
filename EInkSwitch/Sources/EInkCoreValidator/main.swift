import EInkCore
import Foundation

func expect(_ condition: Bool, _ message: String) {
    guard condition else {
        print("FAIL: \(message)")
        exit(1)
    }
}

do {
    let baseline = AccessibilityBaseline(
        increaseContrast: true,
        differentiateWithoutColor: false,
        colorFilterEnabled: true,
        colorFilterType: "High Contrast"
    )
    let decoded = try JSONDecoder().decode(
        AccessibilityBaseline.self,
        from: JSONEncoder().encode(baseline)
    )
    expect(decoded == baseline, "baseline JSON round-trip")

    expect(SwitchPlanner.action(for: .eink, baseline: nil) == .applyEInk, "e-ink planning")
    expect(SwitchPlanner.action(for: .normal, baseline: nil) == .captureAndRestore, "first normal-mode planning")
    let savedBaseline = AccessibilityBaseline(
        increaseContrast: false,
        differentiateWithoutColor: false,
        colorFilterEnabled: false,
        colorFilterType: "Grayscale"
    )
    expect(
        SwitchPlanner.action(for: .normal, baseline: savedBaseline) == .restore(savedBaseline),
        "saved baseline planning"
    )

    let readScript = AppleScriptBuilder.readScript()
    for expected in [
        "System Settings", "增强对比度", "Increase Contrast", "无需用颜色区分",
        "Differentiate Without Color", "色彩滤镜", "Color Filters", "滤镜类型", "Filter Type",
    ] {
        expect(readScript.contains(expected), "read script contains \(expected)")
    }

    let applyScript = try AppleScriptBuilder.applyScript(savedBaseline)
    for expected in [
        "set targetContrast to false", "set targetDifferentiate to false",
        "set targetFilterEnabled to false", "set targetFilterType to \"Grayscale\"", "Grayscale",
    ] {
        expect(applyScript.contains(expected), "apply script contains \(expected)")
    }
    let stableTypeScript = try AppleScriptBuilder.applyScript(
        savedBaseline,
        currentFilterType: "Grayscale"
    )
    expect(!stableTypeScript.contains("chooseFilterType({\"Grayscale\"})"), "skip no-op filter type selection")

    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let store = SettingsStore(directory: directory)
    let storedBaseline = AccessibilityBaseline(
        increaseContrast: true,
        differentiateWithoutColor: true,
        colorFilterEnabled: false,
        colorFilterType: "Color Tint"
    )
    try store.save(storedBaseline)
    expect(try store.load() == storedBaseline, "baseline persistence")
    try store.delete()
    expect(try store.load() == nil, "baseline deletion")

    print("EInkCoreValidator: all checks passed")
} catch {
    print("FAIL: \(error)")
    exit(1)
}
