// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "EInkSwitch",
    targets: [
        .target(name: "EInkCore"),
        .executableTarget(
            name: "EInkSwitch",
            dependencies: ["EInkCore"]
        ),
        .executableTarget(
            name: "EInkCoreValidator",
            dependencies: ["EInkCore"]
        ),
    ]
)
