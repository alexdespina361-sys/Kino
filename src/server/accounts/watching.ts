import { ACTIVITY_MIN_SECONDS, isLive, nameIdOf, type LiveProgress } from "../../shared";
import type { AccountStore } from "./store";

/**
 * What people watch on Kino (the owner, 18 Nov 2026: "Yes, on by default, users can turn off"): the titles the most accounts watched in the last
 * days, for a row on Home. Nobody is named and nothing is counted aloud: the answer is titles, in their order, and nothing else.
 *
 *  - A title counts once for an account, however many of its profiles watched it, and is shown only when people of `WATCHING_MIN_ACCOUNTS`
 *    accounts or more watched it: a title one person watched says nothing of them.
 *  - Only titles of the movie database count (`nameIdOf`): a pasted link is nobody else's business, and the row is drawn from the server's own
 *    knowledge of the title, never from what a screen wrote on its card (a name, a picture, a link anyone could have put there).
 *  - Not counted: a profile that turned it off (`publicWatching: false`), a child's profile, and one that had said no to sharing what it watches
 *    with friends before friends were on for everybody (`friends: false` kept from before, as `friendChoices` reads it), or has friends off.
 *  - Watched means as for friends: played for a minute or more, or to the end, in the last `WATCHING_DAYS` days.
 */
export const WATCHING_DAYS = 7;
export const WATCHING_MIN_ACCOUNTS = 3;
export const WATCHING_MAX = 20;

/** Whether what this profile watches is counted (see above). */
export function counted(settings: { publicWatching?: boolean | undefined; child?: boolean | undefined; friends?: boolean | undefined; friendsOff?: boolean | undefined }): boolean {
  return settings.publicWatching !== false && settings.child !== true && settings.friends !== false && settings.friendsOff !== true;
}

/** The titles watched by people of the most accounts, as the library names them (`filmpire-movie-603`), the most watched first. */
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
