import { useEffect } from "react";

/**
 * Keeps the TV from dimming or starting its screensaver while this page is up (idle pairing screen
 * included; a movie doesn't need it but a "waiting for a video" screen does).
 * Browsers only grant this on secure pages (https or localhost) and when visible, so every failure is ignored.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const granted = await navigator.wakeLock.request("screen");
        if (cancelled) void granted.release();
        else lock = granted;
      } catch {
        /* not allowed here; the TV just follows its normal screensaver rules */
      }
    };
    // The lock is dropped whenever the page is hidden; take it again when it comes back.
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!lock || lock.released)) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
