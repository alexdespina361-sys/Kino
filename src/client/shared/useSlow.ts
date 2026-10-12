import { useEffect, useState } from "react";
import type { SocketStatus } from "./socket";

/** Something that has not happened by now is worth saying more about: a video that has not started gets a way out, a connection that has not come back gets an explanation. */
export const SLOW_AFTER_MS = 10_000;

/** True once `waiting` has been true for `SLOW_AFTER_MS` without a break. */
export function useSlow(waiting: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!waiting) return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  return slow;
}

/**
 * The server has not been reached for long enough to say why: on a free host that slept, waking it takes most of a minute. Not said
 * when the browser knows there is no network at all, which is another reason, and the one that the page's own offline line is for.
 */
export function useWaking(status: SocketStatus): boolean {
  const slow = useSlow(status === "connecting" || status === "reconnecting");
  return slow && navigator.onLine !== false;
}
