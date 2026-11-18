import { useEffect, useState } from "react";

export const HOLD_MS = 5_000;

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
