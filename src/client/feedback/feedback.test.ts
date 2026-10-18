import { afterEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_KEY, FEEDBACK_LIMITS } from "../../shared";
import { redactText, redactUrl, seconds, viewNow } from "./diagnostics";
import { buildPayload, detailsOf, fromDraft, hasContent, hasWords, newForm, toDraft, writtenByThePerson } from "./formState";
import { kindOfFile, newPictureId, plan, room, scaleToFit, type Piece } from "./images";
import { addReceipt, clearDraft, DRAFT_DAYS, forgetReceipt, newKey, readDraft, readReceipts, saveDraft } from "./receipts";
import { arrowHead, boxOf, isMark, paintShapes, toUnit, type Shape, type Surface } from "./shapes";

/** The browser's storage, as a map (the tests run in node, which has none). */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("what is left out of what a report says about the page", () => {
  const base = "https://kino.example/tv";

  it("keeps the path of this site and drops the query, the hash and ids", () => {
    expect(redactUrl("/watch?party=ABC123&token=secret#frag", base)).toBe("/watch");
    expect(redactUrl("/api/accounts/9f8e7d6c5b4a39281716/profile", base)).toBe("/api/accounts/:id/profile");
    expect(redactUrl("https://kino.example/tv?code=123456", base)).toBe("/tv");
  });

  it("keeps only the host of another site, and says nothing of a blob or data link", () => {
    expect(redactUrl("https://cdn.example.org/secret/path/file.m3u8?sig=abc", base)).toBe("cdn.example.org/…");
    expect(redactUrl("blob:https://kino.example/2d5f6a5e-1111", base)).toBe("blob:…");
    expect(redactUrl("data:text/plain;base64,AAAA", base)).toBe("data:…");
  });

  it("gives a name to an address that is not one", () => {
    expect(redactUrl("http://[not a url", base)).toBe("<link>");
  });

  it("takes links, emails, addresses and tokens out of a text", () => {
    const said = redactText("GET https://cdn.example.org/a/b?token=zzz failed for ann@example.com at 192.168.1.20 with 0123456789abcdefghijklmn12345");
    expect(said).not.toMatch(/token=|ann@|192\.168|0123456789abcdef/);
    expect(said).toContain("cdn.example.org/…");
    expect(said).toContain("<email>");
    expect(said).toContain("<ip>");
    expect(said).toContain("<token>");
  });

  it("leaves a plain sentence as it is", () => {
    expect(redactText("The button on the Settings page did nothing")).toBe("The button on the Settings page did nothing");
  });

  it("says how long ago each thing was, newest last, and no more than asked", () => {
    const ring = [
      { at: 1_000, text: "tap a" },
      { at: 8_000, text: "tap b" },
      { at: 9_500, text: "tap c" },
    ];
    expect(seconds(ring, 10_000, 2)).toEqual(["2s ago  tap b", "1s ago  tap c"]);
    expect(seconds([{ at: 20_000, text: "from the future" }], 10_000, 5)).toEqual(["0s ago  from the future"]);
  });

  it("finds the screen the person is on from what is on the page, the most particular first", () => {
    const has = (...found: string[]) => ({ querySelector: (selector: string) => (found.some((each) => selector.includes(each)) ? {} : null) }) as unknown as Document;
    expect(viewNow(has('[data-testid="tv"][data-state="error"]'))).toEqual({ id: "film that would not play", area: "wontplay" });
    expect(viewNow(has('[data-testid="tv-search"]', '[data-testid="tv-browse"]'))).toEqual({ id: "search", area: "search" });
    expect(viewNow(has('[data-testid="code-input"]'))).toEqual({ id: "pairing", area: "pairing" });
    expect(viewNow(has())).toBeUndefined();
  });
});

