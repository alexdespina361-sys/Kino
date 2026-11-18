import { useEffect, useRef, type RefObject } from "react";
import { useHandHeldBack } from "../shared/backButton";
import { actionForKey } from "./keys";

export type Direction = "up" | "down" | "left" | "right";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const centre = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });

export function pickNeighbour(boxes: Box[], from: number, direction: Direction): number {
  const origin = boxes[from];
  if (!origin) return -1;
  const start = centre(origin);
  const sideways = direction === "left" || direction === "right";
  const extent = sideways ? origin.right - origin.left : origin.bottom - origin.top;
  const candidates = boxes
    .map((box, index) => {
      const at = centre(box);
      const along = direction === "left" ? start.x - at.x : direction === "right" ? at.x - start.x : direction === "up" ? start.y - at.y : at.y - start.y;
      const gap = direction === "left" ? origin.left - box.right : direction === "right" ? box.left - origin.right : direction === "up" ? origin.top - box.bottom : box.top - origin.bottom;
      const across = sideways ? Math.abs(at.y - start.y) : Math.abs(at.x - start.x);
      const ahead = sideways ? box.top < origin.bottom && box.bottom > origin.top : box.left < origin.right && box.right > origin.left;
      return { index, along, gap, across, ahead };
    })
    .filter(({ index, along, gap }) => index !== from && along >= 1 && gap >= -extent / 10);
  if (candidates.length === 0) return -1;
  const ahead = candidates.filter((candidate) => candidate.ahead);
  if (ahead.length > 0) {
    const nearest = Math.min(...ahead.map(({ gap }) => gap));
    const better = (a: (typeof ahead)[number], b: (typeof ahead)[number]) => b.across < a.across - 0.5 || (Math.abs(b.across - a.across) <= 0.5 && b.gap < a.gap);
    return ahead.filter(({ gap }) => gap < nearest + extent / 2).reduce((a, b) => (better(a, b) ? b : a)).index;
  }
  return candidates.reduce((a, b) => (b.along + b.across * 3 < a.along + a.across * 3 ? b : a)).index;
}

export function pickInRows(boxes: Box[], from: number, direction: Direction): number {
  const origin = boxes[from];
  if (!origin) return -1;
  const start = centre(origin);
  const slack = (origin.bottom - origin.top) / 2;
  const inRow = (box: Box) => Math.abs(centre(box).y - start.y) < slack;
  const sideways = direction === "left" || direction === "right";
  const candidates = boxes
    .map((box, index) => ({ index, at: centre(box), row: inRow(box) }))
    .filter(({ index, at, row }) => {
      if (index === from) return false;
      if (sideways) return row && (direction === "right" ? at.x - start.x : start.x - at.x) >= 1;
      return !row && (direction === "down" ? at.y - start.y : start.y - at.y) > 0;
    });
  if (candidates.length === 0) return -1;
  if (sideways) return candidates.reduce((a, b) => (Math.abs(b.at.x - start.x) < Math.abs(a.at.x - start.x) ? b : a)).index;
  const away = (at: { y: number }) => Math.abs(at.y - start.y);
  const nearest = Math.min(...candidates.map(({ at }) => away(at)));
  const row = candidates.filter(({ at }) => away(at) < nearest + slack);
  return row.reduce((a, b) => (Math.abs(b.at.x - start.x) < Math.abs(a.at.x - start.x) ? b : a)).index;
}

const NAV = "[data-nav]:not(:disabled)";

export function navItems(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(NAV)].filter((item) => item.getClientRects().length > 0);
}

export function moveFocus(root: ParentNode, direction: Direction): boolean {
  const items = navItems(root);
  if (items.length === 0) return false;
  const current = document.activeElement as HTMLElement;
  if (!items.includes(current)) {
    items[0]!.focus();
    return true;
  }
  const column = current.closest("[data-nav-column]");
  const here = column?.getBoundingClientRect();
  const inReach = (item: HTMLElement) => {
    const other = item.closest("[data-nav-column]");
    if (other === column) return true;
    const box = other?.getBoundingClientRect();
    return !!box && !!here && box.left < here.right && here.left < box.right;
  };
  const pool = column && (direction === "up" || direction === "down") ? items.filter(inReach) : items;
  const next = pickNeighbour(pool.map((item) => item.getBoundingClientRect()), pool.indexOf(current), direction);
  if (next === -1) return false;
  pool[next]!.focus();
  return true;
}

export function useBack(onBack: (() => void) | undefined, leaving: (() => void) | undefined = onBack): void {
  const latest = useRef(onBack);
  latest.current = onBack;
  const active = onBack !== undefined;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || actionForKey(event) !== "back") return;
      event.preventDefault();
      latest.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
  useHandHeldBack(active ? leaving : undefined);
}

const openFirst: Array<{ current: (() => void) | undefined }> = [];

export function useBackFirst(onBack: (() => void) | undefined): void {
  const latest = useRef(onBack);
  latest.current = onBack;
  const active = onBack !== undefined;
  useEffect(() => {
    if (!active) return;
    openFirst.push(latest);
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || actionForKey(event) !== "back") return;
      event.preventDefault();
      event.stopPropagation();
      if (openFirst[openFirst.length - 1] === latest) latest.current?.();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      const at = openFirst.lastIndexOf(latest);
      if (at >= 0) openFirst.splice(at, 1);
    };
  }, [active]);
  useHandHeldBack(onBack);
}

export function useDpad(root: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !root.current) return;
      const action = actionForKey(event);
      if (action === "up" || action === "down" || action === "left" || action === "right") {
        if (moveFocus(root.current, action)) event.preventDefault();
      } else if (action === "select") {
        const items = navItems(root.current);
        if (items.length > 0 && !items.includes(document.activeElement as HTMLElement)) {
          items[0]!.focus();
          event.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [root, enabled]);
}
