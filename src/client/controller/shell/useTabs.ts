import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBackWhile } from "../../shared/backButton";
import { backTo, type Left } from "./placeScroll";

export type Tab = "home" | "search" | "list" | "you";
export const TABS: readonly Tab[] = ["home", "search", "list", "you"];

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useTabs(hidden: boolean, paired: boolean) {
  const [tab, setTab] = useState<Tab>("home");
  const scrolls = useRef<Record<Tab, Left>>({ home: { y: 0, top: 0 }, search: { y: 0, top: 0 }, list: { y: 0, top: 0 }, you: { y: 0, top: 0 } });
  const now = useRef({ tab, hidden });
  now.current = { tab, hidden };
  const place = useRef<HTMLDivElement | null>(null);
  const topOfPlace = () => (place.current ? place.current.getBoundingClientRect().top + window.scrollY : 0);

  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return;
    const was = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = was;
    };
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (!now.current.hidden) scrolls.current[now.current.tab] = { y: window.scrollY, top: topOfPlace() };
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    if (!hidden) window.scrollTo(0, backTo(scrolls.current[tab], topOfPlace()));
  }, [tab, hidden]);

  useEffect(() => {
    if (!paired) setTab("home");
  }, [paired]);

  useBackWhile(paired && tab !== "home", () => setTab("home"));

  const select = (next: Tab) => {
    if (next !== tab) return setTab(next);
    scrolls.current[tab] = { y: 0, top: topOfPlace() };
    window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  return { tab, select, setTab, place };
}
