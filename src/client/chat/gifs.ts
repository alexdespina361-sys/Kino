/**
 * GIFs in a chat, from KLIPY (https://klipy.com): what the owner asked for on 16 Nov ("implement gifs"). Tenor's API was shut on 30 Jun 2026 and GIPHY's
 * production use is paid; KLIPY's is free, with a key of the site's own (`KLIPY_KEY` on the host, given to the pages by `/api/features`: KLIPY puts it in
 * the address of every request a visitor's browser makes, so it is no secret).
 *
 * KLIPY's rules for a standard integration (docs.klipy.com, "Integration Requirements"), and how this keeps them:
 * - the requests and the pictures go from the visitor's browser straight to KLIPY, never through this site's server (nothing here fetches or keeps one);
 * - a picture's address is used as KLIPY gave it, every part of it;
 * - Search and Trending are shown in KLIPY's order, all of them, in a grid of their own; the filter is KLIPY's own (`content_filter`), and the box says
 *   "Search KLIPY", with "Powered by KLIPY" under the grid (the attribution they ask for).
 *
 * A GIF is sent as a message whose whole text is the address of the picture (the size KLIPY calls `sm`, about 220 pixels and 80 KB as WebP). A screen
 * draws such a message as the picture (ChatLines.tsx); any other text, an address on another host among it, stays text. Older pages show the address.
 */

/** The hosts KLIPY delivers its pictures from (their "Network Requirements"). */
export const KLIPY_HOSTS: ReadonlySet<string> = new Set(["static.klipy.com", "static1.klipy.com", "static2.klipy.com"]);
const PICTURE = /\.(gif|webp)$/i;
/** Longer than any picture KLIPY gives (about 90 characters), shorter than a message: what is longer is not one of theirs. */
const ADDRESS_MAX = 400;

/**
 * The picture a message is, when its whole text (spaces around it aside) is the https address of a GIF or WebP on one of KLIPY's hosts, with nothing
 * else in it: no name and password, no port, no fragment. The address is given back as it was written (with its query, if it has one: KLIPY's rule).
 */
export function gifOf(text: string): string | null {
  const written = text.trim();
  if (written.length === 0 || written.length > ADDRESS_MAX || /\s/.test(written) || !written.startsWith("https://")) return null;
  let address: URL;
  try {
    address = new URL(written);
  } catch {
    return null;
  }
  if (address.protocol !== "https:" || address.username || address.password || address.port || address.hash) return null;
  if (!KLIPY_HOSTS.has(address.hostname) || !PICTURE.test(address.pathname)) return null;
  // (What was written must be what the browser reads: `https://static.klipy.com\@evil/` and the like are read as another host by some.)
  if (!written.startsWith(`https://${address.hostname}/`)) return null;
  return written;
}

/** One GIF of KLIPY's answer: what the grid shows, and what is sent. */
export interface Gif {
  slug: string;
  title: string;
  /** The picture in the grid (small). */
  thumb: string;
  /** Its size, so that the grid does not move while the pictures come. */
  width: number;
  height: number;
  /** What is sent (see the top of this file). */
  sent: string;
}

/** A page of KLIPY's answer. */
export interface GifPage {
  gifs: Gif[];
  more: boolean;
}

type KlipyFile = { url?: unknown; width?: unknown; height?: unknown };
type KlipySizes = Record<string, Record<string, KlipyFile | undefined> | undefined>;

const fileAt = (sizes: KlipySizes, size: string, kind: string): { url: string; width: number; height: number } | null => {
  const file = sizes[size]?.[kind];
  if (!file || typeof file.url !== "string") return null;
  const url = gifOf(file.url);
  if (!url) return null;
  const width = typeof file.width === "number" && file.width > 0 ? file.width : 1;
  const height = typeof file.height === "number" && file.height > 0 ? file.height : 1;
  return { url, width, height };
};

/** The first of these that the answer has: WebP before GIF (a fourth of the size), the small size before the others. */
const pick = (sizes: KlipySizes, order: readonly (readonly [string, string])[]) => {
  for (const [size, kind] of order) {
    const found = fileAt(sizes, size, kind);
    if (found) return found;
  }
  return null;
};
const SENT = [["sm", "webp"], ["sm", "gif"], ["md", "webp"], ["xs", "webp"], ["md", "gif"], ["xs", "gif"]] as const;
const THUMB = [["sm", "webp"], ["xs", "webp"], ["sm", "gif"], ["xs", "gif"], ["md", "webp"], ["md", "gif"]] as const;

