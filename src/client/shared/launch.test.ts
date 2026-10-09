import { describe, expect, it } from "vitest";
import { firstLink, readLaunchParams } from "./launch";

describe("readLaunchParams", () => {
  it("reads a pairing code from the TV's QR code", () => {
    expect(readLaunchParams("?code=482731")).toEqual({ code: "482731" });
  });

  it("ignores a code that isn't exactly six digits", () => {
    expect(readLaunchParams("?code=48273")).toEqual({});
    expect(readLaunchParams("?code=4827310")).toEqual({});
    expect(readLaunchParams("?code=abcdef")).toEqual({});
  });

  it("reads a shared link from `url`", () => {
    expect(readLaunchParams("?url=https%3A%2F%2Fsite.example%2Fwatch%2F1")).toEqual({ url: "https://site.example/watch/1" });
  });

  it("finds the link inside shared `text`, as most apps share it", () => {
    const text = encodeURIComponent("Look at this https://site.example/watch/1?x=2&y=3, so good!");
    expect(readLaunchParams(`?title=Hi&text=${text}`)).toEqual({ url: "https://site.example/watch/1?x=2&y=3" });
  });

  it("prefers `url`, and only ever returns http(s) links", () => {
    expect(readLaunchParams("?url=https%3A%2F%2Fa.example%2F&text=https%3A%2F%2Fb.example%2F")).toEqual({ url: "https://a.example/" });
    expect(readLaunchParams("?url=javascript%3Aalert(1)")).toEqual({});
    expect(readLaunchParams("?text=file%3A%2F%2F%2Fetc%2Fpasswd")).toEqual({});
  });

  it("returns nothing for a plain visit", () => {
    expect(readLaunchParams("")).toEqual({});
    expect(readLaunchParams("?debug=0")).toEqual({});
  });
});

describe("firstLink", () => {
  it("strips trailing punctuation but keeps the rest of the URL", () => {
    expect(firstLink("see https://a.example/x_(1). ok")).toBe("https://a.example/x_(1)");
    expect(firstLink("(see https://a.example/page)")).toBe("https://a.example/page");
    expect(firstLink("https://a.example/page?x=1.")).toBe("https://a.example/page?x=1");
    expect(firstLink("nothing here")).toBeUndefined();
  });
});
