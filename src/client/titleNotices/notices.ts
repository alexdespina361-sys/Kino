import { useCallback, useEffect, useSyncExternalStore } from "react";
import { TitleNoticesSchema, type TitleNotice } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { ask } from "../account/api";
import { t } from "../i18n";
import type { Entry } from "../tv/pages";

export const NOTICE_LOOK_MS = 20 * 60_000;
export const NOTICE_WAKE_MS = 5 * 60_000;
export const BELL_TITLES = 6;

const NONE: readonly TitleNotice[] = [];
let ownerId: string | undefined;
let items: readonly TitleNotice[] = NONE;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const same = (a: readonly TitleNotice[], b: readonly TitleNotice[]) => a.length === b.length && a.every((item, index) => JSON.stringify(item) === JSON.stringify(b[index]));
function keep(profileId: string | undefined, next: readonly TitleNotice[]) {
  if (ownerId === profileId && same(items, next)) return;
  ownerId = profileId;
  items = next.length === 0 ? NONE : next;
  listeners.forEach((listener) => listener());
}

const base = (profileId: string) => `/api/profiles/${encodeURIComponent(profileId)}/title-notices`;
const taken = (profileId: string) => (answer: { items: TitleNotice[] }) => {
  if (ownerId === profileId) keep(profileId, answer.items);
};

export const resetTitleNotices = () => keep(undefined, NONE);

export function noticeLine(notice: TitleNotice): string {
  if (notice.what === "film") return notice.like ? t("titleNotice.filmLike", { title: notice.like }) : t("titleNotice.film");
  if (notice.what === "episode" && (notice.season === undefined || notice.episode === undefined)) return notice.count ? t("titleNotice.episodesNoNumber", { count: notice.count }) : t("titleNotice.episodeNoNumber");
  const season = notice.season ?? 1;
  const episode = notice.episode ?? 1;
  if (notice.what === "season") return t("titleNotice.season", { season });
  return notice.count ? t("titleNotice.episodes", { count: notice.count, season, episode }) : t("titleNotice.episode", { season, episode });
}

export const entryOfNotice = (notice: TitleNotice): Entry => ({
  id: `new:${notice.id}`,
  title: notice.title,
  url: notice.url,
  note: noticeLine(notice),
  kind: notice.what === "film" ? "movie" : "series",
  ...(notice.image ? { image: notice.image } : {}),
  ...(notice.backdrop ? { backdrop: notice.backdrop } : {}),
  ...(notice.year !== undefined ? { year: notice.year } : {}),
});

export function useTitleNoticeLooks(): void {
  const account = useAccount();
  const profileId = account.me && account.profile && !account.profile.setup ? account.profile.id : undefined;
  useEffect(() => {
    keep(profileId, NONE);
    if (!profileId) return;
    let stopped = false;
    let lastAnswer = 0;
    const look = () =>
      void ask(TitleNoticesSchema, "GET", base(profileId))
        .then((answer) => {
          lastAnswer = Date.now();
          if (!stopped) taken(profileId)(answer);
        })
        .catch(() => undefined);
    look();
    const every = setInterval(() => document.visibilityState === "visible" && look(), NOTICE_LOOK_MS);
    const wake = () => document.visibilityState === "visible" && Date.now() - lastAnswer >= NOTICE_WAKE_MS && look();
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped = true;
      clearInterval(every);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [profileId]);
}

const unseen = (all: readonly TitleNotice[]) => all.slice(0, BELL_TITLES).filter((item) => !item.read);

export function useTitleNotices(): { items: readonly TitleNotice[]; unread: number; seen: () => void; dismiss: (id: string) => void } {
  const kept = useSyncExternalStore(subscribe, () => items);
  const profileId = useSyncExternalStore(subscribe, () => ownerId);
  const seen = useCallback(() => {
    const ids = unseen(items).map((item) => item.id);
    if (!profileId || ids.length === 0) return;
    void ask(TitleNoticesSchema, "POST", `${base(profileId)}/seen`, { ids }).then(taken(profileId)).catch(() => undefined);
  }, [profileId]);
  const dismiss = useCallback(
    (id: string) => {
      if (!profileId) return;
      keep(profileId, items.filter((item) => item.id !== id));
      void ask(TitleNoticesSchema, "POST", `${base(profileId)}/dismiss`, { id: id }).then(taken(profileId)).catch(() => undefined);
    },
    [profileId],
  );
  return { items: kept.length > BELL_TITLES ? kept.slice(0, BELL_TITLES) : kept, unread: unseen(kept).length, seen, dismiss };
}
