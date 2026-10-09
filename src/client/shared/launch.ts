import { isHttpUrl } from "../../shared";

export interface LaunchParams {
  /** A 6-digit pairing code, from the QR code on the TV (`/?code=482731`). */
  code?: string;
  /** A link to play, from the phone's share sheet (`/?url=...` or `/?text=...`). */
  url?: string;
}

/** The first http(s) link inside free text: apps often share "Watch this https://site/watch/1 !!" as `text`. */
export function firstLink(text: string): string | undefined {
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    let link = match[0];
    // Sentence punctuation and an unbalanced ")" belong to the prose, not the link.
    while (/[.,;:!?\]]$/.test(link) || (link.endsWith(")") && count(link, "(") < count(link, ")"))) link = link.slice(0, -1);
    if (isHttpUrl(link)) return link;
  }
  return undefined;
}

const count = (text: string, char: string) => text.split(char).length - 1;

/** What the phone page was opened for. Everything is optional and anything odd is ignored. */
export function readLaunchParams(search: string): LaunchParams {
  const params = new URLSearchParams(search);
  const code = params.get("code")?.trim();
  const shared = params.get("url")?.trim() ?? "";
  const url = isHttpUrl(shared) ? shared : firstLink(params.get("text") ?? "") ?? firstLink(shared);
  return {
    ...(code && /^\d{6}$/.test(code) ? { code } : {}),
    ...(url ? { url } : {}),
  };
}
