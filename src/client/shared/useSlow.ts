import { useEffect, useState } from "react";

/** Something that has not happened by now is worth saying: a video that has not started gets a way out, a connection that has not come back is said to be away. */
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
