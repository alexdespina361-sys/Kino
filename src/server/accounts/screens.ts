import { randomBytes } from "node:crypto";
import { friendChoices, type PartyProfile } from "../../shared";
import type { AccountStore } from "./store";

/**
 * How a screen shows whose it is. A TV or a phone that is signed in as a profile asks the server for a proof of it (only the signed-in account
 * that has the profile gets one), and gives that to the watch party it is in, which cannot see cookies: the proof is good once, for a couple
 * of minutes. What the party then shows of a screen is what the server checked, not what the screen says of itself.
 */
const PROOF_TTL_MS = 2 * 60_000;
/** Proofs are made on demand and used at once: this many at a time is more than a server of friends will ever have out. */
const MAX_PROOFS = 2000;

export class ScreenProofs {
  private readonly proofs = new Map<string, { profileId: string; expires: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(profileId: string): string {
    const now = this.now();
    for (const [proof, entry] of this.proofs) if (entry.expires <= now) this.proofs.delete(proof);
    while (this.proofs.size >= MAX_PROOFS) this.proofs.delete(this.proofs.keys().next().value as string);
    const proof = randomBytes(18).toString("base64url");
    this.proofs.set(proof, { profileId, expires: now + PROOF_TTL_MS });
    return proof;
  }

  /** The profile a proof was made for: once (it is spent), and only while it is good. */
  redeem(proof: string): string | undefined {
    const entry = this.proofs.get(proof);
    this.proofs.delete(proof);
    return entry && entry.expires > this.now() ? entry.profileId : undefined;
  }
}

/** What the watch parties ask of the accounts: whose a screen is, and how a party shows them. */
export interface ScreenProfiles {
  redeem(proof: string): string | undefined;
  /** The profile as a party shows it. Nothing for one that is gone or has friends turned off: it cannot be found by its tag then, so it is not shown by it either. */
  card(profileId: string): PartyProfile | undefined;
}

export function screenProfiles(store: AccountStore, proofs: ScreenProofs): ScreenProfiles {
  return {
    redeem: (proof) => proofs.redeem(proof),
    card(profileId) {
      const card = store.profileCard(profileId);
      if (!card || card.tag === undefined || !friendChoices(store.settingsOf(profileId)).friends) return undefined;
      return { name: card.name, avatar: card.avatar, tag: card.tag };
    },
  };
}
