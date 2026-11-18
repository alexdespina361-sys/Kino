export interface Left {
  y: number;
  top: number;
}

export function backTo(left: Left, top: number): number {
  if (left.y <= 0) return 0;
  return Math.max(0, left.y + top - left.top);
}
