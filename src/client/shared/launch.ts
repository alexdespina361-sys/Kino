import { isHttpUrl } from "../../shared";

export interface LaunchParams {
  code?: string;
  control?: string;
  link?: string;
  friend?: string;
  url?: string;
  startAt?: number;
}

const START_MAX = 86_400;

const LINK_CODE = /^[A-HJ-NP-Z2-9]{8}$/;

export function linkCodeOf(text: string | null | undefined): string | undefined {
  const code = (text ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return LINK_CODE.test(code) ? code : undefined;
}

export function typedLinkCode(text: string): string {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

export function firstLink(text: string): string | undefined {
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    let link = match[0];
    while (/[.,;:!?\]]$/.test(link) || (link.endsWith(")") && count(link, "(") < count(link, ")"))) link = link.slice(0, -1);
    if (isHttpUrl(link)) return link;
  }
  return undefined;
}

const count = (text: string, char: string) => text.split(char).length - 1;

export function linkOf(text: string): string {
  const trimmed = text.trim();
  return /\s/.test(trimmed) || !isHttpUrl(trimmed) ? (firstLink(trimmed) ?? trimmed) : trimmed;
}

export const pairLink = (code: string, origin = location.origin) => `${origin}/?code=${code}`;

export const controlLink = (code: string, origin = location.origin) => `${origin}/?control=${code}`;

export const partyLink = (code: string, origin = location.origin) => `${origin}/?party=${code}`;

export function readPartyCode(search: string): string | null {
  const code = (new URLSearchParams(search).get("party") ?? "").replace(/\D/g, "");
  return code.length === 6 ? code : null;
}

export function partyCodeIn(text: string): string | null {
  const linked = /[?&]party=([\d\s-]+)/.exec(text)?.[1]?.replace(/\D/g, "");
  if (linked?.length === 6) return linked;
  const shown = /(?:^|\D)(\d{3}[ -]?\d{3})(?!\d)/.exec(text)?.[1]?.replace(/\D/g, "");
  if (shown) return shown;
  return null;
}

export function readLaunchParams(search: string): LaunchParams {
  const params = new URLSearchParams(search);
  const code = params.get("code")?.trim();
  const control = params.get("control")?.trim();
  const shared = params.get("url")?.trim() ?? "";
  const url = isHttpUrl(shared) ? shared : firstLink(params.get("text") ?? "") ?? firstLink(shared);
  const link = linkCodeOf(params.get("link"));
  const friend = linkCodeOf(params.get("friend"));
  const t = params.get("t") ?? "";
  const startAt = url && /^\d{1,6}$/.test(t) && Number(t) >= 1 && Number(t) <= START_MAX ? Number(t) : undefined;
  return {
    ...(code && /^\d{6}$/.test(code) ? { code } : {}),
    ...(control && /^\d{6}$/.test(control) ? { control } : {}),
    ...(link ? { link } : {}),
    ...(friend ? { friend } : {}),
    ...(url ? { url } : {}),
    ...(startAt !== undefined ? { startAt } : {}),
  };
}
