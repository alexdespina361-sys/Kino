import { afterEach, describe, expect, it } from "vitest";
import { CAPTION_SETTINGS, CAPTION_VALUES, MAX_FOLLOWERS, type ResolveStatus } from "../../shared";
import { setLanguage } from "../i18n";
import { captionLabel, captionTitle, friendlyError, noticeText, resolveFailure, socketError, statusWords, trackName } from "./words";

const LANGUAGES = ["en", "ro", "it"] as const;
afterEach(() => setLanguage("en", false));

describe("caption words", () => {
  for (const language of LANGUAGES) {
    it(`${language} names every subtitle setting and every choice`, () => {
      setLanguage(language, false);
      for (const setting of CAPTION_SETTINGS) {
        expect(captionTitle(setting), setting).not.toMatch(/^caption\./);
        for (const value of CAPTION_VALUES[setting]) {
          expect(captionLabel(setting, value as never), `${setting} ${value}`).not.toMatch(/^caption\./);
        }
      }
    });
  }

  it("says percentages as they are and the two ends of the background as words", () => {
    setLanguage("ro", false);
    expect(captionLabel("textOpacity", "75")).toBe("75%");
    expect(captionLabel("background", "25")).toBe("25%");
    expect(captionLabel("background", "0")).toBe("Fără");
    expect(captionLabel("edge", "none")).toBe("Fără");
  });
});

describe("trackName", () => {
  it("numbers a track that says nothing about itself, in the language of the page", () => {
    expect(trackName({ label: "Subtitle 3" })).toBe("Subtitle 3");
    setLanguage("ro", false);
    expect(trackName({ label: "Subtitle 3" })).toBe("Subtitrarea 3");
    expect(trackName({ label: "Audio 2" })).toBe("Audio 2");
    setLanguage("it", false);
    expect(trackName({ label: "Subtitle 3" })).toBe("Sottotitoli 3");
  });

  it("says a track named only by its language in the language of the page", () => {
    setLanguage("ro", false);
    expect(trackName({ label: "English", lang: "en" })).toBe("Engleză");
    expect(trackName({ label: "English (SDH)", lang: "en" })).toBe("English (SDH)");
  });
});

describe("noticeText", () => {
  it("words what changed on the player in each language", () => {
    expect(noticeText({ kind: "speed", rate: 1.5 })).toBe("Speed 1.5×");
    expect(noticeText({ kind: "subtitlesOff" })).toBe("Subtitles off");
    setLanguage("ro", false);
    expect(noticeText({ kind: "speed", rate: 1.5 })).toContain("1.5");
    expect(noticeText({ kind: "subtitlesOff" })).not.toBe("Subtitles off");
    setLanguage("it", false);
    expect(noticeText({ kind: "quality", label: "1080p" })).toContain("1080p");
  });
});

describe("statusWords", () => {
  it("says what is left of an episode in the language of the page", () => {
    expect(statusWords().left(12)).toBe("12 min left");
    setLanguage("it", false);
    expect(statusWords().left(12)).toContain("12");
    expect(statusWords().left(12)).not.toBe("12 min left");
    expect(statusWords().watched).not.toBe("Watched");
  });
});

describe("friendlyError", () => {
  it("has plain words for the codes the player reports and a fallback for the rest", () => {
    expect(friendlyError("HLS_UNSUPPORTED")).toBe("This TV's browser can't play this kind of stream.");
    expect(friendlyError("SOMETHING_NEW")).toBe("Something went wrong while playing this video.");
    expect(friendlyError(undefined)).toBe("Something went wrong while playing this video.");
    setLanguage("ro", false);
    expect(friendlyError("PLAYBACK_BLOCKED")).not.toBe("The TV blocked playback. Press OK on the TV, then try again.");
  });
});

describe("socketError", () => {
  it("says the server's codes in the language of the page", () => {
    expect(socketError("INVALID_CODE", "Invalid or expired code.")).toBe("Invalid or expired code.");
    setLanguage("ro", false);
    expect(socketError("INVALID_CODE", "Invalid or expired code.")).not.toBe("Invalid or expired code.");
    expect(socketError("PARTY_FULL", "x")).toContain(String(MAX_FOLLOWERS + 1));
  });

  it("explains a server that is older than the page, whatever it said", () => {
    expect(socketError("BAD_MESSAGE", "Invalid message.")).toMatch(/restart the server/i);
  });

  it("passes on what the server said about a code it has no words for", () => {
    setLanguage("it", false);
    expect(socketError("BRAND_NEW_CODE", "Something the server said.")).toBe("Something the server said.");
  });
});

describe("resolveFailure", () => {
  const failed = (message: string, reason: Extract<ResolveStatus, { phase: "failed" }>["reason"] = "temporary_failure") =>
    ({ phase: "failed", reason, message }) as Extract<ResolveStatus, { phase: "failed" }>;

  it("keeps the server's own sentence in English", () => {
    expect(resolveFailure(failed("The TV is offline.", "tv_offline"))).toBe("The TV is offline.");
    expect(resolveFailure(failed("Something the resolver wrote."))).toBe("Something the resolver wrote.");
  });

  it("says the sentences it knows in the language of the page", () => {
    setLanguage("ro", false);
    for (const message of [
      "That doesn't look like a link I can open.",
      "The TV is offline.",
      "Something went wrong while looking for the video.",
      "The website is having trouble right now. Try again in a moment.",
      "That page couldn't be opened (it may have moved or require a login).",
      "The website didn't respond in time. Try again in a moment.",
      "Couldn't find a compatible video source. This website is currently unsupported.",
      "This is taking too long. Try again in a moment.",
    ]) {
      expect(resolveFailure(failed(message)), message).not.toBe(message);
    }
  });

  it("says what kind of trouble it was when it is not a sentence it knows", () => {
    setLanguage("it", false);
    const unsupported = resolveFailure(failed("Couldn't find a compatible video source.", "unsupported"));
    const temporary = resolveFailure(failed("Some new trouble."));
    expect(unsupported).not.toBe("Couldn't find a compatible video source.");
    expect(temporary).not.toBe("Some new trouble.");
    expect(unsupported).not.toBe(temporary);
  });
});
