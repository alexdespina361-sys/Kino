import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAccount } from "../account/AccountProvider";
import { hasNewActivity } from "./bell";
import { useFriends } from "./FriendsProvider";

/** When the bell was last opened on this device, for this profile: what friends watched after that is new to it. (A device's own fact, so it is kept here, not on the server.) */
const key = (profileId: string) => `kino.bellSeen.${profileId}`;

function read(profileId: string): number | null {
  try {
    const raw = localStorage.getItem(key(profileId));
    return raw === null ? null : Number(raw) || 0;
  } catch {
    return null;
  }
}

function write(profileId: string, at: number) {
  try {
    localStorage.setItem(key(profileId), String(at));
  } catch {
    // (a browser that keeps nothing: the dot is on until the page is opened again, which is all it costs)
  }
}

/** The bell is in more than one place at once (its button, the list it opens): they share the time it was last opened. */
const seenAt = new Map<string, number>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const remember = (profileId: string, at: number) => {
  seenAt.set(profileId, at);
  listeners.forEach((listener) => listener());
};

/**
 * What the bell in the corner says: whether it is there at all (a profile that is signed in and has friends on), how many things wait for an answer
 * (the badge), and whether friends watched something since it was last opened (a dot, when nothing waits). `markSeen` is called when it is opened.
 */
export function useBell() {
  const account = useAccount();
  const friends = useFriends();
  const profileId = account.me && account.profile ? account.profile.id : undefined;
  const loaded = friends.state !== null;
  const seen = useSyncExternalStore(subscribe, () => (profileId ? (seenAt.get(profileId) ?? 0) : 0));

  // The first time a device sees its friends, what they watched before is not news.
  useEffect(() => {
    if (!profileId || !loaded || seenAt.has(profileId)) return;
    const stored = read(profileId);
    const at = stored ?? Date.now();
    if (stored === null) write(profileId, at);
    remember(profileId, at);
  }, [profileId, loaded]);

  const markSeen = useCallback(() => {
    if (!profileId) return;
    const now = Date.now();
    write(profileId, now);
    remember(profileId, now);
  }, [profileId]);

  const on = friends.on && profileId !== undefined;
  return { on, badge: on ? friends.attention : 0, fresh: on && seen > 0 && friends.state !== null && hasNewActivity(friends.state, seen), markSeen };
}
