import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

/** A page with just enough of a document for the hidden field: what was made, and where the focus went. */
function fakeDocument(copied: boolean | "throws") {
  const field = { value: "", style: {} as Record<string, string>, setAttribute: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn(), remove: vi.fn() };
  const button = { focus: vi.fn() };
  const doc = {
    activeElement: button,
    body: { appendChild: vi.fn() },
    createElement: vi.fn(() => field),
    execCommand: vi.fn(() => {
      if (copied === "throws") throw new Error("not allowed");
      return copied;
    }),
  };
  vi.stubGlobal("document", doc);
  return { doc, field, button };
}

describe("copyText", () => {
  it("writes to the clipboard where the page has one, and touches nothing else", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { doc } = fakeDocument(true);
    expect(await copyText("https://kino.example/?party=123456")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://kino.example/?party=123456");
    expect(doc.createElement).not.toHaveBeenCalled();
  });

  it("copies from a hidden field when the page has no clipboard, and hands the focus back to the button the remote was on", async () => {
    vi.stubGlobal("navigator", {});
    const { doc, field, button } = fakeDocument(true);
    expect(await copyText("the link")).toBe(true);
    expect(field.value).toBe("the link");
    expect(field.select).toHaveBeenCalled();
    expect(doc.execCommand).toHaveBeenCalledWith("copy");
    expect(field.remove).toHaveBeenCalled();
    expect(button.focus).toHaveBeenCalled();
  });

  it("tries the hidden field too when the clipboard refuses", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const { doc } = fakeDocument(true);
    expect(await copyText("the link")).toBe(true);
    expect(doc.execCommand).toHaveBeenCalledWith("copy");
  });

  it("says no when nothing would copy, and still puts the focus back", async () => {
    vi.stubGlobal("navigator", {});
    const refused = fakeDocument(false);
    expect(await copyText("the link")).toBe(false);
    expect(refused.button.focus).toHaveBeenCalled();

    const thrown = fakeDocument("throws");
    expect(await copyText("the link")).toBe(false);
    expect(thrown.field.remove).toHaveBeenCalled();
    expect(thrown.button.focus).toHaveBeenCalled();
  });
});
