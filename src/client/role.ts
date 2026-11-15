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

/** TV browsers say so in their user agent: Fire TV ("AFTM"), Tizen, webOS, VIDAA (Hisense), Android TV sets, Chromecast, Apple TV, Roku... */
const TV_AGENT = /smart-?tv|hbbtv|netcast|googletv|android ?tv|bravia|\bAFT[A-Z0-9]*\b|crkey|appletv|web0s|webos|tizen|vidaa|roku|viera|nettv/i;

/** Whether the browser says it is a TV's (see `TV_AGENT`). */
export const isTvAgent = (userAgent: string): boolean => TV_AGENT.test(userAgent);

/**
 * One page, two screens. In order: an address that asks for one ("/tv", "?role=remote", the "?party=" link of a watch party and the "?title="
 * link of a title's page, which are for a screen that plays, or the "?code=" / "?link=" / "?friend=" / "?url=" links made for the phone), then what was chosen with
 * the switch, then a guess from the device: a TV's browser, or any screen without touch (a TV, a monitor), plays; a phone or
 * tablet is the remote.
 */
export function chooseRole(input: RoleInput): Role {
  if (input.pathname.replace(/\/+$/, "") === "/tv") return "tv";
  const params = new URLSearchParams(input.search);
  const asked = params.get("role");
  if (asked === "tv" || asked === "remote") return asked;
  if (params.has("party") || params.has("title")) return "tv";
  if (params.has("code") || params.has("url") || params.has("text") || params.has("link") || params.has("friend")) return "remote";
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

/**
 * Held in the hand, or on a lap, and worked with a finger: a phone or a tablet. Its Back is the system's (a button, or a swipe from the edge)
 * and the page is told by the history; a TV's is a key, which the page hears itself, and a laptop with a touch screen besides its pad is not
 * worked with a finger.
 */
export const isHandHeld = (input: Omit<PhoneInput, "shortSide">): boolean => input.touchPoints > 0 && input.coarsePointer && !TV_AGENT.test(input.userAgent);

/** A phone: held in the hand, where a TV, a monitor, a laptop or a tablet is not. The remote is what such a device is for. */
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
  /** `(hover: hover) and (pointer: fine)`: a mouse or a pad is the main way in. */
  finePointer: boolean;
}

/**
 * A computer: a laptop or a PC, worked with a mouse or a pad from an arm's length. Not a TV (its browser says so, and it is looked at from across a room),
 * and not a phone, a tablet or a TV box that happens to have a mouse (Android, iOS). The big screen's page is sized for the couch; on a computer it stops
 * growing with the window past a laptop's width, so a wide monitor shows more titles and not bigger ones (tv.css, `data-fit="desk"`).
 */
export const isDesk = (input: DeskInput): boolean => input.finePointer && !TV_AGENT.test(input.userAgent) && !/android|iphone|ipad|ipod/i.test(input.userAgent);

/** What somebody chose for this device, whatever it looks like: "couch" for a computer that is watched from across a room (plugged into a TV), "desk" for a computer the guess missed. */
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
  });

/** Make this screen the other one, and remember it. A fresh load of "/" keeps the two screens' styles and connections apart. */
export function switchRole(to: Role): void {
  writeStorage(ROLE_KEY, to);
  location.assign("/");
}
