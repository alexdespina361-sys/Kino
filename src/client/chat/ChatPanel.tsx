import { useEffect, useId, useRef, useState } from "react";
import { useT, type Key } from "../i18n";
import { FilmIcon, GifIcon, StickerIcon } from "../shared/icons";
import { useBackFirst } from "../tv/dpad";
import { GifPane } from "./GifPick";
import { StickerPane } from "./StickerPick";
import { TitleList } from "./TitlePick";
import type { ChatSession } from "./useChat";

/**
 * What is sent besides words, in one panel under the box, as a messenger's keyboard of stickers is (the owner, 17 Nov: "instead of three distinct buttons in
 * the chat, it should only be 1 icon which opens a menu like the keyboard with the three menus"): Titles, GIFs and Stickers, a tab each in a row at its foot.
 * One button beside the box opens it; that button again, Back, or a press of the box (where a finger types) shuts it. A press of a title, a GIF or a sticker
 * sends it at once, through the chat's own send, and the panel goes with it; what was typed stays in the box.
 *
 * Only the tab shown is drawn: KLIPY is asked nothing until the GIFs are (see GifPick.tsx). The tab last used is the one that opens next time, on this
 * browser. The GIFs are there where the screen can type a search and the site has a KLIPY key; a TV that is only a remote has Titles and Stickers.
 */

export type PanelTab = "titles" | "gifs" | "stickers";

const TABS: Array<{ tab: PanelTab; label: Key; Icon: typeof FilmIcon }> = [
  { tab: "titles", label: "chat.tabTitles", Icon: FilmIcon },
  { tab: "gifs", label: "chat.tabGifs", Icon: GifIcon },
  { tab: "stickers", label: "chat.tabStickers", Icon: StickerIcon },
];

/** Where the tab last used is kept (this browser's, as a convenience: a private window or blocked storage opens on the stickers). */
export const PANEL_TAB_KEY = "kino.chatPanelTab";

export function savedTab(): PanelTab {
  try {
    const saved = window.localStorage.getItem(PANEL_TAB_KEY);
    if (saved === "titles" || saved === "gifs" || saved === "stickers") return saved;
  } catch {
    // (storage refused: the default)
  }
  return "stickers";
}

function saveTab(tab: PanelTab) {
  try {
    window.localStorage.setItem(PANEL_TAB_KEY, tab);
  } catch {
    // (storage refused: it is only not remembered)
  }
}

export interface ChatPanelProps {
  /** Its id: what the button that opens it names (`aria-controls`). */
  id?: string | undefined;
  session: ChatSession;
  /** Drawn for the TV's pages (a TV, a computer, a hand-held screen showing them); else the phone's sheet. */
  tv: boolean;
  /** Walked with the arrows (the TV's pages: `data-nav` on what it holds). */
  nav: boolean;
  /** The keys land in it as it opens (a remote, a computer's keyboard): not a screen that is touched, where nothing is given a ring it has no use for. */
  land: boolean;
  /** A screen that is touched or clicked: it can add a sticker of its own. */
  pointer: boolean;
  /** The site's KLIPY key where the screen can type a search; none: no GIFs tab. */
  gifKey: string | null;
  /** Back: the panel shuts (and the chat says where the keys go). */
  onClose: () => void;
  /** Something was sent from it: it shuts too. */
  onSent: () => void;
}

export function ChatPanel({ id: panelId, session, tv, nav, land, pointer, gifKey, onClose, onSent }: ChatPanelProps) {
  const t = useT();
  // (The GIFs remembered where there are none - a TV that is only a remote, a site without a key - open the stickers. Which tab opens is decided as it
  // opens: a key that comes a moment later does not change the tab under the keys - the judge, 17 Nov.)
  const [chosen, setChosen] = useState<PanelTab>(() => {
    const saved = savedTab();
    return saved === "gifs" && !gifKey ? "stickers" : saved;
  });
  const tab: PanelTab = chosen === "gifs" && !gifKey ? "stickers" : chosen;
  const tabs = TABS.filter((one) => one.tab !== "gifs" || gifKey);
  const prefix = tv ? "tv-chat" : "chat";
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  // (One Back shuts it, whichever tab is shown: a tab is no page of its own. Something opened over it after it - a message selected, a picture shown larger -
  // is shut first: see `useBackFirst`.)
  useBackFirst(onClose);

  // The keys land on the first thing of the tab shown as it opens (the first sticker, the search of the GIFs, the first title), else on its tab.
  useEffect(() => {
    if (!land) return;
    const pane = root.current?.querySelector<HTMLElement>("[role='tabpanel']");
    const first =
      pane?.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)") ??
      pane?.querySelector<HTMLElement>("[data-nav]:not(:disabled), button:not(:disabled), input") ??
      root.current?.querySelector<HTMLElement>("[role='tab'][aria-selected='true']");
    first?.focus({ preventScroll: true }); // (the pane opens at its top, where the first one is: nothing else moves)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (next: PanelTab) => {
    setChosen(next);
    saveTab(next);
  };

  return (
    <div className={`${prefix}-panel`} ref={root} id={panelId} role="group" aria-label={t("chat.panel")} data-tab={tab} data-testid={`${prefix}-panel`}>
      <div className={`${prefix}-panel-pane`} role="tabpanel" id={`${id}-pane`} aria-labelledby={`${id}-${tab}`} data-testid={`${prefix}-panel-pane`}>
        {tab === "titles" ? (
          <TitleList key="titles" session={session} tv={tv} nav={nav} onSent={onSent} />
        ) : tab === "gifs" && gifKey ? (
          <GifPane key="gifs" gifKey={gifKey} session={session} tv={tv} nav={nav} onSent={onSent} />
        ) : (
          <StickerPane key="stickers" session={session} tv={tv} nav={nav} pointer={pointer} onSent={onSent} />
        )}
      </div>
      {/* (The tabs at the foot, as a messenger's keyboard has them. A tab shows its pane and leaves the keys on itself: the arrows go up into the pane.) */}
      <div className={`${prefix}-panel-tabs`} role="tablist" aria-label={t("chat.panel")}>
        {tabs.map(({ tab: one, label, Icon }) => (
          <button
            key={one}
            type="button"
            role="tab"
            id={`${id}-${one}`}
            className={`${prefix}-panel-tab`}
            aria-selected={one === tab}
            aria-controls={`${id}-pane`}
            onClick={() => choose(one)}
            {...(nav ? { "data-nav": true } : {})}
            data-tab={one}
            data-testid={`${prefix}-panel-tab`}
          >
            <Icon aria-hidden="true" />
            <span>{t(label)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
