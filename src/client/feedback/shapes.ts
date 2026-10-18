/**
 * The marks a person draws on a picture to show what they mean: a circle round it, an arrow to it, a box, a line by hand, a word, or a block that
 * covers what is private. A mark is kept as numbers between 0 and 1 across the picture (so it is the same on a small screen and on the picture at
 * its full size), and drawn by one function for both the screen and the picture that is sent.
 */

export const TOOLS = ["circle", "arrow", "box", "draw", "text", "hide"] as const;
export type Tool = (typeof TOOLS)[number];

export const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff"] as const;
export type Color = (typeof COLORS)[number];
/** The names a screen reader says for the colours, as the dictionary has them (`feedback.mark.color.<name>`). */
export const COLOR_NAMES: Record<Color, string> = { "#ff3b30": "red", "#ffcc00": "yellow", "#34c759": "green", "#0a84ff": "blue", "#ffffff": "white" };

/** How thick a line is, as a share of the picture's shorter side, for the three sizes. */
export const WIDTHS = [0.004, 0.008, 0.014] as const;
/** How big the letters are, the same way. */
export const LETTERS = [0.03, 0.05, 0.08] as const;

export type Point = [number, number];

export type Shape =
  | { kind: "circle" | "box" | "hide"; from: Point; to: Point; color: Color; size: number }
  | { kind: "arrow"; from: Point; to: Point; color: Color; size: number }
  | { kind: "draw"; points: Point[]; color: Color; size: number }
  | { kind: "text"; at: Point; text: string; color: Color; size: number };

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** A place on a picture (a point of the screen over it, and the box it is shown in) as numbers between 0 and 1. */
export function toUnit(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }): Point {
  return [clamp((clientX - box.left) / (box.width || 1)), clamp((clientY - box.top) / (box.height || 1))];
}

/** Whether a mark is more than a touch (a tap that moved nowhere makes no circle). */
export function isMark(shape: Shape, width: number, height: number): boolean {
  const small = 0.012 * Math.min(width, height);
  switch (shape.kind) {
    case "text":
      return shape.text.trim() !== "";
    case "draw":
      return shape.points.length > 1 && shape.points.some(([x, y]) => Math.hypot((x - shape.points[0]![0]) * width, (y - shape.points[0]![1]) * height) > small);
    default:
      return Math.hypot((shape.to[0] - shape.from[0]) * width, (shape.to[1] - shape.from[1]) * height) > small;
  }
}

/** The head of an arrow: the two points behind its tip, at a slant to the line. */
export function arrowHead(from: Point, to: Point, length: number): [Point, Point] {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const spread = Math.PI / 7;
  const back = (turn: number): Point => [to[0] - length * Math.cos(angle + turn), to[1] - length * Math.sin(angle + turn)];
  return [back(spread), back(-spread)];
}

/** The box that two corners make, whichever way they were dragged. */
export function boxOf(from: Point, to: Point): { x: number; y: number; width: number; height: number } {
  return { x: Math.min(from[0], to[0]), y: Math.min(from[1], to[1]), width: Math.abs(to[0] - from[0]), height: Math.abs(to[1] - from[1]) };
}

/** The part of a canvas context that the marks use (so that they can be drawn on a stand-in in a test). */
export interface Surface {
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  stroke(): void;
  fill(): void;
  strokeText(text: string, x: number, y: number): void;
  fillText(text: string, x: number, y: number): void;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
}

/** The ink of the letters' outline, so that a word can be read on any picture. */
const outlineOf = (color: string) => (color === "#ffffff" || color === "#ffcc00" || color === "#34c759" ? "rgba(0, 0, 0, 0.85)" : "rgba(255, 255, 255, 0.9)");

/** Draws the marks over a picture of this size (the picture itself is drawn by the caller). */
export function paintShapes(surface: Surface, shapes: Shape[], width: number, height: number): void {
  const unit = Math.min(width, height);
  surface.save();
  surface.lineCap = "round";
  surface.lineJoin = "round";
  for (const shape of shapes) {
    surface.beginPath();
    if (shape.kind === "hide") {
      const box = boxOf(shape.from, shape.to);
      surface.fillStyle = "#101012";
      surface.fillRect(box.x * width, box.y * height, box.width * width, box.height * height);
      continue;
    }
    if (shape.kind === "text") {
      const px = (LETTERS[shape.size] ?? LETTERS[1]) * unit;
      surface.font = `700 ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      surface.textBaseline = "top";
      surface.lineWidth = Math.max(2, px / 6);
      surface.strokeStyle = outlineOf(shape.color);
      surface.fillStyle = shape.color;
      shape.text.split("\n").forEach((line, index) => {
        surface.strokeText(line, shape.at[0] * width, shape.at[1] * height + index * px * 1.15);
        surface.fillText(line, shape.at[0] * width, shape.at[1] * height + index * px * 1.15);
      });
      continue;
    }
    surface.lineWidth = Math.max(2, WIDTHS[shape.size]! * unit);
    surface.strokeStyle = shape.color;
    if (shape.kind === "circle") {
      const box = boxOf(shape.from, shape.to);
      surface.ellipse((box.x + box.width / 2) * width, (box.y + box.height / 2) * height, Math.max(1, (box.width * width) / 2), Math.max(1, (box.height * height) / 2), 0, 0, Math.PI * 2);
    } else if (shape.kind === "box") {
      const box = boxOf(shape.from, shape.to);
      surface.rect(box.x * width, box.y * height, box.width * width, box.height * height);
    } else if (shape.kind === "arrow") {
      surface.moveTo(shape.from[0] * width, shape.from[1] * height);
      surface.lineTo(shape.to[0] * width, shape.to[1] * height);
      const head = arrowHead([shape.from[0] * width, shape.from[1] * height], [shape.to[0] * width, shape.to[1] * height], Math.max(10, surface.lineWidth * 4.5));
      surface.moveTo(head[0][0], head[0][1]);
      surface.lineTo(shape.to[0] * width, shape.to[1] * height);
      surface.lineTo(head[1][0], head[1][1]);
    } else if (shape.kind === "draw") {
      const [first, ...rest] = shape.points;
      if (!first) continue;
      surface.moveTo(first[0] * width, first[1] * height);
      for (const point of rest) surface.lineTo(point[0] * width, point[1] * height);
      // (A dot: a point and nothing else is drawn as a short line, so that it shows.)
      if (rest.length === 0) surface.lineTo(first[0] * width + 0.1, first[1] * height);
    }
    surface.stroke();
  }
  surface.restore();
}
