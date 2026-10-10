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
});
