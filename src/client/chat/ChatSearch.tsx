import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ChatLine } from "../../shared";
import { useT } from "../i18n";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, SearchIcon } from "../shared/icons";
import type { SearchFound } from "./ChatLines";
import { findInChat } from "./search";
import { knownTitle } from "./titleCache";
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
  const [at, setAt] = useState(0);
  const ids = useMemo(() => (open ? findInChat(lines, query, titleName) : []), [open, lines, query]);
  const shown = Math.min(at, Math.max(0, ids.length - 1));
  const current = ids[shown] ?? null;
  const found = useMemo(() => (open && ids.length > 0 ? { query, ids: new Set(ids), current } : undefined), [open, ids, query, current]);
  const close = () => {
    setOpen(false);
    setQueryNow("");
    setAt(0);
  };
  return {
    open,
    query,
    setQuery: (next) => {
      setQueryNow(next);
      setAt(0); // (what is typed shows the newest of what it finds)
    },
    ids,
    at: shown,
    step: (by) => setAt(Math.max(0, Math.min(ids.length - 1, shown + by))),
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
      <button type="button" className="chat-search-step" onClick={() => onStep(1)} disabled={at >= count - 1} aria-label={t("chat.searchOlder")} title={t("chat.searchOlder")} {...navigable} data-testid="chat-search-older">
        <ChevronUpIcon />
      </button>
      <button type="button" className="chat-search-step" onClick={() => onStep(-1)} disabled={at <= 0} aria-label={t("chat.searchNewer")} title={t("chat.searchNewer")} {...navigable} data-testid="chat-search-newer">
        <ChevronDownIcon />
      </button>
      <button type="button" className="chat-search-step" onClick={onClose} aria-label={t("chat.searchClose")} title={t("chat.searchClose")} {...navigable} data-testid="chat-search-close">
        <CloseIcon />
      </button>
    </div>
  );
}
