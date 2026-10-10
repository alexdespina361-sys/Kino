import { describe, expect, it } from "vitest";
import { actionForKey } from "./keys";

describe("actionForKey", () => {
  it.each([
    [{ key: "ArrowLeft" }, "left"],
    [{ key: "ArrowDown" }, "down"],
    [{ key: "Enter" }, "select"],
    [{ key: " " }, "playpause"],
    [{ key: "MediaPlayPause" }, "playpause"],
    [{ key: "MediaRewind" }, "rewind"],
    [{ key: "MediaFastForward" }, "forward"],
    [{ key: "MediaTrackNext" }, "next"],
    [{ key: "MediaTrackPrevious" }, "previous"],
    [{ key: "p" }, "previous"],
    [{ key: "MediaStop" }, "stop"],
    [{ key: "Escape" }, "back"],
    [{ key: "Backspace" }, "back"],
    [{ key: "GoBack" }, "back"],
    [{ key: "c" }, "captions"],
    [{ key: "F" }, "fullscreen"],
    [{ key: "m" }, "mute"],
    [{ key: "M" }, "mute"],
  ] as const)("%j means %s", (event, action) => {
    expect(actionForKey(event)).toBe(action);
  });

  it("falls back to Android TV key codes when `key` says nothing useful", () => {
    expect(actionForKey({ key: "Unidentified", keyCode: 4 })).toBe("back");
    expect(actionForKey({ key: "Unidentified", keyCode: 89 })).toBe("rewind");
    expect(actionForKey({ key: "Unidentified", keyCode: 90 })).toBe("forward");
    expect(actionForKey({ key: "Unidentified", keyCode: 85 })).toBe("playpause");
    expect(actionForKey({ key: "Unidentified", keyCode: 176 })).toBe("next");
    expect(actionForKey({ key: "Unidentified", keyCode: 177 })).toBe("previous");
  });

  it("ignores everything else, so the browser keeps its own shortcuts", () => {
    expect(actionForKey({ key: "a" })).toBeNull();
    expect(actionForKey({ key: "F5", keyCode: 116 })).toBeNull();
    expect(actionForKey({ key: "Tab", keyCode: 9 })).toBeNull();
  });

  describe("in a text field", () => {
    const field = { tagName: "INPUT", type: "email" } as unknown as EventTarget;

    it("leaves letters, Space, Backspace and the sideways arrows to the typing", () => {
      for (const key of ["b", "c", "f", "m", "n", "p", "s", " ", "Backspace", "ArrowLeft", "ArrowRight"]) expect(actionForKey({ key, target: field })).toBeNull();
      expect(actionForKey({ key: "Unidentified", keyCode: 8, target: field })).toBeNull();
    });

    it("keeps what moves between fields and leaves the screen", () => {
      expect(actionForKey({ key: "ArrowUp", target: field })).toBe("up");
      expect(actionForKey({ key: "ArrowDown", target: field })).toBe("down");
      expect(actionForKey({ key: "Enter", target: field })).toBe("select");
      expect(actionForKey({ key: "Escape", target: field })).toBe("back");
      expect(actionForKey({ key: "GoBack", target: field })).toBe("back");
    });

    it("is only about fields that take text", () => {
      expect(actionForKey({ key: "b", target: { tagName: "BUTTON" } as unknown as EventTarget })).toBe("browse");
      expect(actionForKey({ key: " ", target: { tagName: "INPUT", type: "checkbox" } as unknown as EventTarget })).toBe("playpause");
      expect(actionForKey({ key: "n", target: { tagName: "TEXTAREA" } as unknown as EventTarget })).toBeNull();
      expect(actionForKey({ key: "n", target: { tagName: "DIV", isContentEditable: true } as unknown as EventTarget })).toBeNull();
      expect(actionForKey({ key: "b", target: null })).toBe("browse");
    });
  });
});
