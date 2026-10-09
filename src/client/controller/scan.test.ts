import jsQR from "jsqr";
import qrcode from "qrcode-generator";
import { describe, expect, it } from "vitest";
import { codeFromScan } from "./scan";

describe("codeFromScan", () => {
  it("reads the code out of the link the TV's QR code holds", () => {
    expect(codeFromScan("https://tv.example.com/?code=123456")).toBe("123456");
    expect(codeFromScan("http://192.168.1.20:5173/?code=000042&x=1")).toBe("000042");
  });

  it("takes a bare six-digit code", () => {
    expect(codeFromScan(" 654321 \n")).toBe("654321");
  });

  it("ignores anything else a camera might pick up", () => {
    expect(codeFromScan("https://example.com/")).toBeNull();
    expect(codeFromScan("https://example.com/?code=12345")).toBeNull();
    expect(codeFromScan("https://example.com/?code=1234567")).toBeNull();
    expect(codeFromScan("https://example.com/?code=abcdef")).toBeNull();
    expect(codeFromScan("WIFI:S:home;T:WPA;P:secret;;")).toBeNull();
    expect(codeFromScan("")).toBeNull();
  });
});

describe("the decoder", () => {
  it("reads back the same kind of QR code the TV draws", () => {
    const qr = qrcode(0, "M");
    qr.addData("https://kino.example.com/?code=123456");
    qr.make();
    const modules = qr.getModuleCount();
    const scale = 6; // pixels per module
    const quiet = 4; // modules of white around the code
    const side = (modules + quiet * 2) * scale;
    const pixels = new Uint8ClampedArray(side * side * 4).fill(255); // opaque white
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        if (!qr.isDark(row, col)) continue;
        for (let y = 0; y < scale; y++) {
          for (let x = 0; x < scale; x++) {
            const at = (((row + quiet) * scale + y) * side + (col + quiet) * scale + x) * 4;
            pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
          }
        }
      }
    }
    const result = jsQR(pixels, side, side);
    expect(result).not.toBeNull();
    expect(codeFromScan(result!.data)).toBe("123456");
  });
});
