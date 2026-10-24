import type { ReactNode } from "react";
import { useT } from "../../i18n";
import { HomeIcon, ListIcon, SearchIcon, UserIcon } from "../../shared/icons";
import { TABS, type Tab } from "./useTabs";

const ICONS: Record<Tab, ReactNode> = { home: <HomeIcon />, search: <SearchIcon />, list: <ListIcon />, you: <UserIcon /> };

/**
 * The phone's bar: four places, an icon over a word each, always there (R1, R2). The one you are in has a pill behind its icon and a brighter word, and says so to a
 * screen reader as well (`aria-current`). On a screen that is wide or short (a phone on its side, a tablet) the same bar is a rail down the left edge: shell.css.
 */
export function TabBar({ tab, onSelect }: { tab: Tab; onSelect: (tab: Tab) => void }) {
  const t = useT();
  return (
    <nav className="tabbar" aria-label={t("tabs.label")} data-testid="tabbar">
      {TABS.map((each) => (
        <button key={each} type="button" className="tab" aria-current={each === tab ? "page" : undefined} data-testid={`tab-${each}`} onClick={() => onSelect(each)}>
          <span className="tab-icon">{ICONS[each]}</span>
          <span className="tab-label">{t(`tabs.${each}`)}</span>
        </button>
      ))}
    </nav>
  );
}
