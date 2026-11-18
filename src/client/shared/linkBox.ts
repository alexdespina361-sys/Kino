import { useSyncExternalStore } from "react";
import { readStorage, writeStorage } from "./format";

const KEY = "kino.linkbox";

let on = readStorage(KEY) === "1";
const listeners = new Set<() => void>();

const tell = () => listeners.forEach((listener) => listener());

export function setLinkBox(value: boolean): void {
  on = value;
  writeStorage(KEY, value ? "1" : null);
  tell();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== null) return;
    on = readStorage(KEY) === "1";
    listener();
  };
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    removeEventListener("storage", onStorage);
  };
}

export function useLinkBox(): [boolean, (value: boolean) => void] {
  return [useSyncExternalStore(subscribe, () => on, () => false), setLinkBox];
}
