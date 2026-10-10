import { z } from "zod";

/**
 * How subtitles look. The TV draws them itself (the browser's own cue styling can't do word spacing, or even agree
 * between TV browsers), so every setting here is something this app renders. Chosen on the TV or the phone, kept on the TV.
 */
export const CAPTION_VALUES = {
  size: ["small", "medium", "large", "xlarge"],
  font: ["sans", "serif", "mono", "casual", "smallcaps"],
  color: ["white", "yellow", "cyan", "green", "pink"],
  textOpacity: ["100", "75", "50"],
  background: ["0", "25", "50", "75", "100"],
  edge: ["none", "shadow", "outline"],
  position: ["low", "normal", "high", "higher"],
  spacing: ["tight", "normal", "wide", "wider"],
} as const;

export type CaptionSetting = keyof typeof CAPTION_VALUES;

/** The settings in the order menus list them. */
export const CAPTION_SETTINGS = Object.keys(CAPTION_VALUES) as CaptionSetting[];

export const CaptionStyleSchema = z.object({
  size: z.enum(CAPTION_VALUES.size),
  font: z.enum(CAPTION_VALUES.font),
  color: z.enum(CAPTION_VALUES.color),
  textOpacity: z.enum(CAPTION_VALUES.textOpacity),
  background: z.enum(CAPTION_VALUES.background),
  edge: z.enum(CAPTION_VALUES.edge),
  position: z.enum(CAPTION_VALUES.position),
  spacing: z.enum(CAPTION_VALUES.spacing),
});
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  size: "medium",
  font: "sans",
  color: "white",
  textOpacity: "100",
  background: "50",
  edge: "shadow",
  position: "normal",
  spacing: "normal",
};

export const CAPTION_TITLES: Record<CaptionSetting, string> = {
  size: "Size",
  font: "Font",
  color: "Text color",
  textOpacity: "Text opacity",
  background: "Background",
  edge: "Edge",
  position: "Height",
  spacing: "Word spacing",
};

export const CAPTION_LABELS: { [K in CaptionSetting]: Record<CaptionStyle[K], string> } = {
  size: { small: "Small", medium: "Medium", large: "Large", xlarge: "Extra large" },
  font: { sans: "Sans-serif", serif: "Serif", mono: "Monospace", casual: "Casual", smallcaps: "Small capitals" },
  color: { white: "White", yellow: "Yellow", cyan: "Cyan", green: "Green", pink: "Pink" },
  textOpacity: { "100": "100%", "75": "75%", "50": "50%" },
  background: { "0": "None", "25": "25%", "50": "50%", "75": "75%", "100": "Solid" },
  edge: { none: "None", shadow: "Shadow", outline: "Outline" },
  position: { low: "Low", normal: "Normal", high: "High", higher: "Higher" },
  spacing: { tight: "Tight", normal: "Normal", wide: "Wide", wider: "Wider" },
};

/** The defaults, with whatever the viewer changed on top. Values that aren't a real choice are ignored. */
export function resolveCaptionStyle(changes?: Partial<CaptionStyle>): CaptionStyle {
  const style: CaptionStyle = { ...DEFAULT_CAPTION_STYLE };
  for (const setting of CAPTION_SETTINGS) {
    const value = changes?.[setting];
    if (value !== undefined && (CAPTION_VALUES[setting] as readonly string[]).includes(value)) {
      (style as Record<CaptionSetting, string>)[setting] = value;
    }
  }
  return style;
}
