// Draws the icon (docs/icon.png), the README demo (docs/demo.gif) and the link preview image
// (docs/social.png). Everything is drawn here, never recorded, so no real desktop appears. The text
// in the demo is brainhound's real output for a public DANDI dataset, shortened to fit.
//
//   swift scripts/make-art.swift
import AppKit
import ImageIO
import UniformTypeIdentifiers

let ink = NSColor(srgbRed: 0.05, green: 0.06, blue: 0.07, alpha: 1)
let ice = NSColor(srgbRed: 0.62, green: 0.82, blue: 1.0, alpha: 1)
let slate = NSColor(srgbRed: 0.13, green: 0.17, blue: 0.27, alpha: 1)

func bitmap(_ width: Int, _ height: Int, draw: () -> Void) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    )!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    draw()
    NSGraphicsContext.restoreGraphicsState()
    return rep
}

// MARK: Icon

/// A neuron on a slate tile, with an ice-blue lens over its branches: finding things in brain data.
func icon(pixels: Int) -> NSBitmapImageRep {
    bitmap(pixels, pixels) {
        let scale = NSAffineTransform()
        scale.scale(by: CGFloat(pixels) / 1024)
        scale.concat()

        let tile = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 185, yRadius: 185)
        NSGraphicsContext.saveGraphicsState()
        let tileShadow = NSShadow()
        tileShadow.shadowColor = .black.withAlphaComponent(0.3)
        tileShadow.shadowBlurRadius = 24
        tileShadow.shadowOffset = NSSize(width: 0, height: -12)
        tileShadow.set()
        slate.setFill()
        tile.fill()
        NSGraphicsContext.restoreGraphicsState()
        NSGradient(colors: [
            NSColor(srgbRed: 0.80, green: 0.87, blue: 0.96, alpha: 1),
            NSColor(srgbRed: 0.45, green: 0.57, blue: 0.75, alpha: 1),
            slate,
        ])!.draw(in: tile, angle: -90)

        // The neuron: a soma and dendrites that fork, drawn in white like a sheet on the tile.
        NSGraphicsContext.saveGraphicsState()
        tile.addClip()
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.28)
        shadow.shadowBlurRadius = 20
        shadow.shadowOffset = NSSize(width: 0, height: -8)
        shadow.set()
        NSColor.white.withAlphaComponent(0.95).set()
        let soma = NSPoint(x: 410, y: 440)
        func branch(from start: NSPoint, angle: CGFloat, length: CGFloat, width: CGFloat, depth: Int) {
            let end = NSPoint(x: start.x + cos(angle) * length, y: start.y + sin(angle) * length)
            let path = NSBezierPath()
            path.move(to: start)
            path.curve(
                to: end,
                controlPoint1: NSPoint(x: start.x + cos(angle - 0.25) * length * 0.4, y: start.y + sin(angle - 0.25) * length * 0.4),
                controlPoint2: NSPoint(x: end.x - cos(angle + 0.2) * length * 0.35, y: end.y - sin(angle + 0.2) * length * 0.35))
            path.lineWidth = width
            path.lineCapStyle = .round
            path.stroke()
            if depth > 0 {
                branch(from: end, angle: angle + 0.45, length: length * 0.68, width: width * 0.62, depth: depth - 1)
                branch(from: end, angle: angle - 0.42, length: length * 0.62, width: width * 0.62, depth: depth - 1)
            }
        }
        for (angle, length) in [(CGFloat.pi * 0.62, CGFloat(170)), (CGFloat.pi * 0.95, 150), (CGFloat.pi * 1.32, 140), (CGFloat.pi * 1.7, 120), (CGFloat.pi * 0.2, 150)] {
            branch(from: soma, angle: angle, length: length, width: 34, depth: 2)
        }
        NSBezierPath(ovalIn: NSRect(x: soma.x - 74, y: soma.y - 74, width: 148, height: 148)).fill()
        NSGraphicsContext.restoreGraphicsState()

        // The lens, glowing ice blue, over the upper right branches.
        NSGraphicsContext.saveGraphicsState()
        let glow = NSShadow()
        glow.shadowColor = ice.withAlphaComponent(0.8)
        glow.shadowBlurRadius = 30
        glow.set()
        ice.setStroke()
        let lens = NSBezierPath(ovalIn: NSRect(x: 520, y: 480, width: 250, height: 250))
        lens.lineWidth = 46
        lens.stroke()
        let handle = NSBezierPath()
        handle.move(to: NSPoint(x: 735, y: 512))
        handle.line(to: NSPoint(x: 838, y: 410))
        handle.lineWidth = 62
        handle.lineCapStyle = .round
        handle.stroke()
        NSGraphicsContext.restoreGraphicsState()
        ice.withAlphaComponent(0.16).setFill()
        NSBezierPath(ovalIn: NSRect(x: 543, y: 503, width: 204, height: 204)).fill()
    }
}

