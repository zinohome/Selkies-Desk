import AppKit

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
    NSColor.black.setStroke()
    let frame = NSBezierPath(roundedRect: NSRect(x: 1.75, y: 5.25, width: 14.5, height: 10.5), xRadius: 1.5, yRadius: 1.5)
    frame.lineWidth = 1.5
    frame.stroke()
    let stand = NSBezierPath()
    stand.move(to: NSPoint(x: 9, y: 5))
    stand.line(to: NSPoint(x: 9, y: 2))
    stand.move(to: NSPoint(x: 5.5, y: 2))
    stand.line(to: NSPoint(x: 12.5, y: 2))
    stand.lineWidth = 1.5
    stand.lineCapStyle = .round
    stand.stroke()
    NSGraphicsContext.restoreGraphicsState()
    let name = scale == 1 ? "trayTemplate.png" : "trayTemplate@2x.png"
    try bitmap.representation(using: .png, properties: [:])!.write(
        to: URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent(name)
    )
}
