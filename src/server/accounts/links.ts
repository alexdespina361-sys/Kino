import { createHash, randomBytes, randomInt } from "node:crypto";
import type { DeviceKind, LinkView } from "../../shared";

/**
 * Signing a TV in from a phone that is already signed in. The TV asks for a link and shows its code (as a QR code and as
 * text); the phone opens the code, shows which device is asking, and the person approves; the TV, which has been asking
 * every couple of seconds with a secret only it knows, is then given its own session.
 *
 * Nothing here signs anyone in by itself: a link is a request that a signed-in person approves or does not. The phone
 * says what the request is for and the code is read off the TV's own screen, so someone who puts their own TV's code in
 * front of you (a printed QR code, a link in a message) gets nothing unless you approve it, and the approval screen says to
 * check.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I to mix up when read aloud
const CODE_LENGTH = 8;
const TTL_MS = 5 * 60 * 1000;
const MAX_LINKS = 1000;
/** How many requests one address may have open at once (a household has a few TVs; a flood has more). */
const MAX_PER_ADDRESS = 10;

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

interface Link {
  code: string;
  secretHash: string;
  kind: DeviceKind;
  label: string;
  /** Where the request came from (what `MAX_PER_ADDRESS` counts), when that was told. */
  address?: string;
  expiresAt: number;
  state: "waiting" | "approved" | "denied";
  accountId?: string;
}

export type Claim =
  | { status: "waiting" | "denied" | "gone" }
  /** Approved: the link is used up here, and the caller creates the session. */
  | { status: "approved"; accountId: string; kind: DeviceKind; label: string };

export class LinkRegistry {
  private readonly links = new Map<string, Link>();

  constructor(private readonly now: () => number = Date.now) {}

  private live(code: string): Link | undefined {
    const link = this.links.get(code);
    if (!link) return undefined;
    if (link.expiresAt <= this.now()) {
      this.links.delete(code);
      return undefined;
    }
    return link;
  }

  private sweep() {
    for (const code of [...this.links.keys()]) this.live(code);
  }

  /**
   * A new request from a device that wants to be signed in, made from `address`. It always has its place, so that a flood cannot leave every real TV turned away:
   * when the address has `MAX_PER_ADDRESS` requests open the oldest of them gives way, and when the table is full so does the oldest of all (a device whose request
   * gave way asks again, as it does for one that ran out of time). `undefined` is for a table that cannot make room, which this one always can.
   */
  start(kind: DeviceKind, label: string, address?: string): { code: string; secret: string; expiresAt: number } | undefined {
    this.sweep();
    if (address !== undefined) {
      // (The table is in the order the requests came, the oldest first, and one more is coming.)
      const mine = [...this.links.values()].filter((link) => link.address === address);
      for (const old of mine.slice(0, Math.max(0, mine.length - MAX_PER_ADDRESS + 1))) this.links.delete(old.code);
    }
    if (this.links.size >= MAX_LINKS) {
      const oldest = this.links.keys().next().value;
      if (oldest !== undefined) this.links.delete(oldest);
    }
    let code = "";
    do code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    while (this.links.has(code));
    const secret = randomBytes(24).toString("base64url");
    const expiresAt = this.now() + TTL_MS;
    this.links.set(code, { code, secretHash: hash(secret), kind, label, ...(address !== undefined ? { address } : {}), expiresAt, state: "waiting" });
    return { code, secret, expiresAt };
  }

  /** What the person is being asked to approve. Only a request that is still waiting can be looked at. */
  peek(code: string): LinkView | undefined {
    const link = this.live(normalise(code));
    if (!link || link.state !== "waiting") return undefined;
    return { code: link.code, kind: link.kind, label: link.label, expiresAt: link.expiresAt };
  }

  approve(code: string, accountId: string): boolean {
    const link = this.live(normalise(code));
    if (!link || link.state !== "waiting") return false;
    link.state = "approved";
    link.accountId = accountId;
    return true;
  }

  deny(code: string): boolean {
    const link = this.live(normalise(code));
    if (!link || link.state !== "waiting") return false;
    link.state = "denied";
    return true;
  }

  /** The device asks how its request is going. An approval is handed over once. */
  claim(code: string, secret: string): Claim {
    const link = this.live(normalise(code));
    if (!link || link.secretHash !== hash(secret)) return { status: "gone" };
    if (link.state === "waiting") return { status: "waiting" };
    this.links.delete(link.code);
    if (link.state === "denied" || !link.accountId) return { status: "denied" };
    return { status: "approved", accountId: link.accountId, kind: link.kind, label: link.label };
  }
}

/** What people type or a QR code carries: any case, with or without a dash. */
export const normalise = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
