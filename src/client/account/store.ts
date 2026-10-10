import { useSyncExternalStore } from "react";
import { ProfileStore, type Snapshot, type StorageLike } from "./profileStore";

/** localStorage, or nothing: some browsers (private windows, locked-down TVs) throw on touching it. */
function browserStorage(): StorageLike | undefined {
  try {
    const storage = window.localStorage;
    storage.getItem("kino.probe");
    return storage;
  } catch {
    return undefined;
  }
}

/** The one place this page keeps what was watched, saved for later and chosen in settings (see profileStore.ts). */
export const profileStore = new ProfileStore(typeof window === "undefined" ? undefined : browserStorage());

// A page that is closing, or going to the background, writes what it holds now rather than after the usual short wait.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => profileStore.flush());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && profileStore.flush());
}

/** What the profile in use has watched, saved and chosen; the component shows again when it changes. */
export const useProfileData = (): Snapshot => useSyncExternalStore(profileStore.subscribe, profileStore.getSnapshot, profileStore.getSnapshot);
