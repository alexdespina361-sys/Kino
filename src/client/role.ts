import { readStorage, writeStorage } from "./shared/format";
import { hasKept } from "./shared/kept";

export type Role = "tv" | "remote";

export const ROLE_KEY = "kino.role";
export const CONTROLLER_KEY = "controller.id";

export interface RoleInput {
  pathname: string;
  search: string;
  storedRole: string | undefined;
  userAgent: string;
  touchPoints: number;
  remoteBefore: boolean;
}

const TV_AGENT = /smart-?tv|hbbtv|netcast|googletv|android ?tv|bravia|\bAFT[A-Z0-9]*\b|crkey|appletv|web0s|webos|tizen|vidaa|roku|viera|nettv/i;

export const isTvAgent = (userAgent: string): boolean => TV_AGENT.test(userAgent);

export function chooseRole(input: RoleInput): Role {
  if (input.pathname.replace(/\/+$/, "") === "/tv") return "tv";
  const params = new URLSearchParams(input.search);
  const asked = params.get("role");
  if (asked === "tv" || asked === "remote") return asked;
  if (params.has("party") || params.has("title")) return "tv";
  if (params.has("code") || params.has("url") || params.has("text") || params.has("link") || params.has("friend")) return "remote";
  if (input.storedRole === "tv" || input.storedRole === "remote") return input.storedRole;
  if (TV_AGENT.test(input.userAgent)) return "tv";
  return input.touchPoints > 0 && input.remoteBefore ? "remote" : "tv";
}

export interface PhoneInput {
  userAgent: string;
  touchPoints: number;
  coarsePointer: boolean;
  shortSide: number;
}

const PHONE_SHORT_SIDE = 600;

export const isHandHeld = (input: Omit<PhoneInput, "shortSide">): boolean => input.touchPoints > 0 && input.coarsePointer && !TV_AGENT.test(input.userAgent);

export const isPhone = (input: PhoneInput): boolean => isHandHeld(input) && input.shortSide < PHONE_SHORT_SIDE;

const thisDevice = () => ({
  userAgent: navigator.userAgent,
  touchPoints: navigator.maxTouchPoints ?? 0,
  coarsePointer: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
});

export const thisIsPhone = (): boolean => isPhone({ ...thisDevice(), shortSide: Math.min(screen.width, screen.height) });

export const thisIsHandHeld = (): boolean => isHandHeld(thisDevice());

export interface DeskInput {
  userAgent: string;
  finePointer: boolean;
}

export const isDesk = (input: DeskInput): boolean => input.finePointer && !TV_AGENT.test(input.userAgent) && !/android|iphone|ipad|ipod/i.test(input.userAgent);

export const FIT_KEY = "kino.fit";

export const thisIsDesk = (): boolean => {
  const chosen = readStorage(FIT_KEY);
  if (chosen === "couch" || chosen === "desk") return chosen === "desk";
  return isDesk({ userAgent: navigator.userAgent, finePointer: typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches });
};

export const roleOfThisPage = (): Role =>
  chooseRole({
    pathname: location.pathname,
    search: location.search,
    storedRole: readStorage(ROLE_KEY),
    userAgent: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints ?? 0,
    remoteBefore: hasKept(CONTROLLER_KEY),
  });

export type Tier = "full" | "lite";
export const TIER_KEY = "kino.tier";
export const SLOW_KEY = "kino.slow";
export const SLOW_START_MS = 1500;
export const QUICK_START_MS = 400;

export interface TierInput {
  asked: string | null;
  pinned: string | undefined;
  slow: boolean;
  userAgent: string;
  cores: number | undefined;
  memoryGb: number | undefined;
}

export function chooseTier(input: TierInput): Tier {
  const pin = input.asked ?? input.pinned;
  if (pin === "full" || pin === "lite") return pin;
  if (input.slow || TV_AGENT.test(input.userAgent)) return "lite";
  if (input.cores !== undefined && input.cores > 0 && input.cores <= 2) return "lite";
  return input.memoryGb !== undefined && input.memoryGb <= 2 ? "lite" : "full";
}

export const SLOW_STRIKES = 2;
export const SLOW_FOR_MS = 7 * 24 * 3600 * 1000;
export interface Slowness {
  strikes: number;
  until: number;
}

export function nextSlowness(busyMs: number, was: Slowness, now: number): Slowness {
  if (busyMs <= QUICK_START_MS) return { strikes: 0, until: 0 };
  if (busyMs < SLOW_START_MS) return was;
  const strikes = was.strikes + 1;
  return strikes >= SLOW_STRIKES ? { strikes: 0, until: now + SLOW_FOR_MS } : { strikes, until: was.until };
}

export function readSlowness(text: string | undefined): Slowness {
  try {
    const kept = JSON.parse(text ?? "") as Partial<Slowness>;
    return { strikes: Number.isFinite(kept.strikes) ? Number(kept.strikes) : 0, until: Number.isFinite(kept.until) ? Number(kept.until) : 0 };
  } catch {
    return { strikes: 0, until: 0 };
  }
}

let tier: Tier | undefined;
export const thisTier = (): Tier =>
  (tier ??= chooseTier({
    asked: new URLSearchParams(location.search).get("tier"),
    pinned: readStorage(TIER_KEY),
    slow: readSlowness(readStorage(SLOW_KEY)).until > Date.now(),
    userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency || undefined,
    memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  }));

export function watchStartSpeed(windowMs = 10_000): void {
  if (thisTier() !== "full" || navigator.webdriver || typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("longtask")) return;
  let busy = 0;
  let hidden = document.visibilityState !== "visible";
  const onHide = () => (hidden ||= document.visibilityState !== "visible");
  document.addEventListener("visibilitychange", onHide);
  const watch = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) busy += entry.duration;
  });
  watch.observe({ entryTypes: ["longtask"] });
  setTimeout(() => {
    watch.disconnect();
    document.removeEventListener("visibilitychange", onHide);
    if (hidden) return;
    const next = nextSlowness(busy, readSlowness(readStorage(SLOW_KEY)), Date.now());
    writeStorage(SLOW_KEY, next.strikes || next.until ? JSON.stringify(next) : null);
  }, windowMs);
}

export function playOnTv(link: string, startAt?: number): void {
  if (readStorage(ROLE_KEY) === undefined) writeStorage(ROLE_KEY, "tv");
  const at = startAt !== undefined && Number.isFinite(startAt) ? Math.floor(startAt) : 0;
  location.assign(`/?url=${encodeURIComponent(link)}${at > 0 ? `&t=${at}` : ""}`);
}

export function switchRole(to: Role): void {
  writeStorage(ROLE_KEY, to);
  location.assign("/");
}