describe("the receipt and the draft", () => {
  it("makes a key the server takes, from 128 random bits", () => {
    const key = newKey((bytes) => bytes.forEach((_, index) => (bytes[index] = index * 17)));
    expect(FEEDBACK_KEY.test(key)).toBe(true);
    expect(key).toHaveLength(22);
    expect(key).toBe(newKey((bytes) => bytes.forEach((_, index) => (bytes[index] = index * 17)))); // (the same bits, the same key)
    expect(newKey()).not.toBe(newKey());
  });

  it("still makes a key when the browser cannot make random bits", () => {
    const key = newKey(() => {
      throw new Error("no crypto");
    });
    expect(FEEDBACK_KEY.test(key)).toBe(true);
  });

  it("keeps the receipts newest first, once each, and no more than 40", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    for (let i = 0; i < 45; i++) addReceipt({ key: newKey((bytes) => bytes.fill(i + 1)), id: String(i), title: `report ${i}`, kind: "bug", at: i });
    const kept = readReceipts();
    expect(kept).toHaveLength(40);
    expect(kept[0]?.id).toBe("44");
    const again = kept[0]!;
    addReceipt({ ...again, title: "changed" });
    expect(readReceipts()).toHaveLength(40);
    expect(readReceipts()[0]?.title).toBe("changed");
    forgetReceipt(again.key);
    expect(readReceipts().some((each) => each.key === again.key)).toBe(false);
  });

  it("ignores what is in storage that is not a receipt", () => {
    const storage = fakeStorage();
    storage.setItem("kino.feedback.receipts", JSON.stringify([{ key: "short", id: "1", title: "x" }, null, "text", { key: newKey(), id: "2", title: "fine", kind: "idea", at: 1 }]));
    vi.stubGlobal("localStorage", storage);
    expect(readReceipts().map((each) => each.id)).toEqual(["2"]);
    storage.setItem("kino.feedback.receipts", "{not json");
    expect(readReceipts()).toEqual([]);
  });

  it("keeps a draft of words only, and lets it go after two weeks", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    saveDraft({ kind: "bug", area: "player", text: "   ", details: {}, at: 1 });
    expect(readDraft(2)).toBeUndefined(); // (nothing written: nothing kept)
    saveDraft({ kind: "bug", area: "player", text: "It stopped", details: { steps: "x" }, severity: "annoying", at: 1_000 });
    expect(readDraft(2_000)).toMatchObject({ text: "It stopped", area: "player", severity: "annoying" });
    expect(readDraft(1_000 + DRAFT_DAYS * 86_400_000 + 1)).toBeUndefined();
    clearDraft();
    expect(readDraft(2_000)).toBeUndefined();
  });

  it("keeps a draft that has only an answer to one of the questions", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    saveDraft({ kind: "bug", area: "unsure", text: "", details: { expected: "to play" }, at: 5 });
    expect(readDraft(6)?.details).toEqual({ expected: "to play" });
  });
});

describe("the form", () => {
  it("is empty to begin with and has something to send once a word or a picture is on it", () => {
    const form = newForm("bug", "player", false);
    expect(hasContent(form, 0)).toBe(false);
    expect(hasContent(form, 1)).toBe(true);
    expect(hasContent({ ...form, text: " hello " }, 0)).toBe(true);
    expect(hasContent({ ...form, details: { steps: "press play" } }, 0)).toBe(true);
    expect(hasWords(form)).toBe(false);
    expect(hasWords({ ...form, details: { steps: "press play" } })).toBe(true);
  });

  it("sends only the questions its kind asks, trimmed", () => {
    const form = { ...newForm("improve", "home", true, "Text"), details: { current: "  a  ", better: "", steps: "left over from a bug" } };
    expect(detailsOf(form)).toEqual({ current: "a" });
    expect(detailsOf(newForm("idea", "unsure", false))).toBeUndefined();
  });

  it("builds what the server takes, with severity and frequency for a bug only", () => {
    const context = { build: "index-x" };
    const bug = { ...newForm("bug", "wontplay", true, "It does not play"), severity: "blocker" as const, frequency: "always" as const };
    expect(buildPayload(bug, newKey(), [], context)).toMatchObject({ kind: "bug", area: "wontplay", message: "It does not play", severity: "blocker", frequency: "always", answer: true, attachments: [], context });
    const idea = { ...newForm("idea", "party", true, "A thing"), severity: "blocker" as const, frequency: "always" as const };
    const sent = buildPayload(idea, newKey(), [], {});
    expect(sent).not.toHaveProperty("severity");
    expect(sent).not.toHaveProperty("frequency");
    expect(buildPayload({ ...idea, answer: false }, newKey(), [], {}).answer).toBe(false);
  });

  it("goes to a draft and comes back as it was", () => {
    const form = { ...newForm("bug", "search", true, "words"), details: { actual: "nothing" }, severity: "annoying" as const };
    const back = fromDraft(toDraft(form, 5));
    expect(back).toMatchObject({ kind: "bug", area: "search", areaChosen: true, text: "words", details: { actual: "nothing" }, severity: "annoying", answer: true });
  });

  it("cuts a long text to what the server takes", () => {
    const sent = buildPayload(newForm("other", "unsure", false, "x".repeat(FEEDBACK_LIMITS.text + 500)), newKey(), [], {});
    expect(sent.message.length).toBeLessThanOrEqual(FEEDBACK_LIMITS.text);
  });

  it("counts the words a screen gave a form as the person's own only once they have changed them", () => {
    const seed = "It would not play. The screen said: Something went wrong.";
    const form = newForm("bug", "wontplay", true, seed);
    expect(writtenByThePerson(form, seed)).toBe(false); // (as it opens, or with the spaces changed)
    expect(writtenByThePerson({ ...form, text: `  ${seed} ` }, seed)).toBe(false);
    expect(writtenByThePerson({ ...form, text: "" }, seed)).toBe(false); // (the words were taken off: nothing was written)
    expect(writtenByThePerson({ ...form, text: `${seed} It happens on every film.` }, seed)).toBe(true);
    expect(writtenByThePerson({ ...form, details: { steps: "pressed play" } }, seed)).toBe(true);
    expect(writtenByThePerson(newForm("bug", "wontplay", true, ""), "")).toBe(false);
  });
});

