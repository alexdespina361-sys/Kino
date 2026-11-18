export const PRELOAD_NEXT_WITHIN_S = 120;

export function nearTheEnd(position: number, duration: number): boolean {
  return duration > 30 && position >= duration - PRELOAD_NEXT_WITHIN_S;
}