/**
 * KLIPY's answer to Trending or Search, as the grid shows it: in its order. An entry that has no picture of the kinds a page can show (an ad, if the
 * site's KLIPY panel left them on: they are turned off there) cannot be drawn, and is the only thing not shown.
 */
export function gifPageOf(answer: unknown): GifPage {
  const outer = (answer as { data?: { data?: unknown; has_next?: unknown } } | null)?.data;
  const entries = Array.isArray(outer?.data) ? (outer.data as unknown[]) : [];
  const gifs: Gif[] = [];
  for (const entry of entries) {
    const item = entry as { slug?: unknown; title?: unknown; file?: unknown } | null;
    if (!item || typeof item.file !== "object" || item.file === null) continue;
    const sizes = item.file as KlipySizes;
    const thumb = pick(sizes, THUMB);
    const sent = pick(sizes, SENT);
    if (!thumb || !sent) continue;
    gifs.push({ slug: typeof item.slug === "string" ? item.slug : sent.url, title: typeof item.title === "string" ? item.title : "", thumb: thumb.url, width: thumb.width, height: thumb.height, sent: sent.url });
  }
  return { gifs, more: outer?.has_next === true };
}

/** How many GIFs a page of the grid asks for (KLIPY's default; at most 50). */
export const GIFS_PER_PAGE = 24;

/** The country KLIPY is told, for what is trending there (ISO 3166 alpha-2, as they ask): the browser's own, else the one of the site's language. */
export function klipyLocale(language: string, browser = typeof navigator === "undefined" ? "" : navigator.language): string {
  const region = /^[a-z]{2,3}[-_]([a-z]{2})\b/i.exec(browser)?.[1];
  if (region) return region.toLowerCase();
  return language === "ro" ? "ro" : language === "it" ? "it" : "us";
}

/** The address of a page of Trending (no words) or of Search. `strict`: KLIPY's strictest filter (a child's profile), else the middle one. */
export function klipyAddress(key: string, { query, page, customer, locale, strict = false }: { query: string; page: number; customer: string; locale: string; strict?: boolean }): string {
  const words = query.trim();
  const address = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/${words ? "search" : "trending"}`);
  address.searchParams.set("page", String(page));
  address.searchParams.set("per_page", String(GIFS_PER_PAGE));
  if (words) address.searchParams.set("q", words);
  address.searchParams.set("customer_id", customer);
  address.searchParams.set("locale", locale);
  address.searchParams.set("content_filter", strict ? "high" : "medium");
  return address.toString();
}

const CUSTOMER = "kino:klipy-customer";
let customer: string | undefined;
/**
 * The number KLIPY is told this browser is, as they ask (`customer_id`, "the same for the same user"): a random one, made here and kept by this browser,
 * that says nothing of the account or the profile. Where the browser keeps nothing, it lasts as long as the page.
 */
export function klipyCustomer(): string {
  if (customer) return customer;
  try {
    const kept = localStorage.getItem(CUSTOMER);
    if (kept && /^[a-z0-9-]{8,64}$/.test(kept)) return (customer = kept);
  } catch {
    /* (no storage: one for this page) */
  }
  const made = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  customer = made;
  try {
    localStorage.setItem(CUSTOMER, made);
  } catch {
    /* (as above) */
  }
  return made;
}

let features: Promise<string | null> | undefined;
/**
 * The site's KLIPY key (`/api/features`), or null when it has none: then there is no GIF button anywhere. Asked once a page; a host that did not answer is
 * asked again the next time.
 */
export function klipyKey(): Promise<string | null> {
  features ??= (async () => {
    try {
      const answer = await fetch("/api/features", { cache: "no-store" });
      if (!answer.ok) throw new Error(String(answer.status));
      const { gifs } = (await answer.json()) as { gifs?: unknown };
      return typeof gifs === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(gifs) ? gifs : null;
    } catch {
      features = undefined;
      return null;
    }
  })();
  return features;
}

/** (Tests: forget what was asked.) */
export function forgetKlipy(): void {
  features = undefined;
  customer = undefined;
}
