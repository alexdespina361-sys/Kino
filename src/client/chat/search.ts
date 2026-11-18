import { isStickerId, type ChatLine } from "../../shared";
import { gifOf } from "./gifs";
import { stickerOf, stickerSrc } from "./stickers";
import { titleIn } from "./titles";

export type ChatMedia = { id: number; at: number; mine: boolean } & ({ kind: "gif"; src: string } | { kind: "sticker"; src: string } | { kind: "personal"; sticker: string });

export function mediaOf(lines: readonly ChatLine[]): ChatMedia[] {
  const found: ChatMedia[] = [];
  for (let at = lines.length - 1; at >= 0; at--) {
    const line = lines[at]!;
    const who = { id: line.id, at: line.at, mine: line.mine };
    if (line.sticker) {
      if (isStickerId(line.sticker)) found.push({ ...who, kind: "personal", sticker: line.sticker });
      continue;
    }
    const gif = gifOf(line.text);
    if (gif) {
      found.push({ ...who, kind: "gif", src: gif });
      continue;
    }
    const sticker = stickerOf(line.text);
    if (sticker) found.push({ ...who, kind: "sticker", src: stickerSrc(sticker) });
  }
  return found;
}

export const fold = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const queryWords = (query: string): string[] => fold(query).split(" ").filter(Boolean);

export function wordsOf(line: ChatLine, titleName?: (id: string) => string | undefined): string {
  if (line.sticker || gifOf(line.text) || stickerOf(line.text)) return "";
  const found = titleIn(line.text);
  if (!found) return line.text;
  return [found.rest, titleName?.(found.id)].filter(Boolean).join(" ");
}

export function findInChat(lines: readonly ChatLine[], query: string, titleName?: (id: string) => string | undefined): number[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const found: number[] = [];
  for (let at = lines.length - 1; at >= 0; at--) {
    const line = lines[at]!;
    const said = fold(wordsOf(line, titleName));
    if (said && words.every((word) => said.includes(word))) found.push(line.id);
  }
  return found;
}

export function marked(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const words = queryWords(query);
  if (words.length === 0 || text === "") return [{ text, hit: false }];
  let folded = "";
  const from: number[] = [];
  let at = 0;
  for (const letter of text) {
    const plain = letter.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s/g, " ");
    for (let k = 0; k < plain.length; k++) from.push(at);
    folded += plain;
    at += letter.length;
  }
  from.push(text.length);
  const lit = new Array<boolean>(text.length).fill(false);
  for (const word of words) {
    for (let start = folded.indexOf(word); start !== -1; start = folded.indexOf(word, start + word.length)) {
      for (let k = from[start]!; k < from[start + word.length]!; k++) lit[k] = true;
    }
  }
  const pieces: Array<{ text: string; hit: boolean }> = [];
  for (let k = 0; k < text.length; k++) {
    const last = pieces[pieces.length - 1];
    if (last && last.hit === lit[k]) last.text += text[k];
    else pieces.push({ text: text[k]!, hit: lit[k]! });
  }
  return pieces;
}
