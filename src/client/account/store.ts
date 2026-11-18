import { useSyncExternalStore } from "react";
import { ProfileStore, type Snapshot, type StorageLike } from "./profileStore";

function browserStorage(): StorageLike | undefined {
  try {
    const storage = window.localStorage;
    storage.getItem("kino.probe");
    return storage;
  } catch {
    return undefined;
  }
}

export const profileStore = new ProfileStore(typeof window === "undefined" ? undefined : browserStorage());

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => profileStore.flush());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && profileStore.flush());
}

export const useProfileData = (): Snapshot => useSyncExternalStore(profileStore.subscribe, profileStore.getSnapshot, profileStore.getSnapshot);
