import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBackWhile } from "../../shared/backButton";

/** The four places of the phone's bar. */
export type Tab = "home" | "search" | "list" | "you";
export const TABS: readonly Tab[] = ["home", "search", "list", "you"];

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Which of the four places is showing, the way a phone's bar keeps them (docs/phone-layout/RESEARCH.md R3): each place is where its reader left it
 * (how far it was scrolled), a tap on the place you are in takes it to the top, a change of place is not a step in the history, and Back from any place
 * goes to Home (and from Home it asks, as it did). `hidden`: something else has the screen (the remote), and the place is not scrolled by it.
 * `paired`: the phone has a TV; without one the phone is on its first page, where the bar is not and the places are Home again.
 */
export function useTabs(hidden: boolean, paired: boolean) {
  const [tab, setTab] = useState<Tab>("home");
  const scrolls = useRef<Record<Tab, number>>({ home: 0, search: 0, list: 0, you: 0 });
  const now = useRef({ tab, hidden });
  now.current = { tab, hidden };

  // The browser puts a page back where its history entry left it when a Back goes through the entry (the remote's: it was made with the page at the top, and
  // takes the place out of its scroll when it goes). The places are where their readers left them, and that is kept here.
  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return;
    const was = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = was;
    };
  }, []);

  // How far each place has been scrolled, as it is scrolled (a page that gets shorter under the finger is not the finger's doing: while the remote has the screen nothing is kept).
  useEffect(() => {
    const onScroll = () => {
      if (!now.current.hidden) scrolls.current[now.current.tab] = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // A place is shown where it was left: after a change of place, and when the remote that was over all of them has gone.
  useLayoutEffect(() => {
    if (!hidden) window.scrollTo(0, scrolls.current[tab]);
  }, [tab, hidden]);

  useEffect(() => {
    if (!paired) setTab("home");
  }, [paired]);

  useBackWhile(paired && tab !== "home", () => setTab("home"));

  const select = (next: Tab) => {
    if (next !== tab) return setTab(next);
    scrolls.current[tab] = 0;
    window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  return { tab, select, setTab };
}
