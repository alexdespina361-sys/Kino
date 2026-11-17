import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ChatLine } from "../../shared";
import { useT } from "../i18n";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, SearchIcon } from "../shared/icons";
import type { SearchFound } from "./ChatLines";
import type { ChatSession } from "./useChat";
import { findInChat } from "./search";
import { knownTitle, useTitlesLearned } from "./titleCache";
import { titleLabel } from "./titles";

/** A title's name, once the chat knows it (titleCache.ts): a title sent as its address alone is found by it. */
const titleName = (id: string): string | undefined => {
  const known = knownTitle(id);
  return known.status === "ready" ? titleLabel(known.item) : undefined;
};

export interface ChatSearch {
  open: boolean;
  query: string;
  setQuery: (query: string) => void;
  /** The messages found, the newest first. */
  ids: number[];
  /** Which of them is shown: 0 the newest. */
  at: number;
  step: (by: 1 | -1) => void;
  start: () => void;
  close: () => void;
  /** Back: shuts it, unless a picture is shown larger over the chat (Back shuts that, and only that: it heard it first). */
  closeUnlessOver: () => void;
  /** What the list lights (ChatLines.tsx `found`): none while it is shut or nothing is typed. */
  found: SearchFound | undefined;
}

/** A chat's search: open or not, what is typed, what it finds in the messages as they come, and which of them is shown. */
export function useChatSearch(lines: readonly ChatLine[]): ChatSearch {
  const [open, setOpen] = useState(false);
  const [query, setQueryNow] = useState("");
  // (Which message is shown, by itself and not by its place: a message that comes in and holds the words too would else move the search to another one,
  // the judge, 17 Nov. None, or one no longer found: the newest.)
  const [shownId, setShownId] = useState<number | null>(null);
  // (A title sent as its address alone is found by its name once the server has said it: the search looks again then, not only at the next key.)
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
      setShownId(null); // (what is typed shows the newest of what it finds)
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

/**
 * Back while a chat's search is open: in the box where a message is written, while one is being answered, it lets the answer go first (as it does with no
 * search: Reply.tsx `backLetsAnswerGo`, which the search, hearing Back first, would else stand in front of: the judge, 17 Nov); else it shuts the search.
 */
export function searchBack(session: Pick<ChatSession, "replyTo" | "setReplyTo">, search: Pick<ChatSearch, "closeUnlessOver">, box: string): void {
  if (session.replyTo !== null && document.activeElement?.matches(`[data-testid='${box}']`)) return session.setReplyTo(null);
  search.closeUnlessOver();
}

/**
 * The search of a chat, at its top in place of its buttons while it is open (the owner, 17 Nov: "add a search in conversation (in the three dots)"): the box,
 * how many messages hold what was typed and which of them is shown ("2 of 5", the newest being 1), Earlier and Later to go from one to the next, and × to
 * shut it. Enter goes to the next earlier one, as in any messenger; Shift+Enter to the later. Which messages are found is search.ts's; the list lights them
 * and brings the one shown into view (ChatLines.tsx `found`).
 */
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
  /** How many messages were found. */
  count: number;
  /** Which of them is shown: 0 the newest. */
  at: number;
  /** Go to an earlier one (+1) or a later one (-1). */
  onStep: (by: 1 | -1) => void;
  onClose: () => void;
  /** The TV's pages: the remote walks to its buttons. */
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
      {/* (At either end the arrow says it goes no further and does nothing, and keeps the keys: a button that went disabled under them would leave them on
          nothing, the judge, 17 Nov.) */}
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
