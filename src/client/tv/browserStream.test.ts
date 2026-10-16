import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_STREAM_TIMEOUT_MS, prepareBrowserStream } from "./browserStream";

const raw = "https://farragoandfulcrum.website/pl/movie/master.m3u8?token=website-token";
const fresh = raw.replace("website-token", "viewer-token");
let ready: boolean;
let browser: EventTarget & { postMessage: ReturnType<typeof vi.fn> };

beforeEach(() => {
  ready = true;
  browser = Object.assign(new EventTarget(), { postMessage: vi.fn() });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("location", new URL("https://kino.24-7.ro/tv"));
  vi.stubGlobal("document", { documentElement: { getAttribute: () => ready ? "1" : null } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const answer = (value: object, origin = location.origin, source: unknown = browser) => {
  const request = browser.postMessage.mock.calls[0]![0];
  browser.dispatchEvent(Object.assign(new Event("message"), { source, origin, data: { channel: "kino-direct", type: "prepared", id: request.id, ...value } }));
};

describe("direct playback through the browser extension", () => {
  it("leaves playback unchanged when the extension is absent or the source is unsupported", () => {
    ready = false;
    expect(prepareBrowserStream(raw)).toBeUndefined();
    ready = true;
    for (const url of ["https://other.example/pl/master.m3u8", "http://farragoandfulcrum.website/pl/a.m3u8", "https://farragoandfulcrum.website/private", "https://user:pass@farragoandfulcrum.website/pl/a.m3u8"]) {
      expect(prepareBrowserStream(url)).toBeUndefined();
    }
    expect(browser.postMessage).not.toHaveBeenCalled();
  });

  it("ignores messages from another window or origin before accepting a matching token response", async () => {
    const pending = prepareBrowserStream(raw)!;
    answer({ url: fresh }, "https://other.example");
    answer({ url: fresh }, location.origin, {});
    answer({ url: fresh });
    expect(await pending).toBe(fresh);
    expect(browser.postMessage.mock.calls[0]![1]).toBe(location.origin);
  });

  it.each(["https://other.example/pl/movie/master.m3u8?token=x", "https://farragoandfulcrum.website/pl/another/master.m3u8?token=x", raw.replace("?token=website-token", "")])("refuses a substituted source: %s", async (url) => {
    const pending = prepareBrowserStream(raw)!;
    answer({ url });
    await expect(pending).rejects.toThrow("Invalid extension response");
  });

  it("reports an unavailable extension instead of leaving playback loading indefinitely", async () => {
    vi.useFakeTimers();
    const pending = prepareBrowserStream(raw)!;
    const rejection = expect(pending).rejects.toThrow("did not respond");
    await vi.advanceTimersByTimeAsync(BROWSER_STREAM_TIMEOUT_MS);
    await rejection;
  });

  it("preserves the provider error without returning an old server-issued token", async () => {
    const pending = prepareBrowserStream(raw)!;
    answer({ error: "Video provider returned HTTP 403" });
    await expect(pending).rejects.toThrow("HTTP 403");
  });
});