try icon(pixels: 256).representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "docs/icon.png"))

// MARK: Demo and social image

/// Cool silver light on a dark wallpaper, like the other projects' art.
func wallpaper(_ rect: NSRect) {
    NSGradient(starting: NSColor(srgbRed: 0.08, green: 0.09, blue: 0.13, alpha: 1), ending: ink)!.draw(in: rect, angle: -90)
    let glows: [(CGFloat, CGFloat, CGFloat, NSColor)] = [
        (0.18, 0.75, 0.42, NSColor(srgbRed: 0.84, green: 0.89, blue: 0.95, alpha: 0.45)),
        (0.85, 0.72, 0.38, NSColor(srgbRed: 0.59, green: 0.68, blue: 0.81, alpha: 0.40)),
        (0.70, 0.12, 0.46, NSColor(srgbRed: 0.75, green: 0.81, blue: 0.89, alpha: 0.32)),
        (0.22, 0.15, 0.30, NSColor(srgbRed: 0.44, green: 0.53, blue: 0.65, alpha: 0.32)),
    ]
    for (x, y, r, color) in glows {
        let center = NSPoint(x: rect.minX + rect.width * x, y: rect.minY + rect.height * y)
        NSGradient(starting: color, ending: color.withAlphaComponent(0))!
            .draw(fromCenter: center, radius: 0, toCenter: center, radius: rect.width * r, options: [])
    }
}

@discardableResult
func text(
    _ string: String, at point: NSPoint, size: CGFloat, weight: NSFont.Weight = .regular, color: NSColor = .white,
    centered: Bool = false, mono: Bool = false
) -> CGFloat {
    let font = mono ? NSFont.monospacedSystemFont(ofSize: size, weight: weight) : NSFont.systemFont(ofSize: size, weight: weight)
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
    let width = (string as NSString).size(withAttributes: attributes).width
    (string as NSString).draw(at: NSPoint(x: centered ? point.x - width / 2 : point.x, y: point.y), withAttributes: attributes)
    return width
}

let width: CGFloat = 720
let height: CGFloat = 450

func terminal(_ lines: [(String, NSColor)], badge: String?) -> NSBitmapImageRep {
    bitmap(Int(width), Int(height)) {
        wallpaper(NSRect(x: 0, y: 0, width: width, height: height))
        let frame = NSRect(x: 30, y: 30, width: 660, height: 390)
        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        shadow.shadowColor = .black.withAlphaComponent(0.55)
        shadow.shadowBlurRadius = 26
        shadow.shadowOffset = NSSize(width: 0, height: -10)
        shadow.set()
        NSColor(srgbRed: 0.07, green: 0.08, blue: 0.10, alpha: 0.97).setFill()
        NSBezierPath(roundedRect: frame, xRadius: 12, yRadius: 12).fill()
        NSGraphicsContext.restoreGraphicsState()
        for (i, color) in [NSColor.systemRed, .systemYellow, .systemGreen].enumerated() {
            color.setFill()
            NSBezierPath(ovalIn: NSRect(x: frame.minX + 16 + CGFloat(i) * 20, y: frame.maxY - 24, width: 12, height: 12)).fill()
        }
        for (i, (line, color)) in lines.suffix(18).enumerated() {
            text(line, at: NSPoint(x: frame.minX + 20, y: frame.maxY - 56 - CGFloat(i) * 18.5), size: 12.5, color: color, mono: true)
        }
        if let badge {
            // In the title bar, so it never covers the output.
            let box = NSRect(x: frame.maxX - 270, y: frame.maxY - 31, width: 256, height: 26)
            ice.withAlphaComponent(0.16).setFill()
            NSBezierPath(roundedRect: box, xRadius: 13, yRadius: 13).fill()
            text(badge, at: NSPoint(x: box.midX, y: box.minY + 5.5), size: 12.5, weight: .semibold, color: ice, centered: true)
        }
    }
}

let dim = NSColor.white.withAlphaComponent(0.45)
let plain = NSColor.white.withAlphaComponent(0.85)
let file = "dandi:000003/sub-YutaMouse20/…_ses-YutaMouse20-140327_….nwb"

