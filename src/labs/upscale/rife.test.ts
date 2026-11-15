import { describe, expect, it } from "vitest";
import { halfToFloat, padded, readPlanes, writePlanes } from "./rife";

describe("RIFE's pictures in and out", () => {
  it("pads to the network's step", () => {
    expect(padded(854, 64)).toBe(896);
    expect(padded(356, 64)).toBe(384);
    expect(padded(640, 32)).toBe(640);
  });

  it("writes red, green and blue as planes (0..1), repeats the last row and column into the padding, and reads them back", () => {
    // A 3 x 2 picture: each pixel's red = 10 * (its number), green = red + 1, blue = red + 2.
    const data = new Uint8ClampedArray(3 * 2 * 4);
    for (let index = 0; index < 6; index++) data.set([10 * index, 10 * index + 1, 10 * index + 2, 255], index * 4);
    const [width, height] = [4, 4];
    const planes = new Float32Array(7 * width * height);
    writePlanes({ data, width: 3, height: 2 }, planes, 3, width, height);
    const red = (x: number, y: number) => planes[3 * width * height + y * width + x]! * 255;
    expect(red(0, 0)).toBeCloseTo(0, 4);
    expect(red(2, 1)).toBeCloseTo(50, 4);
    expect(red(3, 1)).toBeCloseTo(50, 4); // (the last column repeated)
    expect(red(1, 3)).toBeCloseTo(40, 4); // (the last row repeated)
    expect(planes[0]).toBe(0); // (channels before `first` left alone)
    const back = readPlanes(planes.subarray(3 * width * height, 6 * width * height), 3, 2, width, height);
    expect([...back]).toEqual([...data]);
  });

  it("reads 16-bit floats", () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0x3800)).toBe(0.5);
    expect(halfToFloat(0x0000)).toBe(0);
    expect(halfToFloat(0xc000)).toBe(-2);
    const back = readPlanes(new Uint16Array([0x3c00, 0x3800, 0x0000]), 1, 1, 1, 1);
    expect([...back]).toEqual([255, 128, 0, 255]);
  });
});
