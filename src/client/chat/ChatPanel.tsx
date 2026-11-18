import { useEffect, useId, useRef, useState } from "react";
import { useT, type Key } from "../i18n";
import { FilmIcon, GifIcon, StickerIcon } from "../shared/icons";
import { useBackFirst } from "../tv/dpad";
import { GifPane } from "./GifPick";
import { StickerPane } from "./StickerPick";
import { TitleList } from "./TitlePick";
import type { ChatSession } from "./useChat";

export type PanelTab = "titles" | "gifs" | "stickers";

const TABS: Array<{ tab: PanelTab; label: Key; Icon: typeof FilmIcon }> = [
  { tab: "titles", label: "chat.tabTitles", Icon: FilmIcon },
  { tab: "gifs", label: "chat.tabGifs", Icon: GifIcon },
  { tab: "stickers", label: "chat.tabStickers", Icon: StickerIcon },
];

export const PANEL_TAB_KEY = "kino.chatPanelTab";

export function savedTab(): PanelTab {
  try {
    const saved = window.localStorage.getItem(PANEL_TAB_KEY);
    if (saved === "titles" || saved === "gifs" || saved === "stickers") return saved;
  } catch {
  }
  return "stickers";
}

function saveTab(tab: PanelTab) {
  try {
    window.localStorage.setItem(PANEL_TAB_KEY, tab);
  } catch {
  }
}

export interface ChatPanelProps {
  id?: string | undefined;
  session: ChatSession;
  tv: boolean;
  nav: boolean;
  land: boolean;
  pointer: boolean;
  gifKey: string | null;
  onClose: () => void;
  onSent: () => void;
}

export function ChatPanel({ id: panelId, session, tv, nav, land, pointer, gifKey, onClose, onSent }: ChatPanelProps) {
  const t = useT();
  const [chosen, setChosen] = useState<PanelTab>(() => {
    const saved = savedTab();
    return saved === "gifs" && !gifKey ? "stickers" : saved;
  });
  const tab: PanelTab = chosen === "gifs" && !gifKey ? "stickers" : chosen;
  const tabs = TABS.filter((one) => one.tab !== "gifs" || gifKey);
  const prefix = tv ? "tv-chat" : "chat";
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useBackFirst(onClose);

  useEffect(() => {
    if (!land) return;
    const pane = root.current?.querySelector<HTMLElement>("[role='tabpanel']");
    const first =
      pane?.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)") ??
      pane?.querySelector<HTMLElement>("[data-nav]:not(:disabled), button:not(:disabled), input") ??
      root.current?.querySelector<HTMLElement>("[role='tab'][aria-selected='true']");
    first?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (next: PanelTab) => {
    setChosen(next);
    saveTab(next);
  };

  return (
    <div className={`${prefix}-panel`} ref={root} id={panelId} role="group" aria-label={t("chat.panel")} data-tab={tab} data-testid={`${prefix}-panel`}>
      <div className={`${prefix}-panel-pane`} role="tabpanel" id={`${id}-pane`} aria-labelledby={`${id}-${tab}`} data-testid={`${prefix}-panel-pane`}>
        {tab === "titles" ? (
          <TitleList key="titles" session={session} tv={tv} nav={nav} pointer={pointer} onSent={onSent} />
        ) : tab === "gifs" && gifKey ? (
          <GifPane key="gifs" gifKey={gifKey} session={session} tv={tv} nav={nav} onSent={onSent} />
        ) : (
          <StickerPane key="stickers" session={session} tv={tv} nav={nav} pointer={pointer} onSent={onSent} />
        )}
      </div>
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
