import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseHooks, passFragment, passSizes, sizeExpression } from "./fsrcnnx";

const shader = (name: string): string => readFileSync(path.resolve(import.meta.dirname, "../../../public/labs/upscale/fsrcnnx", name), "utf8");

describe("the Film modes' reader of mpv user shaders (FSRCNNX)", () => {
  it("reads FSRCNNX 8-0-4-1 as mpv does: 14 passes on LUMA, the last one twice as big and saved as LUMA", () => {
    const passes = parseHooks(shader("FSRCNNX_x2_8-0-4-1.glsl"));
    expect(passes).toHaveLength(14);
    expect(passes.every((pass) => pass.hook === "LUMA")).toBe(true);
    expect(passes[0]).toMatchObject({ desc: "feature map 1", binds: ["LUMA"], save: "FEATURE1" });
    expect(passes[2]).toMatchObject({ desc: "mapping 1_1", binds: ["FEATURE1", "FEATURE2"], save: "MODEL21" });
    expect(passes.at(-1)).toMatchObject({ desc: "aggregation", binds: ["SUBCONV1"], save: "LUMA", width: "LUMA.w 2 *", height: "LUMA.h 2 *" });
    const sizes = passSizes(passes, { width: 854, height: 480 });
    expect(sizes.slice(0, -1).every((size) => size.width === 854 && size.height === 480)).toBe(true);
    expect(sizes.at(-1)).toEqual({ width: 1708, height: 960 });
  });

  it("reads FSRCNNX 16-0-4-1 too (26 passes, up to five inputs a pass)", () => {
    const passes = parseHooks(shader("FSRCNNX_x2_16-0-4-1.glsl"));
    expect(passes).toHaveLength(26);
    expect(Math.max(...passes.map((pass) => pass.binds.length))).toBe(5);
    expect(passSizes(passes, { width: 640, height: 266 }).at(-1)).toEqual({ width: 1280, height: 532 });
  });

  it("works out mpv's sizes (reverse Polish) and refuses what it does not know", () => {
    const sizes = new Map([["LUMA", { width: 854, height: 480 }]]);
    expect(sizeExpression("LUMA.w 2 *", sizes)).toBe(1708);
    expect(sizeExpression("LUMA.h 3 * 2 /", sizes)).toBe(720);
    expect(() => sizeExpression("OUTPUT.w", sizes)).toThrow(/not known yet/);
    expect(() => sizeExpression("LUMA.w *", sizes)).toThrow(/not a size/);
    expect(() => parseHooks("//!HOOK LUMA\n//!SAVE X\n//!UNKNOWN 1\nvec4 hook() { return vec4(0); }")).toThrow(/does not know/);
    expect(() => parseHooks("//!HOOK LUMA\n//!SAVE X\nvec4 nothing() { return vec4(0); }")).toThrow(/has no hook/);
  });

  it("gives each pass mpv's names: the video's frame as luma for LUMA, the pass's own textures as they are", () => {
    const [feature, , mapping] = parseHooks(shader("FSRCNNX_x2_8-0-4-1.glsl"));
    const first = passFragment(feature!);
    expect(first).toContain("#define LUMA_tex(pos) vec4(dot(texture(LUMA_raw, pos).rgb, vec3(0.299, 0.587, 0.114)), 0.0, 0.0, 1.0)");
    expect(first).toContain("#define LUMA_texOff(off) LUMA_tex(LUMA_pos + LUMA_pt * vec2(off))");
    expect(first).toMatch(/void main\(\) \{\n {2}fragColor = hook\(\);\n\}$/);
    expect(passFragment(mapping!)).toContain("#define FEATURE2_tex(pos) texture(FEATURE2_raw, pos)");
  });
});
