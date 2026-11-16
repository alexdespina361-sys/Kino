import { useEffect, useState } from "react";

/** How long a screen holds what depends on the profile's settings, at most, before it shows what it has: the server may be slow, or down. */
export const HOLD_MS = 5_000;

/** `on`, for `HOLD_MS` at most from the moment it came on. */
export function useForAWhile(on: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!on) return;
    const timer = setTimeout(() => setLate(true), HOLD_MS);
    return () => clearTimeout(timer);
  }, [on]);
  return on && !late;
}
