import { describe, expect, it } from "vitest";
import { controlLink, firstLink, linkCodeOf, pairLink, partyLink, readLaunchParams, readPartyCode, typedLinkCode } from "./launch";

describe("readLaunchParams", () => {
  it("reads a pairing code from the TV's QR code", () => {
    expect(readLaunchParams("?code=482731")).toEqual({ code: "482731" });
  });

  it("ignores a code that isn't exactly six digits", () => {
    expect(readLaunchParams("?code=48273")).toEqual({});
    expect(readLaunchParams("?code=4827310")).toEqual({});
    expect(readLaunchParams("?code=abcdef")).toEqual({});
  });

  it("reads the code of a TV's sign-in screen, however it was written", () => {
    expect(readLaunchParams("?link=ABCD2345")).toEqual({ link: "ABCD2345" });
    expect(readLaunchParams("?link=abcd-2345")).toEqual({ link: "ABCD2345" });
    expect(readLaunchParams("?link=ABCD234")).toEqual({});
    expect(readLaunchParams("?link=ABCD0123")).toEqual({}); // 0 and 1 are not in the alphabet
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

describe("typedLinkCode", () => {
  it("tidies a sign-in code as it is typed: upper case, no stray characters, a dash after the fourth", () => {
    expect(typedLinkCode("ab")).toBe("AB");
    expect(typedLinkCode("abcd")).toBe("ABCD");
    expect(typedLinkCode("abcd23")).toBe("ABCD-23");
    expect(typedLinkCode(" abcd - 2345 ")).toBe("ABCD-2345");
    expect(typedLinkCode("abcd23456789")).toBe("ABCD-2345"); // nothing past eight
    expect(typedLinkCode("")).toBe("");
  });

  it("leads to a code only once all eight characters are there", () => {
    expect(linkCodeOf(typedLinkCode("abcd234"))).toBeUndefined();
    expect(linkCodeOf(typedLinkCode("abcd2345"))).toBe("ABCD2345");
  });
});

describe("the link that connects a phone", () => {
  it("carries the code, and the phone page reads it back", () => {
    const link = pairLink("482731", "https://kino.example");
    expect(link).toBe("https://kino.example/?code=482731");
    expect(readLaunchParams(new URL(link).search)).toEqual({ code: "482731" });
  });
});

describe("the link that lets another phone in", () => {
  it("carries the code of a TV that has a phone, and reads it back apart from a pairing code", () => {
    const link = controlLink("482731", "https://kino.example");
    expect(link).toBe("https://kino.example/?control=482731");
    expect(readLaunchParams(new URL(link).search)).toEqual({ control: "482731" });
    expect(readLaunchParams("?control=48273")).toEqual({});
    expect(readLaunchParams("?control=abcdef")).toEqual({});
  });
});

describe("the link of a watch party", () => {
  it("carries the code, and reads it back", () => {
    const link = partyLink("482731", "https://kino.example");
    expect(link).toBe("https://kino.example/?party=482731");
    expect(readPartyCode(new URL(link).search)).toBe("482731");
  });

  it("takes a code that was spaced out, and ignores anything that is not six digits", () => {
    expect(readPartyCode("?party=482%20731")).toBe("482731");
    expect(readPartyCode("?party=48273")).toBeNull();
    expect(readPartyCode("?party=")).toBeNull();
    expect(readPartyCode("")).toBeNull();
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
