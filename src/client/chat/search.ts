import { isStickerId, type ChatLine } from "../../shared";
import { gifOf } from "./gifs";
import { stickerOf, stickerSrc } from "./stickers";
import { titleIn } from "./titles";

/**
 * Searching a chat (the owner, 17 Nov: "add a search in conversation (in the three dots)"): the messages whose words hold every word that was typed, the
 * newest first, found however they were typed - in capitals or not, with the accents or without (ș and ş, ț and ţ, â, ă, î, è all match their plain letter).
 * Only words are searched: a GIF or a sticker has none (its address and its code are not what anybody wrote), and a title is found by what was written with
 * it and by its name once the chat knows it, never by its address.
 */

/**
 * A picture the chat holds, for its gallery (the owner, 17 Nov: "image gallery in the 3 dots"): a GIF (its address, KLIPY's), one of Kino's stickers (this
 * site's file), or a personal sticker (its name: its picture is the chat's to give, and none while stickers are off).
 */
export type ChatMedia = { id: number; at: number; mine: boolean } & ({ kind: "gif"; src: string } | { kind: "sticker"; src: string } | { kind: "personal"; sticker: string });

/** The pictures of a chat, the newest first. */
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

/** Words as a search compares them: lower case, without accents, spaces made single. */
export const fold = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** The words of a query, folded (none: nothing is searched for). */
export const queryWords = (query: string): string[] => fold(query).split(" ").filter(Boolean);

/** What a message says that a search looks in: its words; a title's words and its name (`titleName`, when the chat knows it); nothing for a GIF or a sticker. */
export function wordsOf(line: ChatLine, titleName?: (id: string) => string | undefined): string {
  if (line.sticker || gifOf(line.text) || stickerOf(line.text)) return "";
  const found = titleIn(line.text);
  if (!found) return line.text;
  return [found.rest, titleName?.(found.id)].filter(Boolean).join(" ");
}

/** The messages that hold every word of the query, by their ids, the newest first (none for a query of no words). */
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

/**
 * A message's words cut where the query's words are in them, for those to be lit: each piece in the order it is written, `hit` for a piece that is one of
 * them. Found as a search finds them (no capitals, no accents), and given back as they were written.
 */
export function marked(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const words = queryWords(query);
  if (words.length === 0 || text === "") return [{ text, hit: false }];
  // Each letter of the text folded on its own, and where each folded letter came from: what is found in the folded words is lit in the written ones.
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
