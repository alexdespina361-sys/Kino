import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ChatLine } from "../../shared";
import { useT } from "../i18n";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, SearchIcon } from "../shared/icons";
import type { SearchFound } from "./ChatLines";
import type { ChatSession } from "./useChat";
import { findInChat } from "./search";
import { knownTitle, useTitlesLearned } from "./titleCache";
import { titleLabel } from "./titles";

const titleName = (id: string): string | undefined => {
  const known = knownTitle(id);
  return known.status === "ready" ? titleLabel(known.item) : undefined;
};

export interface ChatSearch {
  open: boolean;
  query: string;
  setQuery: (query: string) => void;
  ids: number[];
  at: number;
  step: (by: 1 | -1) => void;
  start: () => void;
  close: () => void;
  closeUnlessOver: () => void;
  found: SearchFound | undefined;
}

export function useChatSearch(lines: readonly ChatLine[]): ChatSearch {
  const [open, setOpen] = useState(false);
  const [query, setQueryNow] = useState("");
  const [shownId, setShownId] = useState<number | null>(null);
  const learned = useTitlesLearned();
  const ids = useMemo(() => (open ? findInChat(lines, query, titleName) : []), [open, lines, query, learned]); // eslint-disable-line react-hooks/exhaustive-deps
  const kept = shownId === null ? -1 : ids.indexOf(shownId);
  const shown = kept >= 0 ? kept : 0;
  const current = ids[shown] ?? null;
  const found = useMemo(() => (open && ids.length > 0 ? { query, ids: new Set(ids), current } : undefined), [open, ids, query, current]);
  const close = () => {
    setOpen(false);
    setQueryNow("");
    setShownId(null);
  };
  return {
    open,
    query,
    setQuery: (next) => {
      setQueryNow(next);
      setShownId(null);
    },
    ids,
    at: shown,
    step: (by) => setShownId(ids[Math.max(0, Math.min(ids.length - 1, shown + by))] ?? null),
    start: () => setOpen(true),
    close,
    closeUnlessOver: () => {
      if (document.querySelector("[data-testid='chat-view']")) return;
      close();
    },
    found,
  };
}

export function searchBack(session: Pick<ChatSession, "replyTo" | "setReplyTo">, search: Pick<ChatSearch, "closeUnlessOver">, box: string): void {
  if (session.replyTo !== null && document.activeElement?.matches(`[data-testid='${box}']`)) return session.setReplyTo(null);
  search.closeUnlessOver();
}

export function ChatSearchBar({
  query,
  onQuery,
  count,
  at,
  onStep,
  onClose,
  nav = false,
}: {
  query: string;
  onQuery: (query: string) => void;
  count: number;
  at: number;
  onStep: (by: 1 | -1) => void;
  onClose: () => void;
  nav?: boolean;
}) {
  const t = useT();
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    box.current?.focus({ preventScroll: true });
  }, []);
  const navigable = nav ? { "data-nav": true } : {};
  const typed = query.trim() !== "";
  const older = at < count - 1;
  const newer = at > 0 && count > 0;
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (count > 0) onStep(event.shiftKey ? -1 : 1);
  };
  return (
    <div className="chat-search" role="search" data-testid="chat-search">
      <span className="chat-search-icon" aria-hidden="true">
        <SearchIcon />
      </span>
      <input
        ref={box}
        className="chat-search-box"
        type="search"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={onKey}
        placeholder={t("chat.search")}
        aria-label={t("chat.searchLabel")}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={100}
        {...navigable}
        data-testid="chat-search-box"
      />
      {typed && (
        <span className="chat-search-count" role="status" data-testid="chat-search-count">
          {count === 0 ? t("chat.searchNone") : t("chat.searchCount", { at: at + 1, count })}
        </span>
      )}
      <button type="button" className="chat-search-step" onClick={() => older && onStep(1)} aria-disabled={!older} aria-label={t("chat.searchOlder")} title={t("chat.searchOlder")} {...navigable} data-testid="chat-search-older">
        <ChevronUpIcon />
      </button>
      <button type="button" className="chat-search-step" onClick={() => newer && onStep(-1)} aria-disabled={!newer} aria-label={t("chat.searchNewer")} title={t("chat.searchNewer")} {...navigable} data-testid="chat-search-newer">
        <ChevronDownIcon />
      </button>
      <button type="button" className="chat-search-step" onClick={onClose} aria-label={t("chat.searchClose")} title={t("chat.searchClose")} {...navigable} data-testid="chat-search-close">
        <CloseIcon />
      </button>
    </div>
  );
}
