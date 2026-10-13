import { ONLINE_MS } from "../../shared";

/**
 * Which profiles have a screen open right now. A screen that is in view asks after its friends every half minute (and not at all once it
 * is out of view), and each of those looks is a sign of life. Kept in memory and nowhere else: after a restart nobody is online until the
 * screens look again, which they do within half a minute.
 */
export class Presence {
  private readonly seen = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  /** A screen of this profile just looked. */
  heartbeat(profileId: string): void {
    const at = this.now();
    this.seen.set(profileId, at);
    if (this.seen.size > 2000) this.prune(at);
  }

  /** Whether a screen of this profile looked less than `ONLINE_MS` ago. */
  online(profileId: string): boolean {
    const at = this.seen.get(profileId);
    return at !== undefined && this.now() - at < ONLINE_MS;
  }

  /** A profile that does not want to be seen as online (or is gone) is not remembered as having looked. */
  forget(profileId: string): void {
    this.seen.delete(profileId);
  }

  private prune(now: number): void {
    for (const [id, at] of this.seen) if (now - at >= ONLINE_MS) this.seen.delete(id);
  }
}