let searchAsk: [(String, NSColor)] = [("› find open hippocampus recordings", .white), ("", plain)]
let search: [(String, NSColor)] = searchAsk + [
    ("● search_datasets  hippocampus", ice),
    ("## DANDI: 55 matches", plain),
    ("- dandi:000003  Physiological Properties and Behavioral Correlates", plain),
    ("  of Hippocampal Granule Cells and Mossy Cells", plain),
    ("  House mouse · 101 files · 2.6 TB · License: CC BY 4.0", dim),
    ("## OpenNeuro: 61 matches", plain),
    ("- openneuro:ds007122  7T fMRI VASO of the human hippocampus", plain),
    ("## NeuroMorpho: 67094 matches by brain region", plain),
    ("- neuromorpho:n419  pyramidal, principal cell in hippocampus, CA1", plain),
    ("", plain),
]
let summaryAsk = search + [("› what's in one session of 000003?", .white), ("", plain)]
let summary = summaryAsk + [
    ("● nwb_summary  \(file)", ice),
    ("Subject: Mus musculus, YutaMouse20, 213 days, SST-Cre", plain),
    ("Electrodes: 65   Units: 14", plain),
    ("  /acquisition/position_sensor0  data: [1163198 × 2] float64", plain),
    ("  /processing/ecephys/LFP  holds LFP: [37222125 × 65] int16", plain),
    ("(read 1.3 MB in 20 range requests; the file was not downloaded)", dim),
    ("", plain),
]
let spikesAsk = summary + [("› first spike times of unit 0?", .white), ("", plain)]
let spikes = spikesAsk + [
    ("● nwb_table  /units  spike_times", ice),
    ("0   \"51205 values: [0.4538, 0.60485, 0.63345, 0.8409, …]\"", plain),
    ("License: CC BY 4.0", plain),
    ("Cite as: Senzai, Yuta; Fernandez-Ruiz, Antonio; Buzsáki, György …", plain),
    ("  https://doi.org/10.48324/dandi.000003/0.260218.2052", plain),
]

var frames: [(NSBitmapImageRep, Double)] = [(terminal(searchAsk, badge: nil), 1.0)]
for count in stride(from: searchAsk.count + 2, through: search.count, by: 2) { frames.append((terminal(Array(search.prefix(count)), badge: nil), 0.14)) }
frames.append((terminal(search, badge: "three archives, one search"), 2.0))
frames.append((terminal(summaryAsk, badge: nil), 1.0))
for count in stride(from: summaryAsk.count + 2, through: summary.count, by: 2) { frames.append((terminal(Array(summary.prefix(count)), badge: nil), 0.16)) }
frames.append((terminal(summary, badge: "8.4 GB file · read 1.3 MB"), 2.6))
frames.append((terminal(spikesAsk, badge: nil), 1.0))
for count in stride(from: spikesAsk.count + 2, through: spikes.count, by: 2) { frames.append((terminal(Array(spikes.prefix(count)), badge: nil), 0.16)) }
frames.append((terminal(spikes, badge: "with its license and citation"), 3.2))

let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: "docs/demo.gif") as CFURL, UTType.gif.identifier as CFString, frames.count, nil)!
CGImageDestinationSetProperties(destination, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
for (rep, hold) in frames {
    CGImageDestinationAddImage(destination, rep.cgImage!, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: hold]] as CFDictionary)
}
guard CGImageDestinationFinalize(destination) else { fatalError("Couldn't write the GIF") }

let social = bitmap(1280, 640) {
    wallpaper(NSRect(x: 0, y: 0, width: 1280, height: 640))
    NSImage(contentsOfFile: "docs/icon.png")!.draw(in: NSRect(x: 96, y: 380, width: 140, height: 140))
    text("brainhound", at: NSPoint(x: 96, y: 270), size: 80, weight: .semibold)
    text("Search and read public neuroscience data from your agent.", at: NSPoint(x: 100, y: 214), size: 30, color: .white.withAlphaComponent(0.85))
    text("An 8.4 GB NWB file on DANDI, summarized from 1.3 MB. License and citation included.", at: NSPoint(x: 100, y: 164), size: 22, color: ice)
    text("DANDI · OpenNeuro · NeuroMorpho · Allen · BrainGlobe · MCP server, CLI and skills", at: NSPoint(x: 100, y: 100), size: 17, color: .white.withAlphaComponent(0.5), mono: true)
}
try social.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "docs/social.png"))
Swift.print("Wrote docs/icon.png, docs/demo.gif and docs/social.png")
