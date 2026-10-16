import type { PartyView } from "../../shared";
import { t } from "../i18n";

/** Why a party's film is held, as its host last said (see TV_SYNC): who paused it, that its picture is only waiting for data, or that it played to its end. */
export interface Hold {
  /** The screen that paused it (`PartyTv.id`), when that is known. */
  by: string | null;
  waiting: boolean;
  /** The film is over: nobody paused it. */
  ended?: boolean;
}

/** Whether two holds are the same, so that the every-second report of a held film does not draw it again. */
export const sameHold = (a: Hold | null, b: Hold | null): boolean =>
  a === b || (a !== null && b !== null && a.by === b.by && a.waiting === b.waiting && Boolean(a.ended) === Boolean(b.ended));

/** How a screen of the party is named in a line: the profile signed in on it, or else what the screen is called. Null for one that is not (or no longer) in the party. */
export function partyName(party: PartyView | null, id: string | null | undefined): string | null {
  if (!party || !id) return null;
  const tv = id === party.host.id ? party.host : party.guests.find((guest) => guest.id === id);
  return tv ? (tv.profile?.name ?? tv.name) : null;
}

/**
 * What the pause card says about whose doing a held film is. Null when there is nobody to name (a film that is not held, or whose screen has left).
 * `host` is the screen that is followed: a screen with no list of the party (one a phone added) still knows whose film it waits for.
 * A film that is over is nobody's pause: it says it is finished.
 */
export function holdLine(hold: Hold | null, party: PartyView | null, host: string | null = null, say: typeof t = t): string | null {
  if (!hold) return null;
  if (hold.ended) return say("end.finished");
  const name = partyName(party, hold.by);
  if (hold.waiting) {
    const who = name ?? host;
    return who ? say("party.waitingFor", { name: who }) : null;
  }
  if (!name) return null;
  return hold.by === party?.you ? say("party.pausedByYou") : say("party.pausedBy", { name });
}

/** What is said when somebody else sets a held film going again. Null for your own doing (you know), or for a screen that is not named. */
export function resumeLine(by: string | null | undefined, party: PartyView | null, say: typeof t = t): string | null {
  const name = partyName(party, by);
  return name && by !== party?.you ? say("party.resumedBy", { name }) : null;
}
