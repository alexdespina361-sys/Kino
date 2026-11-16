import { describe, expect, it } from "vitest";
import { halfToFloat, layoutOf, padded, readPlanes, writePlanes } from "./rife";

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

  it("knows the layouts of the RIFE exports it fills, and refuses any other", () => {
    expect(layoutOf([{ name: "input", shape: ["batch", 7, "height", "width"] }])).toEqual({ kind: "seven", input: "input" });
    expect(
      layoutOf([
        { name: "input", shape: ["batch_size", 6, "height", "width"] },
        { name: "timestep", shape: ["batch_size", 1, 1, 1] },
      ]),
    ).toEqual({ kind: "six", input: "input", moment: { name: "timestep", shape: "four" } });
    expect(
      layoutOf([
        { name: "img0", shape: [1, 3, "h", "w"] },
        { name: "img1", shape: [1, 3, "h", "w"] },
        { name: "timestep", shape: [1, 1, 1, 1] },
      ]),
    ).toEqual({ kind: "three", first: "img0", second: "img1", moment: { name: "timestep", shape: "four" } });
    expect(layoutOf([{ name: "img0", shape: [1, 3, "h", "w"] }, { name: "img1", shape: [1, 3, "h", "w"] }, { name: "timestep", shape: [1] }]).kind).toBe("three");
    // (vs-mlrt's first layout: 11 channels, with grids the page does not make; and an export with extra inputs)
    expect(() => layoutOf([{ name: "input", shape: [1, 11, "h", "w"] }])).toThrow(/not a layout/);
    expect(() =>
      layoutOf([
        { name: "img0", shape: [1, 3, "h", "w"] },
        { name: "img1", shape: [1, 3, "h", "w"] },
        { name: "timestep", shape: [1, 1, 1, 1] },
        { name: "tenFlow_div", shape: [2] },
      ]),
    ).toThrow(/not a layout/);
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
