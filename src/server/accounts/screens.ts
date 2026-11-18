import { randomBytes } from "node:crypto";
import { friendChoices, type PartyProfile } from "../../shared";
import type { AccountStore } from "./store";

const PROOF_TTL_MS = 2 * 60_000;
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

  redeem(proof: string): string | undefined {
    const entry = this.proofs.get(proof);
    this.proofs.delete(proof);
    return entry && entry.expires > this.now() ? entry.profileId : undefined;
  }
}

export interface ScreenProfiles {
  redeem(proof: string): string | undefined;
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