describe("the pictures", () => {
  const piece = (over: Omit<Partial<Piece>, "marked"> & { size?: number; marked?: number }): Piece => {
    const blob = new Blob([new Uint8Array(over.size ?? 1000)], { type: "image/png" });
    const marked = over.marked ? { blob: new Blob([new Uint8Array(over.marked)], { type: "image/png" }), mime: "image/png" as const, width: 10, height: 10 } : undefined;
    return {
      id: newPictureId(),
      name: "screen.png",
      role: "screenshot",
      mime: "image/png",
      blob,
      shapes: [],
      note: "",
      url: "blob:x",
      width: 100,
      height: 200,
      ...over,
      marked,
    } as Piece;
  };
  const circle: Shape = { kind: "circle", from: [0.1, 0.1], to: [0.5, 0.5], color: "#ff3b30", size: 1 };
  const cover: Shape = { kind: "hide", from: [0.1, 0.1], to: [0.5, 0.5], color: "#ff3b30", size: 1 };

  it("makes a picture fit in 2000 pixels without changing its shape", () => {
    expect(scaleToFit(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(scaleToFit(1000, 500)).toEqual({ width: 1000, height: 500 });
    expect(scaleToFit(0, 0)).toEqual({ width: 1, height: 1 });
  });

  it("names a picture with ten letters and numbers", () => {
    expect(newPictureId()).toMatch(/^[a-z0-9]{10}$/);
    expect(newPictureId(() => 0)).toBe("aaaaaaaaaa");
  });

  it("knows what a file is by its type, or by its name when the type is missing", () => {
    expect(kindOfFile("a.png", "image/png")).toBe("image");
    expect(kindOfFile("photo.HEIC", "")).toBe("image");
    expect(kindOfFile("log.txt", "text/plain")).toBe("text");
    expect(kindOfFile("session.har", "")).toBe("text");
    expect(kindOfFile("data.json", "")).toBe("json");
    expect(kindOfFile("data", "application/json")).toBe("json");
    expect(kindOfFile("movie.mkv", "video/x-matroska")).toBe("other");
  });

  it("sends a marked picture as annotated, with the plain one behind it", () => {
    const { items, dropped } = plan([piece({ shapes: [circle], marked: 500 })]);
    expect(items.map((each) => [each.role, each.name])).toEqual([
      ["annotated", "screen.png"],
      ["screenshot", "original-screen.png"],
    ]);
    expect(dropped).toBe(0);
  });

  it("sends a picture that was not marked as it is, once", () => {
    const { items } = plan([piece({}), piece({ role: "photo", name: "photo.jpg" })]);
    expect(items.map((each) => each.role)).toEqual(["screenshot", "photo"]);
  });

  it("never sends the plain picture behind something that was covered", () => {
    const { items } = plan([piece({ shapes: [cover], marked: 500 })]);
    expect(items.map((each) => each.role)).toEqual(["annotated"]);
  });

  it("sends nothing of a covered picture whose marked copy could not be made", () => {
    expect(plan([piece({ shapes: [cover] })]).items).toEqual([]);
  });

  it("leaves out the plain pictures behind marks first when there is no room, and says how many", () => {
    const pieces = [piece({ shapes: [circle], marked: 600, size: 600 }), piece({ shapes: [circle], marked: 600, size: 600 })];
    const { items, dropped, bytes } = plan(pieces, 8, 1800); // (room for the two marked ones and one plain one)
    expect(items.map((each) => each.role)).toEqual(["annotated", "annotated", "screenshot"]);
    expect(dropped).toBe(1);
    expect(bytes).toBe(1800);
    expect(plan(pieces, 3, 99999).items).toHaveLength(3);
  });

  it("knows whether one more piece fits, counting what would really be sent", () => {
    expect(room([], 1000)).toBe(true);
    expect(room([], FEEDBACK_LIMITS.totalBytes)).toBe(false);
    const full = Array.from({ length: FEEDBACK_LIMITS.attachments }, () => piece({ size: 10 }));
    expect(room(full, 1)).toBe(false);
    // (a marked picture counts as what is sent for it, not as its plain original, which goes only if there is room)
    expect(room([piece({ size: 5_000_000, shapes: [circle], marked: 100 })], 5_000_000)).toBe(true);
  });
});

describe("the marks", () => {
  it("turns a point of the screen into a place on the picture, kept inside it", () => {
    const box = { left: 100, top: 50, width: 200, height: 100 };
    expect(toUnit(200, 100, box)).toEqual([0.5, 0.5]);
    expect(toUnit(0, 0, box)).toEqual([0, 0]);
    expect(toUnit(900, 900, box)).toEqual([1, 1]);
    expect(toUnit(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual([1, 1]); // (a box with no size does not divide by zero)
  });

  it("does not take a tap that went nowhere for a mark", () => {
    const tap: Shape = { kind: "circle", from: [0.5, 0.5], to: [0.5, 0.5], color: "#ff3b30", size: 1 };
    const drag: Shape = { kind: "circle", from: [0.2, 0.2], to: [0.6, 0.6], color: "#ff3b30", size: 1 };
    expect(isMark(tap, 400, 800)).toBe(false);
    expect(isMark(drag, 400, 800)).toBe(true);
    expect(isMark({ kind: "draw", points: [[0.5, 0.5]], color: "#ff3b30", size: 0 }, 400, 800)).toBe(false);
    expect(isMark({ kind: "draw", points: [[0.5, 0.5], [0.7, 0.5]], color: "#ff3b30", size: 0 }, 400, 800)).toBe(true);
    expect(isMark({ kind: "text", at: [0.1, 0.1], text: "  ", color: "#ff3b30", size: 1 }, 400, 800)).toBe(false);
    expect(isMark({ kind: "text", at: [0.1, 0.1], text: "here", color: "#ff3b30", size: 1 }, 400, 800)).toBe(true);
  });

  it("makes the same box whichever way it was dragged", () => {
    const expected = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    expect(boxOf([0.75, 0.25], [0.25, 0.75])).toEqual(expected);
    expect(boxOf([0.25, 0.75], [0.75, 0.25])).toEqual(expected);
    expect(boxOf([0.25, 0.25], [0.75, 0.75])).toEqual(expected);
  });

  it("puts the head of an arrow behind its tip", () => {
    const [a, b] = arrowHead([0, 0], [100, 0], 10);
    expect(a[0]).toBeLessThan(100);
    expect(b[0]).toBeLessThan(100);
    expect(a[1]).toBeCloseTo(-b[1]);
    expect(Math.hypot(a[0] - 100, a[1])).toBeCloseTo(10);
  });

  /** A canvas that writes down what it was asked to draw. */
  function recorder() {
    const calls: string[] = [];
    const surface = {
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      beginPath: () => calls.push("beginPath"),
      moveTo: (x: number, y: number) => calls.push(`moveTo ${Math.round(x)},${Math.round(y)}`),
      lineTo: (x: number, y: number) => calls.push(`lineTo ${Math.round(x)},${Math.round(y)}`),
      ellipse: (x: number, y: number, rx: number, ry: number) => calls.push(`ellipse ${Math.round(x)},${Math.round(y)} ${Math.round(rx)}x${Math.round(ry)}`),
      rect: (x: number, y: number, w: number, h: number) => calls.push(`rect ${Math.round(x)},${Math.round(y)} ${Math.round(w)}x${Math.round(h)}`),
      fillRect: (x: number, y: number, w: number, h: number) => calls.push(`fillRect ${Math.round(x)},${Math.round(y)} ${Math.round(w)}x${Math.round(h)} ${surface.fillStyle}`),
      stroke: () => calls.push(`stroke ${surface.strokeStyle} ${Math.round(surface.lineWidth * 10) / 10}`),
      fill: () => calls.push("fill"),
      strokeText: (text: string) => calls.push(`strokeText ${text}`),
      fillText: (text: string) => calls.push(`fillText ${text}`),
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      strokeStyle: "#000",
      fillStyle: "#000",
      font: "",
      textBaseline: "alphabetic",
    } as unknown as Surface;
    return { surface, calls };
  }

  it("draws a circle round the box that was dragged, at the picture's size", () => {
    const { surface, calls } = recorder();
    paintShapes(surface, [{ kind: "circle", from: [0.2, 0.25], to: [0.6, 0.75], color: "#ff3b30", size: 1 }], 1000, 2000);
    expect(calls).toContain("ellipse 400,1000 200x500");
    expect(calls.some((each) => each.startsWith("stroke #ff3b30"))).toBe(true);
  });

  it("covers with a block that is not see-through, and strokes nothing round it", () => {
    const { surface, calls } = recorder();
    paintShapes(surface, [{ kind: "hide", from: [0.6, 0.5], to: [0.1, 0.1], color: "#ff3b30", size: 0 }], 100, 100);
    expect(calls).toContain("fillRect 10,10 50x40 #101012");
    expect(calls.some((each) => each.startsWith("stroke"))).toBe(false);
  });

  it("writes a word with an outline, a line at a time", () => {
    const { surface, calls } = recorder();
    paintShapes(surface, [{ kind: "text", at: [0.1, 0.1], text: "one\ntwo", color: "#ffffff", size: 1 }], 400, 800);
    expect(calls.filter((each) => each.startsWith("fillText"))).toEqual(["fillText one", "fillText two"]);
    expect(calls.filter((each) => each.startsWith("strokeText"))).toHaveLength(2);
  });

  it("draws a line by hand through its points, an arrow with a head, and a dot that shows", () => {
    const { surface, calls } = recorder();
    paintShapes(surface, [{ kind: "draw", points: [[0, 0], [0.5, 0.5], [1, 0]], color: "#0a84ff", size: 0 }], 100, 100);
    expect(calls).toEqual(expect.arrayContaining(["moveTo 0,0", "lineTo 50,50", "lineTo 100,0"]));
    const arrow = recorder();
    paintShapes(arrow.surface, [{ kind: "arrow", from: [0.1, 0.1], to: [0.9, 0.9], color: "#ff3b30", size: 2 }], 100, 100);
    expect(arrow.calls.filter((each) => each.startsWith("moveTo"))).toHaveLength(2);
    const dot = recorder();
    paintShapes(dot.surface, [{ kind: "draw", points: [[0.5, 0.5]], color: "#ff3b30", size: 0 }], 100, 100);
    expect(dot.calls).toEqual(expect.arrayContaining(["moveTo 50,50", "lineTo 50,50"]));
  });

  it("keeps a line from being thinner than two pixels, and leaves the surface as it found it", () => {
    const { surface, calls } = recorder();
    paintShapes(surface, [{ kind: "box", from: [0.1, 0.1], to: [0.2, 0.2], color: "#34c759", size: 0 }], 100, 100);
    expect(calls.find((each) => each.startsWith("stroke"))).toBe("stroke #34c759 2");
    expect(calls[0]).toBe("save");
    expect(calls[calls.length - 1]).toBe("restore");
  });
});
