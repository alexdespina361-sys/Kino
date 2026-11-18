import { nameIdOf } from "../../shared";
import type { AccountStore } from "../accounts/store";
import { FOLLOWED_MAX, type Followed, type Follower } from "./book";

/**
 * Who watches what, for the notices of new episodes and films (book.ts): the titles a profile has a card of ("Continue watching" and what it
 * finished: a card is kept for both) and the ones it rated, the newest first. Only a title with a number in the movie database counts, which the
 * library's own links have (shared/names.ts `nameIdOf`); what was saved to a list and never played is not watched.
 */
export function followersOf(store: AccountStore): Follower[] {
  return store.profileIds().map((profile) => {
    const settings = store.settingsOf(profile);
    const kept: Array<{ at: number; url: string; title: string }> = [];
    for (const name of ["progress", "ratings"] as const) {
      for (const item of store.items(profile, name)) {
        const live = item as { deleted?: boolean; at: number; url?: string; title?: string };
        if (!live.deleted && typeof live.url === "string") kept.push({ at: live.at, url: live.url, title: live.title ?? "" });
      }
    }
    const titles = new Map<string, Followed>();
    for (const item of kept.sort((a, b) => b.at - a.at)) {
      if (titles.size >= FOLLOWED_MAX) break;
      const key = nameIdOf({ url: item.url });
      if (key && !titles.has(key)) titles.set(key, { key, title: item.title });
    }
    return { profile, on: settings.titleNotices !== false, child: settings.child === true, titles: [...titles.values()] };
  });
}
