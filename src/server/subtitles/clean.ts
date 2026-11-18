import type { OfficialLang } from "../../shared";
import type { VttCue } from "./vtt";

export const CLEAN_RULES = 2;

export interface Cleaned {
  cues: VttCue[];
  from: number[];
  dropped: number[];
  removed: number;
  changed: number;
}

const CREDITS_AT_START = 180;
const CREDITS_AT_END = 300;

const SITES =
  /\b(?:open-?subtitles|osdb\.link|subscene|addic7ed|podnapisi|yify|yts\b|tvsubtitles|subsource|subdl|subs\.ro|subtitrari(?:-?noi)?|titrari\.ro|subsunacs|sub-?team|ondebi|kinosub)\b/i;
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[A-Za-z0-9-]{3,}\.(?:com|net|org|ro|info|tv|io|me|co|to|cc|link|club|xyz)(?![A-Za-z0-9-])(?:\/\S*)?/;
const LINK_ANYWHERE = new RegExp(LINK.source, "g");
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

function isCredit(line: string, at: number, last: number): boolean {
  const plain = line.replace(/<[^>]*>/g, "").trim();
  if (!plain) return false;
  if (SITES.test(plain)) return true;
  const nearEdge = at <= CREDITS_AT_START || at >= last - CREDITS_AT_END;
  if (/\b(?:https?:\/\/|www\.)/i.test(plain) || LINK.test(plain)) return nearEdge || plain.replace(LINK_ANYWHERE, "").replace(/(?:https?:\/\/|www\.)\S*/gi, "").replace(/[\s\W]+/g, "").length <= 3;
  return nearEdge && CREDIT_WORDS.test(plain);
}

const KEPT_TAG = /^<\/?(?:i|b|u)>$/i;

const ROMANIAN_MOJIBAKE: Record<string, string> = { "º": "ș", "ª": "Ș", "þ": "ț", "Þ": "Ț", "ã": "ă", "Ã": "Ă" };
const MOJIBAKE_LETTERS = /[ºªþÞãÃ]/g;
const CEDILLA: Record<string, string> = { "ş": "ș", "Ş": "Ș", "ţ": "ț", "Ţ": "Ț" };

const AFTER_I =
  "am|was|have|had|will|would|can|could|can't|cannot|don't|didn't|do|did|think|thought|know|knew|want|wanted|need|needed|just|mean|meant|guess|said|say|see|saw|got|love|like|hope|told|wish|swear|promise|believe|really|never|always|should|must|may|might|feel|felt|tried|went|came|found|made";
const L_FOR_I = new RegExp(String.raw`(^|[\s"'(\[-])l(?=\s(?:${AFTER_I})\b)`, "g");

const LEADING_MARKUP = String.raw`(?:<[^>]*>|\{\\[^}]*\})*`;
const plainOf = (line: string) => line.replace(/<[^>]*>|\{\\[^}]*\}/g, "").trim();

function musicMarks(lines: string[]): string[] {
  if (!/^\?(?:\s|$)/.test(plainOf(lines[0] ?? "")) || !/\?$/.test(plainOf(lines[lines.length - 1] ?? ""))) return lines;
  return lines.map((line, index) => {
    let out = line.replace(new RegExp(String.raw`^(${LEADING_MARKUP}\s*)\?(?=\s|$)`), "$1♪");
    if (index === lines.length - 1) out = out.replace(/\s*\?((?:<\/[^>]*>|\s)*)$/, " ♪$1");
    return out;
  });
}

function tidyLine(line: string, lang: OfficialLang, mojibake: boolean): string {
  let out = line
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/<[^>]*>/g, (tag) => (KEPT_TAG.test(tag) ? tag.toLowerCase() : ""))
    .replace(/[\t  ]+/g, " ")
    .trim()
    .replace(new RegExp(String.raw`^(${LEADING_MARKUP})[-–—](?=[^\s\-–—])`), "$1- ")
    .replace(new RegExp(String.raw`^(${LEADING_MARKUP})[–—] `), "$1- ")
    .replace(/(\S)\s+([,!?;:])/g, "$1$2")
    .replace(/(\S)\s+\.(?!\.)/g, "$1.")
    .replace(/\.{4,}/g, "...");
  if (lang === "ro") {
    out = out.replace(/[şŞţŢ]/g, (letter) => CEDILLA[letter] ?? letter);
    if (mojibake) out = out.replace(MOJIBAKE_LETTERS, (letter) => ROMANIAN_MOJIBAKE[letter] ?? letter);
  } else {
    out = out
      .replace(/\bl'(m|ll|ve|d)\b/g, "I'$1")
      .replace(L_FOR_I, "$1I")
      .replace(/(^|[\s"(\[])i(?=$|[\s,!?;:']|\.(?!e\.))/g, "$1I");
  }
  return out;
}

export function cleanCues(source: readonly VttCue[], lang: OfficialLang): Cleaned {
  const last = source.reduce((latest, cue) => Math.max(latest, cue.start), 0);
  const letters = source.map((cue) => cue.text).join("\n");
  const mojibake = lang === "ro" && (letters.match(MOJIBAKE_LETTERS)?.length ?? 0) >= 5 && !/[șțȘȚşţŞŢ]/.test(letters);
  const cues: VttCue[] = [];
  const from: number[] = [];
  const dropped: number[] = [];
  let changed = 0;
  source.forEach((cue, index) => {
    const lines = musicMarks(cue.text.split("\n").filter((line) => !isCredit(line, cue.start, last)))
      .map((line) => tidyLine(line, lang, mojibake))
      .filter((line) => plainOf(line) !== "");
    if (lines.length === 2 && plainOf(lines[1]!).startsWith("- ") && !/^[-–—]/.test(plainOf(lines[0]!))) {
      lines[0] = lines[0]!.replace(new RegExp(String.raw`^(${LEADING_MARKUP})`), "$1- ");
    }
    if (lines.length === 0) {
      dropped.push(index);
      return;
    }
    const text = lines.join("\n");
    const before = cues[cues.length - 1];
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
