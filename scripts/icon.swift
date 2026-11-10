import AppKit

let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)
image.lockFocus()
NSColor.clear.setFill()
NSRect(origin: .zero, size: size).fill()
let square = NSBezierPath(roundedRect: NSRect(x: 70, y: 70, width: 884, height: 884), xRadius: 198, yRadius: 198)
NSColor(srgbRed: 0.08, green: 0.49, blue: 0.45, alpha: 1).setFill()
square.fill()
NSColor(srgbRed: 0.94, green: 1, blue: 0.98, alpha: 1).setStroke()
for baseline in [405.0, 615.0] {
    let wave = NSBezierPath()
    wave.move(to: NSPoint(x: 280, y: baseline))
    wave.curve(to: NSPoint(x: 744, y: baseline), controlPoint1: NSPoint(x: 445, y: baseline + 135), controlPoint2: NSPoint(x: 573, y: baseline - 135))
    wave.lineWidth = 77
    wave.lineCapStyle = .round
    wave.stroke()
}
image.unlockFocus()
let representation = NSBitmapImageRep(data: image.tiffRepresentation!)!
try representation.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
