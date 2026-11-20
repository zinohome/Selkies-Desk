import AppKit

let output = URL(fileURLWithPath: CommandLine.arguments[1])
guard let dockIcon = NSImage(contentsOf: output.appendingPathComponent("icon.png")) else {
    fatalError("The Dock icon could not be loaded.")
}
for scale in [1, 2] {
    let pixels = 18 * scale
    let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    )!
    bitmap.size = NSSize(width: 18, height: 18)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    dockIcon.draw(
        in: NSRect(origin: .zero, size: NSSize(width: 18, height: 18)),
        from: .zero, operation: .sourceOver, fraction: 1,
        respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high]
    )
    NSGraphicsContext.restoreGraphicsState()
    let name = scale == 1 ? "tray.png" : "tray@2x.png"
    try bitmap.representation(using: .png, properties: [:])!.write(
        to: output.appendingPathComponent(name)
    )
}
