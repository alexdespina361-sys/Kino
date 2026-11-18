import type { ReactNode } from "react";
import { useT } from "../../i18n";
import { HomeIcon, ListIcon, SearchIcon, UserIcon } from "../../shared/icons";
import { TABS, type Tab } from "./useTabs";

const ICONS: Record<Tab, ReactNode> = { home: <HomeIcon />, search: <SearchIcon />, list: <ListIcon />, you: <UserIcon /> };

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
