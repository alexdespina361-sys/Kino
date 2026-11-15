import type { OfficialLang } from "../../shared";
import type { VttCue } from "./vtt";

/**
 * The tidying a subtitle file gets before it is a Kino Official one (see docs/official-subtitles.md): what can be fixed for certain from
 * the text alone. The wording itself (grammar, an awkward sentence, which speaker says a line) is the team's to fix (`scripts/official.mjs`),
 * since a rule that guessed at it would be wrong as often as right. A new rule here is a new `CLEAN_RULES`.
 */
export const CLEAN_RULES = 2;

export interface Cleaned {
  cues: VttCue[];
  /** For each line of `cues`, the line of the file it was made from. */
  from: number[];
  /** Lines of the file left out (credits and advertising, lines that were nothing but markup, a line written twice over itself), by their number in the file. */
  dropped: number[];
  removed: number;
  /** Lines of the file whose text was changed. */
  changed: number;
}

/** Credits and advertising are at the start and the end of a film: a line like one in the middle of it is somebody speaking. */
const CREDITS_AT_START = 180;
const CREDITS_AT_END = 300;

/** The subtitle sites and teams whose name in a line makes it theirs, wherever it is. */
const SITES =
  /\b(?:open-?subtitles|osdb\.link|subscene|addic7ed|podnapisi|yify|yts\b|tvsubtitles|subsource|subdl|subs\.ro|subtitrari(?:-?noi)?|titrari\.ro|subsunacs|sub-?team|ondebi|kinosub)\b/i;
// (A name of a site is written in small letters after its dot: "Come on.To the car" is two sentences, not a site.)
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[A-Za-z0-9-]{3,}\.(?:com|net|org|ro|info|tv|io|me|co|to|cc|link|club|xyz)(?![A-Za-z0-9-])(?:\/\S*)?/;
const LINK_ANYWHERE = new RegExp(LINK.source, "g");
/** What credits and advertising say (English and Romanian). */
const CREDIT_WORDS = new RegExp(
  [
    String.raw`\b(?:subtitles?|subs|captions?|captioning|transcript|sync(?:ed|hro(?:nized|nised))?|re-?sync(?:ed)?|corrected|corrections?|ripped|encoded|edited|timed|translated|translation|improved|adapted|provided)(?:\s+(?:and|&)\s+\w+)?\s+(?:by|from)\b`,
    String.raw`\bdownloaded\s+from\b`,
    String.raw`\badvertise\s+your\s+product\b`,
    String.raw`\bbecome\s+(?:a\s+)?vip\b`,
    String.raw`\brate\s+this\s+subtitle\b`,
    String.raw`\bsubtitrar(?:e|ea)\b\s*(?::|de\b|realizat|făcut|facut|oferit)`,
    String.raw`\btraducer(?:e|ea)\b(?:\s+(?:și|si)\s+adaptar(?:e|ea))?\s*(?::|de\b|realizat|făcut|facut)`,
    String.raw`\b(?:sincronizar(?:e|ea)|adaptar(?:e|ea)|corectur(?:a|ă)|revizi(?:a|e|uire(?:a)?))\s*(?::|de\b|realizat|făcut|facut)`,
    String.raw`\b(?:sincronizat|corectat|tradus|adaptat)\s+de\b`,
    String.raw`\bvizionare\s+pl[ăa]cut[ăa]\b`,
    String.raw`\bechipa\s+\S+\s+(?:vă\s+|va\s+)?prezint[ăa]\b`,
  ].join("|"),
  "i",
);

/** Whether a line (of the cue that starts at `at`, in a file whose last line starts at `last`) is credits or advertising. */
function isCredit(line: string, at: number, last: number): boolean {
  const plain = line.replace(/<[^>]*>/g, "").trim();
  if (!plain) return false;
  if (SITES.test(plain)) return true;
  const nearEdge = at <= CREDITS_AT_START || at >= last - CREDITS_AT_END;
  if (/\b(?:https?:\/\/|www\.)/i.test(plain) || LINK.test(plain)) return nearEdge || plain.replace(LINK_ANYWHERE, "").replace(/(?:https?:\/\/|www\.)\S*/gi, "").replace(/[\s\W]+/g, "").length <= 3;
  return nearEdge && CREDIT_WORDS.test(plain);
}

/** The markup a subtitle may keep: italics, bold, underline. The rest (a font, a colour, a position written for another kind of file) goes. */
const KEPT_TAG = /^<\/?(?:i|b|u)>$/i;

/** Letters that Romanian files written in the wrong code page have in place of its own (ș and ț as º and þ, ă as ã). */
const ROMANIAN_MOJIBAKE: Record<string, string> = { "º": "ș", "ª": "Ș", "þ": "ț", "Þ": "Ț", "ã": "ă", "Ã": "Ă" };
const MOJIBAKE_LETTERS = /[ºªþÞãÃ]/g;
/** The letters with a cedilla that Romanian writes with a comma below. */
const CEDILLA: Record<string, string> = { "ş": "ș", "Ş": "Ș", "ţ": "ț", "Ţ": "Ț" };

/** English words that follow "I" (a file read from pictures has "l" in its place). */
const AFTER_I =
  "am|was|have|had|will|would|can|could|can't|cannot|don't|didn't|do|did|think|thought|know|knew|want|wanted|need|needed|just|mean|meant|guess|said|say|see|saw|got|love|like|hope|told|wish|swear|promise|believe|really|never|always|should|must|may|might|feel|felt|tried|went|came|found|made";
