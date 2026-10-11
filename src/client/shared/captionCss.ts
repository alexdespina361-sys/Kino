import type { CSSProperties } from "react";
import type { CaptionStyle } from "../../shared";

/**
 * Sizes and heights are shares of the picture's height, so a caption looks the same on every TV. The TV measures them against
 * the picture as the screen fits it: as high as the screen is, or less on a screen narrower than a 16:9 picture is tall (a phone
 * held upright, where the picture is a strip across the middle and captions as big as the screen is high would fill it).
 * The phone's preview frame measures them against itself (cqh), so it matches.
 */
export type CaptionUnit = "picture" | "cqh";

/** The height of the largest 16:9 picture the screen has room for. */
const PICTURE = "min(100vh, 56.25vw)";
/** Whatever the picture, a caption is never smaller than this: below it text cannot be read. */
const LEAST_PX = 14;

/** A share (in percent) of the picture's height. */
const share = (percent: number, unit: CaptionUnit) => (unit === "cqh" ? `${percent}cqh` : `calc(${PICTURE} * ${percent} / 100)`);

const SIZE: Record<CaptionStyle["size"], number> = { small: 3.6, medium: 4.6, large: 6, xlarge: 7.6 };
const POSITION: Record<CaptionStyle["position"], number> = { low: 5, normal: 10, high: 18, higher: 28 };
const SPACING: Record<CaptionStyle["spacing"], string> = { tight: "-0.08em", normal: "0", wide: "0.25em", wider: "0.5em" };

const FONT: Record<CaptionStyle["font"], Pick<CSSProperties, "fontFamily" | "fontVariant">> = {
  sans: { fontFamily: 'system-ui, "Segoe UI", Roboto, Arial, sans-serif' },
  serif: { fontFamily: 'Georgia, "Times New Roman", serif' },
  mono: { fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace' },
  casual: { fontFamily: '"Comic Sans MS", "Chalkboard SE", "Marker Felt", cursive' },
  smallcaps: { fontFamily: 'system-ui, "Segoe UI", Roboto, Arial, sans-serif', fontVariant: "small-caps" },
};

const COLOR: Record<CaptionStyle["color"], string> = {
  white: "255, 255, 255",
  yellow: "255, 235, 59",
  cyan: "0, 229, 255",
  green: "105, 240, 174",
  pink: "255, 128, 171",
};

const EDGE: Record<CaptionStyle["edge"], string> = {
  none: "none",
  shadow: "0 0.06em 0.12em rgba(0, 0, 0, 0.9)",
  outline:
    "-0.05em -0.05em 0 #000, 0.05em -0.05em 0 #000, -0.05em 0.05em 0 #000, 0.05em 0.05em 0 #000, 0 0.05em 0.1em #000",
};

/** Everything about the text itself: font, size, colors, edge, spacing. */
export function captionTextStyle(style: CaptionStyle, unit: CaptionUnit = "picture"): CSSProperties {
  const size = share(SIZE[style.size], unit);
  return {
    ...FONT[style.font],
    fontSize: unit === "cqh" ? size : `max(${LEAST_PX}px, ${size})`,
    color: `rgba(${COLOR[style.color]}, ${Number(style.textOpacity) / 100})`,
    backgroundColor: `rgba(0, 0, 0, ${Number(style.background) / 100})`,
    textShadow: EDGE[style.edge],
    wordSpacing: SPACING[style.spacing],
  };
}

/** How far the captions sit above the bottom edge of the picture (which, on a screen taller than it, is not the bottom edge of the screen). */
export const captionBottom = (style: CaptionStyle, unit: CaptionUnit = "picture") => {
  const height = share(POSITION[style.position], unit);
  return unit === "cqh" ? height : `calc((100vh - ${PICTURE}) / 2 + ${height})`;
};
