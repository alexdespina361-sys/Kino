import { useEffect } from "react";

export function useVisibleArea(active: boolean): void {
  useEffect(() => {
    const view = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!active || !view) return;
    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty("--chat-vh", `${Math.round(view.height)}px`);
      root.style.setProperty("--chat-top", `${Math.max(0, Math.round(view.offsetTop))}px`);
    };
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
