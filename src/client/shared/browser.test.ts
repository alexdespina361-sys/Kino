import { describe, expect, it } from "vitest";
import { isHisense } from "./browser";

describe("isHisense", () => {
  it("knows a VIDAA set, whatever else its browser says", () => {
    expect(isHisense("Mozilla/5.0 (Linux; U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0 Safari/537.36 VIDAA/6.0")).toBe(true);
    expect(isHisense("Mozilla/5.0 (Linux; Vidaa; Hisense) AppleWebKit/537.36 Chrome/76.0 Safari/537.36")).toBe(true);
  });

  it("knows Hisense's browser by its name", () => {
    expect(isHisense("Mozilla/5.0 (Linux; HISENSE 4K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0 Safari/537.36")).toBe(true);
    expect(isHisense("Mozilla/5.0 (Linux) AppleWebKit/537.36 Chrome/94.0 Safari/537.36 HiBrowser/1.0")).toBe(true);
    expect(isHisense("Mozilla/5.0 (Linux) AppleWebKit/537.36 Chrome/94.0 Safari/537.36 Hi Browser/1.0")).toBe(true);
  });

  it("leaves a Hisense phone and every other browser alone", () => {
    expect(isHisense("Mozilla/5.0 (Linux; Android 11; HISENSE F50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36")).toBe(false);
    expect(isHisense("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36")).toBe(false);
    expect(isHisense("Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36")).toBe(false);
    expect(isHisense("")).toBe(false);
  });
});
