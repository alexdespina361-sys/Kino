import { useEffect } from "react";

/**
 * While `active`, the part of the screen a phone's keyboard leaves free, as `--chat-vh` (its height) and `--chat-top` (how far the browser has moved
 * the page up under it) on the page, which the chat on a hand-held screen is sized by (chat.css, `.tv-chat-screen`). A phone's browser does not make
 * the page shorter when its keyboard comes up (it moves what is seen over it), so without this the friend's name would go off the top while a
 * message is typed, or the box would lie under the keys. Nothing where the browser has no `visualViewport` (the chat is then the whole page, as before).
 */
export function useVisibleArea(active: boolean): void {
  useEffect(() => {
    const view = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!active || !view) return;
    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty("--chat-vh", `${Math.round(view.height)}px`);
      root.style.setProperty("--chat-top", `${Math.max(0, Math.round(view.offsetTop))}px`);
    };
    // (Measured at once, and once more a moment later: a keyboard that changes its height - letters to emoji, the GIF panel - can be told of before it
    // has settled, which left a strip of the page under the chat showing.)
    let again: ReturnType<typeof setTimeout> | undefined;
    const fit = () => {
      measure();
      clearTimeout(again);
      again = setTimeout(measure, 200);
    };
    measure();
    view.addEventListener("resize", fit);
    view.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    return () => {
      clearTimeout(again);
      view.removeEventListener("resize", fit);
      view.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
      root.style.removeProperty("--chat-vh");
      root.style.removeProperty("--chat-top");
    };
  }, [active]);
}