const L_FOR_I = new RegExp(String.raw`(^|[\s"'(\[-])l(?=\s(?:${AFTER_I})\b)`, "g");

/** Markup at the start of a line: a speaker's dash comes after it ("<i>- Where?"). */
const LEADING_MARKUP = String.raw`(?:<[^>]*>|\{\\[^}]*\})*`;
const plainOf = (line: string) => line.replace(/<[^>]*>|\{\\[^}]*\}/g, "").trim();

/**
 * A song in a file whose ♪ a wrong code page made "?": a cue whose first line starts with "? " is sung, its lines' leading "?" and the
 * last line's last "?" are ♪ ("<i>? Chop, chop ?</i>" is "<i>♪ Chop, chop ♪</i>"). No line of speech starts with a question mark.
 */
function musicMarks(lines: string[]): string[] {
  if (!/^\?(?:\s|$)/.test(plainOf(lines[0] ?? ""))) return lines;
  return lines.map((line, index) => {
    let out = line.replace(new RegExp(String.raw`^(${LEADING_MARKUP}\s*)\?(?=\s|$)`), "$1♪");
    if (index === lines.length - 1) out = out.replace(/\s*\?((?:<\/[^>]*>|\s)*)$/, " ♪$1");
    return out;
  });
}

function tidyLine(line: string, lang: OfficialLang, mojibake: boolean): string {
  let out = line
    // (Positions and styles written for another kind of file: {\an8}, {\i1}.)
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/<[^>]*>/g, (tag) => (KEPT_TAG.test(tag) ? tag.toLowerCase() : ""))
    .replace(/[\t  ]+/g, " ")
    .trim()
    // A speaker's dash, with its space: "-Where?" is "- Where?" (a line that starts with two is left as it is).
    .replace(new RegExp(String.raw`^(${LEADING_MARKUP})[-–—](?=[^\s\-–—])`), "$1- ")
    .replace(new RegExp(String.raw`^(${LEADING_MARKUP})[–—] `), "$1- ")
    // No space before a comma, a question mark and the like; a full stop, unless it starts an ellipsis that leads the line.
    .replace(/(\S)\s+([,!?;:])/g, "$1$2")
    .replace(/(\S)\s+\.(?!\.)/g, "$1.")
    // An ellipsis written with more than three dots.
    .replace(/\.{4,}/g, "...");
  if (lang === "ro") {
    out = out.replace(/[şŞţŢ]/g, (letter) => CEDILLA[letter] ?? letter);
    if (mojibake) out = out.replace(MOJIBAKE_LETTERS, (letter) => ROMANIAN_MOJIBAKE[letter] ?? letter);
  } else {
    out = out
      .replace(/\bl'(m|ll|ve|d)\b/g, "I'$1")
      .replace(L_FOR_I, "$1I")
      // A lone lower-case "i" as a word ("i.e." aside).
      // (After a space, a quote or a bracket only: "Hawai'i" and "Wi-i" are words of their own.)
      .replace(/(^|[\s"(\[])i(?=$|[\s,!?;:']|\.(?!e\.))/g, "$1I");
  }
  return out;
}

/** The tidied file: lines that are credits or advertising, or nothing once their markup is gone, are left out; a line written twice over itself is one. */
export function cleanCues(source: readonly VttCue[], lang: OfficialLang): Cleaned {
  const last = source.reduce((latest, cue) => Math.max(latest, cue.start), 0);
  const letters = source.map((cue) => cue.text).join("\n");
  // (Only a file that is clearly written so: one with Romanian's own ș or ț in it is not, and º is also an ordinal.)
  const mojibake = lang === "ro" && (letters.match(MOJIBAKE_LETTERS)?.length ?? 0) >= 5 && !/[șțȘȚşţŞŢ]/.test(letters);
  const cues: VttCue[] = [];
  const from: number[] = [];
  const dropped: number[] = [];
  let changed = 0;
  source.forEach((cue, index) => {
    const lines = musicMarks(cue.text.split("\n").filter((line) => !isCredit(line, cue.start, last)))
      .map((line) => tidyLine(line, lang, mojibake))
      .filter((line) => plainOf(line) !== "");
    // Two speakers in one line: when the second has its dash, so has the first (after its markup: "<i>- Denial.</i>" has one).
    if (lines.length === 2 && plainOf(lines[1]!).startsWith("- ") && !/^[-–—]/.test(plainOf(lines[0]!))) {
      lines[0] = lines[0]!.replace(new RegExp(String.raw`^(${LEADING_MARKUP})`), "$1- ");
    }
    if (lines.length === 0) {
      dropped.push(index);
      return;
    }
    const text = lines.join("\n");
    const before = cues[cues.length - 1];
    // (Only when the two are on the screen at once: a line said again after the first is gone, a refrain or "Copy." twice, is said twice.)
    if (before && before.text === text && cue.start < before.end) {
      before.end = Math.max(before.end, cue.end);
      dropped.push(index);
      return;
    }
    if (text !== cue.text) changed++;
    cues.push({ start: cue.start, end: cue.end, text });
    from.push(index);
  });
  return { cues, from, dropped, removed: dropped.length, changed };
}
