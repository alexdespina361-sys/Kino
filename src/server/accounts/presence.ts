import { ONLINE_MS } from "../../shared";

export class Presence {
  private readonly seen = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  heartbeat(profileId: string): void {
    const at = this.now();
    this.seen.set(profileId, at);
    if (this.seen.size > 2000) this.prune(at);
  }

  online(profileId: string): boolean {
    const at = this.seen.get(profileId);
    return at !== undefined && this.now() - at < ONLINE_MS;
  }

  forget(profileId: string): void {
    this.seen.delete(profileId);
  }

  private prune(now: number): void {
    for (const [id, at] of this.seen) if (now - at >= ONLINE_MS) this.seen.delete(id);
  }
}
