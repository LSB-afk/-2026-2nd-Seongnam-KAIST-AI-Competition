import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { storyQrSvg } from '../src/lib/story-qr';

describe('offline share QR', () => {
  it('rejects overflow and unsupported text instead of truncating the link', () => {
    expect(() => storyQrSvg('a'.repeat(134))).not.toThrow();
    expect(() => storyQrSvg('a'.repeat(135))).toThrow(/134/);
    expect(() => storyQrSvg('https://example.test/성남')).toThrow(/ASCII/);
    expect(() => storyQrSvg('')).toThrow();
  });

  it('renders a quiet zone and does not interpolate input into SVG markup', () => {
    const svg = storyQrSvg('https://example.test/?x=<script>&a="1"');
    expect(svg).toContain('viewBox="0 0 49 49"');
    expect(svg).toContain('fill="white"');
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('https://example.test');
    expect(svg).toBe(storyQrSvg('https://example.test/?x=<script>&a="1"'));
  });

  it.skipIf(process.platform !== 'darwin')('round-trips short and maximum-capacity URLs through Apple Vision', () => {
    // Native decoder is independent of the encoder; this rasterizes only SVG unit squares.
    const directory = mkdtempSync(join(tmpdir(), 'story-qr-test-'));
    const script = join(directory, 'decode.swift');
    const prefix = 'https://example.test/s/';
    const urls = ['https://example.test/share/abc123', prefix + 'a'.repeat(134 - prefix.length), 'http://127.0.0.1:3000/share/a1?x=%EC%84%B1%EB%82%A8&y=hello#end'];
    writeFileSync(script, String.raw`
import Foundation
import Vision
import CoreGraphics
let input = FileHandle.standardInput.readDataToEndOfFile()
let svgs = try JSONDecoder().decode([String].self, from: input)
let pattern = try NSRegularExpression(pattern: "M([0-9]+) ([0-9]+)h1v1h-1z")
var decoded: [String] = []
for svg in svgs {
  let side = 392
  var pixels = [UInt8](repeating: 255, count: side * side)
  let ns = svg as NSString
  for square in pattern.matches(in: svg, range: NSRange(location: 0, length: ns.length)) {
    let x = Int(ns.substring(with: square.range(at: 1)))! * 8
    let y = Int(ns.substring(with: square.range(at: 2)))! * 8
    for row in y..<(y + 8) { for col in x..<(x + 8) { pixels[row * side + col] = 0 } }
  }
  let provider = CGDataProvider(data: Data(pixels) as CFData)!
  let image = CGImage(width: side, height: side, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: side, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: 0), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
  let request = VNDetectBarcodesRequest()
  request.symbologies = [.qr]
  try VNImageRequestHandler(cgImage: image).perform([request])
  decoded.append(request.results?.first?.payloadStringValue ?? "DECODE_FAILED")
}
print(String(data: try JSONEncoder().encode(decoded), encoding: .utf8)!)
`);
    try {
      const result = spawnSync('/usr/bin/swift', [script], { input: JSON.stringify(urls.map(storyQrSvg)), encoding: 'utf8', timeout: 90000 });
      expect(result.status, result.stderr || String(result.error ?? '')).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(urls);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 100000);
});
