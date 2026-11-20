import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAccount } from "../account/AccountProvider";
import { chatWaiting } from "../chat/notices";
import { hasNewActivity } from "./bell";
import { useFriends } from "./FriendsProvider";
import { useTitleNotices } from "../titleNotices/notices";

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
  }
}

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

export function useBell(chatsApart = false) {
  const account = useAccount();
  const friends = useFriends();
  const profileId = account.me && account.profile ? account.profile.id : undefined;
  const loaded = friends.state !== null;
  const seen = useSyncExternalStore(subscribe, () => (profileId ? (seenAt.get(profileId) ?? 0) : 0));

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

  const titles = useTitleNotices();
  const on = (friends.on || titles.items.length > 0) && profileId !== undefined;
  const chats = chatsApart ? chatWaiting(friends.state).length : 0;
  return { on, badge: on ? friends.attention - chats + titles.unread : 0, fresh: on && seen > 0 && friends.state !== null && hasNewActivity(friends.state, seen), markSeen, seen };
}
