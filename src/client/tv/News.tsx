import { useEffect, useRef } from "react";
import { NewsList } from "../changelog/NewsList";
import { useT } from "../i18n";
import { BackButton, Screen } from "./Idle";

/**
 * "What's new", opened from the profile's page: every version of Kino, the newest first. The remote walks the lines (Up, Down), Back or the corner's
 * button leaves. Opening it is seeing the newest version (`onSeen`): the tile stops saying "New".
 */
export function NewsTv({ onClose, onSeen }: { onClose: () => void; onSeen: () => void }) {
  const t = useT();
  const page = useRef<HTMLDivElement>(null);
  useEffect(onSeen, [onSeen]);
  // (The list comes a moment after the page: the remote then goes to its first line, unless it was moved meanwhile.)
  useEffect(() => {
    const root = page.current;
    if (!root) return;
    const watch = new MutationObserver(() => {
      const first = root.querySelector<HTMLElement>(".news-lines li");
      if (!first) return;
      watch.disconnect();
      const now = document.activeElement;
      if (!now || now === document.body || now.classList.contains("tv-back")) first.focus();
    });
    watch.observe(root, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);
  return (
    <Screen testId="tv-news" compact focus onBack={onClose} className="tv-news-screen">
      <BackButton onClick={onClose} testId="tv-news-back" />
      <h1 className="tv-headline tv-headline-small">{t("news.title")}</h1>
      <div ref={page} className="tv-news-body">
        <NewsList remote className="tv-news-list" />
      </div>
    </Screen>
  );
}
