import { readStorage, writeStorage } from "./shared/format";

/** What this screen is for: the TV that plays, or the remote that chooses what plays. */
export type Role = "tv" | "remote";

export const ROLE_KEY = "kino.role";

export interface RoleInput {
  pathname: string;
  search: string;
  /** What someone chose with the switch on an earlier visit. */
  storedRole: string | undefined;
  userAgent: string;
  /** `navigator.maxTouchPoints`: phones and tablets have touch, TVs and desktops do not. */
  touchPoints: number;
}

/** TV browsers say so in their user agent: Fire TV ("AFTM"), Tizen, webOS, Android TV sets, Chromecast, Apple TV, Roku... */
const TV_AGENT = /smart-?tv|hbbtv|netcast|googletv|android ?tv|bravia|\bAFT[A-Z0-9]*\b|crkey|appletv|web0s|webos|tizen|roku|viera|nettv/i;

/**
 * One page, two screens. In order: an address that asks for one ("/tv", "?role=remote", the "?party=" link of a watch party,
 * which is for a screen that plays, or the "?code=" / "?link=" / "?url=" links made for the phone), then what was chosen with
 * the switch, then a guess from the device: a TV's browser, or any screen without touch (a TV, a monitor), plays; a phone or
 * tablet is the remote.
 */
export function chooseRole(input: RoleInput): Role {
  if (input.pathname.replace(/\/+$/, "") === "/tv") return "tv";
  const params = new URLSearchParams(input.search);
  const asked = params.get("role");
  if (asked === "tv" || asked === "remote") return asked;
  if (params.has("party")) return "tv";
  if (params.has("code") || params.has("url") || params.has("text") || params.has("link")) return "remote";
  if (input.storedRole === "tv" || input.storedRole === "remote") return input.storedRole;
  if (TV_AGENT.test(input.userAgent)) return "tv";
  return input.touchPoints > 0 ? "remote" : "tv";
}

export interface PhoneInput {
  userAgent: string;
  touchPoints: number;
  /** `(pointer: coarse)`: a finger is the screen's main way in. A laptop with a touch screen besides its pad and mouse says no. */
  coarsePointer: boolean;
  /** The shorter side of the device's screen, in CSS pixels: the same whichever way it is held. */
  shortSide: number;
}

/** Below this a screen is a phone's. A tablet is big enough to be somebody's screen, with a phone for its remote. */
const PHONE_SHORT_SIDE = 600;

/** A phone: held in the hand, where a TV, a monitor, a laptop or a tablet is not. The remote is what such a device is for. */
export const isPhone = (input: PhoneInput): boolean =>
  input.touchPoints > 0 && input.coarsePointer && input.shortSide < PHONE_SHORT_SIDE && !TV_AGENT.test(input.userAgent);

export const thisIsPhone = (): boolean =>
  isPhone({
    userAgent: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints ?? 0,
    coarsePointer: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
    shortSide: Math.min(screen.width, screen.height),
  });

export const roleOfThisPage = (): Role =>
  chooseRole({
    pathname: location.pathname,
    search: location.search,
    storedRole: readStorage(ROLE_KEY),
    userAgent: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints ?? 0,
  });

/** Make this screen the other one, and remember it. A fresh load of "/" keeps the two screens' styles and connections apart. */
export function switchRole(to: Role): void {
  writeStorage(ROLE_KEY, to);
  location.assign("/");
}
