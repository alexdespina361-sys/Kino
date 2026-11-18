import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { isCompact } from "./compact";

export const FIT_STEPS = ["tight", "party", "tracks", "names", "skips", "episodes", "small", "wrap"] as const;

interface Fitted {
  key: string;
  count: number;
}

function fits(row: HTMLElement): boolean {
  const groups = Array.from(row.children) as HTMLElement[];
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  const used = groups.reduce((sum, group) => sum + group.offsetWidth, 0) + gap * Math.max(0, groups.length - 1);
  return used <= row.clientWidth + 1;
}

function giveUp(row: HTMLElement, count: number): void {
  const steps: readonly string[] = FIT_STEPS.slice(0, count);
  const fit = steps.join(" ");
  if (row.dataset.fit !== fit) row.dataset.fit = fit;
  for (const button of row.querySelectorAll<HTMLElement>("[data-fold]")) button.toggleAttribute("data-folded", steps.includes(button.dataset.fold!));
}

function fit(row: HTMLElement, last: Fitted): void {
  if (isCompact()) {
    last.key = "";
    return giveUp(row, 0);
  }
  const key = `${row.clientWidth}|${row.childElementCount}|${row.textContent}`;
  if (key === last.key) return giveUp(row, last.count);
  let count = 0;
  giveUp(row, count);
  while (count < FIT_STEPS.length && !fits(row)) giveUp(row, ++count);
  last.key = key;
  last.count = count;
}

export function useOneLine(row: RefObject<HTMLElement | null>): void {
  const last = useRef<Fitted>({ key: "", count: 0 });
  useLayoutEffect(() => {
    if (row.current) fit(row.current, last.current);
  });
  useEffect(() => {
    const onResize = () => row.current && fit(row.current, last.current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [row]);
}
