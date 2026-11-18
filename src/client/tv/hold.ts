import type { PartyView } from "../../shared";
import { t } from "../i18n";

export interface Hold {
  by: string | null;
  waiting: boolean;
  ended?: boolean;
}

export const sameHold = (a: Hold | null, b: Hold | null): boolean =>
  a === b || (a !== null && b !== null && a.by === b.by && a.waiting === b.waiting && Boolean(a.ended) === Boolean(b.ended));

export function partyName(party: PartyView | null, id: string | null | undefined): string | null {
  if (!party || !id) return null;
  const tv = id === party.host.id ? party.host : party.guests.find((guest) => guest.id === id);
  return tv ? (tv.profile?.name ?? tv.name) : null;
}

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

export function resumeLine(by: string | null | undefined, party: PartyView | null, say: typeof t = t): string | null {
  const name = partyName(party, by);
  return name && by !== party?.you ? say("party.resumedBy", { name }) : null;
}
