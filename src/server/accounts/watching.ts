import { ACTIVITY_MIN_SECONDS, isLive, nameIdOf, type LiveProgress } from "../../shared";
import type { AccountStore } from "./store";

export const WATCHING_DAYS = 7;
export const WATCHING_MIN_ACCOUNTS = 3;
export const WATCHING_MAX = 20;

export function counted(settings: { child?: boolean | undefined; friends?: boolean | undefined; friendsOff?: boolean | undefined }): boolean {
  return settings.child !== true && settings.friends !== false && settings.friendsOff !== true;
}

export function watchedOnKino(store: AccountStore, now: number = store.clock()): string[] {
  const since = now - WATCHING_DAYS * 24 * 60 * 60_000;
  const accountsOf = new Map<string, Set<string>>();
  const latest = new Map<string, number>();
  for (const profile of store.profileIds()) {
    const account = store.accountOfProfile(profile);
    if (!account || !counted(store.settingsOf(profile))) continue;
    for (const card of store.items(profile, "progress").filter(isLive) as LiveProgress[]) {
      if (card.at < since || card.at > now + 60_000 || (card.done !== true && card.position < ACTIVITY_MIN_SECONDS)) continue;
      const key = nameIdOf({ url: card.url });
      if (!key) continue;
      const id = `filmpire-${key}`;
      let accounts = accountsOf.get(id);
      if (!accounts) accountsOf.set(id, (accounts = new Set()));
      accounts.add(account);
      latest.set(id, Math.max(latest.get(id) ?? 0, card.at));
    }
  }
  return [...accountsOf]
    .filter(([, accounts]) => accounts.size >= WATCHING_MIN_ACCOUNTS)
    .sort(([a, first], [b, second]) => second.size - first.size || (latest.get(b) ?? 0) - (latest.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, WATCHING_MAX)
    .map(([id]) => id);
}
