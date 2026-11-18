import { createHash, randomBytes, randomInt } from "node:crypto";
import { LINK_TTL_MS, type DeviceKind, type LinkView } from "../../shared";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_LINKS = 1000;
const MAX_PER_ADDRESS = 10;

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

interface Link {
  code: string;
  secretHash: string;
  kind: DeviceKind;
  label: string;
  address?: string;
  expiresAt: number;
  state: "waiting" | "approved" | "denied";
  accountId?: string;
}

export type Claim =
  | { status: "waiting" | "denied" | "gone" }
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

  start(kind: DeviceKind, label: string, address?: string): { code: string; secret: string; expiresAt: number } | undefined {
    this.sweep();
    if (address !== undefined) {
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
    const expiresAt = this.now() + LINK_TTL_MS;
    this.links.set(code, { code, secretHash: hash(secret), kind, label, ...(address !== undefined ? { address } : {}), expiresAt, state: "waiting" });
    return { code, secret, expiresAt };
  }

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

  claim(code: string, secret: string): Claim {
    const link = this.live(normalise(code));
    if (!link || link.secretHash !== hash(secret)) return { status: "gone" };
    if (link.state === "waiting") return { status: "waiting" };
    this.links.delete(link.code);
    if (link.state === "denied" || !link.accountId) return { status: "denied" };
    return { status: "approved", accountId: link.accountId, kind: link.kind, label: link.label };
  }
}

export const normalise = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
