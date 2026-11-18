import { gifOf, KLIPY_HOSTS } from "../../shared/gifs";

export { gifOf, KLIPY_HOSTS };

export interface Gif {
  slug: string;
  title: string;
  thumb: string;
  width: number;
  height: number;
  sent: string;
}

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

const pick = (sizes: KlipySizes, order: readonly (readonly [string, string])[]) => {
  for (const [size, kind] of order) {
    const found = fileAt(sizes, size, kind);
    if (found) return found;
  }
  return null;
};
const SENT = [["sm", "webp"], ["sm", "gif"], ["md", "webp"], ["xs", "webp"], ["md", "gif"], ["xs", "gif"]] as const;
const THUMB = [["sm", "webp"], ["xs", "webp"], ["sm", "gif"], ["xs", "gif"], ["md", "webp"], ["md", "gif"]] as const;

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

export const GIFS_PER_PAGE = 24;

export function klipyLocale(language: string, browser = typeof navigator === "undefined" ? "" : navigator.language): string {
  const region = /^[a-z]{2,3}[-_]([a-z]{2})\b/i.exec(browser)?.[1];
  if (region) return region.toLowerCase();
  return language === "ro" ? "ro" : language === "it" ? "it" : "us";
}

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
export function klipyCustomer(): string {
  if (customer) return customer;
  try {
    const kept = localStorage.getItem(CUSTOMER);
    if (kept && /^[a-z0-9-]{8,64}$/.test(kept)) return (customer = kept);
  } catch {
  }
  const made = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  customer = made;
  try {
    localStorage.setItem(CUSTOMER, made);
  } catch {
  }
  return made;
}

let features: Promise<string | null> | undefined;
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

export function forgetKlipy(): void {
  features = undefined;
  customer = undefined;
}
