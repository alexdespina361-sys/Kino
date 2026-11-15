import { describe, expect, it } from "vitest";
import { cleanCues } from "./clean";
import type { VttCue } from "./vtt";

// (Made-up lines only: the repo is public.)
const at = (start: number, text: string): VttCue => ({ start, end: start + 2, text });
/** A file of a film an hour and a half long, with these lines in it. */
const film = (...lines: VttCue[]) => [...lines, at(5400, "The last line of the film.")];
const texts = (cues: VttCue[]) => cues.map((cue) => cue.text);

describe("cleanCues: credits and advertising", () => {
  it("leaves out credits at the start and the end of a film, but not words like them in the middle of it", () => {
    const cleaned = cleanCues(
      film(
        at(10, "Subtitles by A Made Up Team"),
        at(20, "Traducerea și adaptarea: Cineva"),
        at(2000, "It was translated by my mother."),
        at(2010, "Subtitrare de mâna mea, zise el."),
        at(5300, "Sync and corrections by nobody"),
        at(5310, "<font color=red>Provided by somebody</font>"),
      ),
      "en",
    );
    expect(texts(cleaned.cues)).toEqual(["It was translated by my mother.", "Subtitrare de mâna mea, zise el.", "The last line of the film."]);
    expect(cleaned.removed).toBe(4);
  });

  it("leaves out a subtitle site's name and a link anywhere, and only that line of a cue", () => {
    const cleaned = cleanCues(film(at(2000, "Downloaded from OpenSubtitles.org"), at(3000, "Where were you?\nwww.example-subs.net")), "en");
    expect(texts(cleaned.cues)).toEqual(["Where were you?", "The last line of the film."]);
    expect(cleaned.from).toEqual([1, 2]);
  });

  it("keeps a line that only mentions a website in the middle of a film", () => {
    expect(texts(cleanCues(film(at(2000, "I bought it on example.com last week.")), "en").cues)[0]).toBe("I bought it on example.com last week.");
  });
});

describe("cleanCues: the text", () => {
  it("writes Romanian with comma letters, and mends a file in the wrong code page", () => {
    expect(texts(cleanCues(film(at(100, "Aşa ţi-am spus.")), "ro").cues)[0]).toBe("Așa ți-am spus.");
    const wrong = film(at(100, "ªtiu cã e aºa."), at(200, "Vrei sã vii acasã?"), at(300, "Þine-te bine."));
    expect(texts(cleanCues(wrong, "ro").cues).slice(0, 3)).toEqual(["Știu că e așa.", "Vrei să vii acasă?", "Ține-te bine."]);
  });

  it("leaves a few such letters alone when the file is not written so", () => {
    expect(texts(cleanCues(film(at(100, "Locul 1º, João.")), "ro").cues)[0]).toBe("Locul 1º, João.");
  });

  it("mends English read from pictures: l for I", () => {
    const cleaned = cleanCues(film(at(100, "l'm here and l think so."), at(200, "i know, i.e. yes.")), "en");
    expect(texts(cleaned.cues).slice(0, 2)).toEqual(["I'm here and I think so.", "I know, i.e. yes."]);
  });

  it("writes speakers' dashes, spaces and markup one way", () => {
    const cleaned = cleanCues(film(at(100, "-Where?\n- Home."), at(200, "Who's there?\n-Me."), at(300, "{\\an8}<font color=red>Look ,  up !</font>"), at(400, "Wait.....")), "en");
    expect(texts(cleaned.cues).slice(0, 4)).toEqual(["- Where?\n- Home.", "- Who's there?\n- Me.", "Look, up!", "Wait..."]);
    expect(texts(cleanCues(film(at(100, "<I>Keep</I> <b>this</b>")), "en").cues)[0]).toBe("<i>keep</i> <b>this</b>".replace("keep", "Keep"));
  });

  it("makes one line of a line written twice over itself, and leaves out one that was only markup", () => {
    const cleaned = cleanCues(film({ start: 100, end: 101.5, text: "Run!" }, { start: 101, end: 102, text: "Run!" }, at(200, "<i> </i>")), "en");
    expect(cleaned.cues.slice(0, 1)).toEqual([{ start: 100, end: 102, text: "Run!" }]);
    expect(cleaned.removed).toBe(2);
    expect(cleaned.dropped).toEqual([1, 2]);
  });

  it("keeps a line said again once the first is gone: a refrain, an answer twice", () => {
    const cleaned = cleanCues(film({ start: 100, end: 101, text: "Copy." }, { start: 101, end: 102, text: "Copy." }, at(103, "Copy.")), "en");
    expect(texts(cleaned.cues).slice(0, 3)).toEqual(["Copy.", "Copy.", "Copy."]);
    expect(cleaned.removed).toBe(0);
  });

  it("writes the first speaker's dash after the markup, and not twice", () => {
    const cleaned = cleanCues(film(at(100, "<i>- Gone.</i>\n- Not yet."), at(200, "<i>Gone.</i>\n- Not yet."), at(300, "<i>-Gone.</i>")), "en");
    expect(texts(cleaned.cues).slice(0, 3)).toEqual(["<i>- Gone.</i>\n- Not yet.", "<i>- Gone.</i>\n- Not yet.", "<i>- Gone.</i>"]);
  });

  it("writes a song's notes that a wrong code page made question marks as notes, and leaves a question alone", () => {
    const cleaned = cleanCues(
      film(at(100, "<i>? La la la\nOn we go ?</i>"), at(200, "? One more time!?"), at(300, "Where to ?"), at(400, "♪ Already right ♪")),
      "en",
    );
    expect(texts(cleaned.cues).slice(0, 4)).toEqual(["<i>♪ La la la\nOn we go ♪</i>", "♪ One more time! ♪", "Where to?", "♪ Already right ♪"]);
  });

  it("counts the lines it changed, and keeps a line that needs nothing as it was", () => {
    const cleaned = cleanCues(film(at(100, "Fine as it is."), at(200, "-Not this one.")), "en");
    expect(cleaned.changed).toBe(1);
    expect(cleaned.cues[0]).toEqual(at(100, "Fine as it is."));
  });
});
