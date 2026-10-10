import { isHttpUrl } from "../../shared";

export interface LaunchParams {
  /** A 6-digit pairing code, from the QR code on the TV (`/?code=482731`). */
  code?: string;
  /** The 6-digit code of a TV that has a phone already, from the QR code it shows for another phone (`/?control=482731`). Joining that TV is all it is good for. */
  control?: string;
  /** The code on a TV's sign-in screen (`/?link=ABCD2345`): the phone is asked whether to sign that TV in. */
  link?: string;
  /** A link to play, from the phone's share sheet (`/?url=...` or `/?text=...`). */
  url?: string;
}

/** The characters a sign-in code is made of: no 0/O or 1/I, which are mixed up when read aloud (the server's alphabet). */
const LINK_CODE = /^[A-HJ-NP-Z2-9]{8}$/;

/** The code on a TV's sign-in screen, however it was typed ("abcd-2345" is "ABCD2345"); undefined when it isn't one. */
export function linkCodeOf(text: string | null | undefined): string | undefined {
  const code = (text ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return LINK_CODE.test(code) ? code : undefined;
}

/** What has been typed of a sign-in code, tidied as it goes: upper case, only letters and digits, a dash after the fourth ("abcd23" is "ABCD-23"). */
export function typedLinkCode(text: string): string {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
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

/** The address that connects a phone: this site with a TV's pairing code in it (what its QR code holds). */
export const pairLink = (code: string, origin = location.origin) => `${origin}/?code=${code}`;

/** The address that lets another phone control a TV that has one: this site with the TV's control code in it (what the QR codes on its screen and on the first phone's menu hold). */
export const controlLink = (code: string, origin = location.origin) => `${origin}/?control=${code}`;

/** The address that opens a watch party on any phone or computer: this site with the party's code in it (what its QR code holds). */
export const partyLink = (code: string, origin = location.origin) => `${origin}/?party=${code}`;

/** The code of the watch party an address was opened for (`/?party=482731`), or null for any other visit. */
export function readPartyCode(search: string): string | null {
  const code = (new URLSearchParams(search).get("party") ?? "").replace(/\D/g, "");
  return code.length === 6 ? code : null;
}

/** What the phone page was opened for. Everything is optional and anything odd is ignored. */
export function readLaunchParams(search: string): LaunchParams {
  const params = new URLSearchParams(search);
  const code = params.get("code")?.trim();
  const control = params.get("control")?.trim();
  const shared = params.get("url")?.trim() ?? "";
  const url = isHttpUrl(shared) ? shared : firstLink(params.get("text") ?? "") ?? firstLink(shared);
  const link = linkCodeOf(params.get("link"));
  return {
    ...(code && /^\d{6}$/.test(code) ? { code } : {}),
    ...(control && /^\d{6}$/.test(control) ? { control } : {}),
    ...(link ? { link } : {}),
    ...(url ? { url } : {}),
  };
}
