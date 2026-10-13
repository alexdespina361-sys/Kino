// The live-DOM design scanner: for the page as it is on screen, every element that means something (text, a control, an icon, a picture, a surface)
// with its real computed style - the size and weight of its type, its colours and the contrast between them, its radius, padding, shadow, motion,
// where it sits. It is the same pass for either look, so "how far did the page drift from its own rules" is a measurement, not an impression.
//
// Used by lib.mjs: when SCAN=1 every picture the walk takes also leaves .ui-polish/scan/<look>/<device>/<name>.json. drift.mjs adds them up.
import { mkdirSync, writeFileSync } from "node:fs";

/** Runs inside the page. Everything it returns must be plain data. */
function inPage(limit) {
  const num = (value) => Math.round(parseFloat(value) * 100) / 100;
  const colour = (text) => {
    const match = /rgba?\(([^)]+)\)/.exec(text || "");
    if (!match) return null;
    const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  };
  const over = (top, under) => {
    const alpha = top[3];
    return [top[0] * alpha + under[0] * (1 - alpha), top[1] * alpha + under[1] * (1 - alpha), top[2] * alpha + under[2] * (1 - alpha), 1];
  };
  const luminance = ([r, g, b]) => {
    const lin = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const hex = (c) => (c ? "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("") + (c[3] < 1 ? Math.round(c[3] * 100) + "%" : "") : null);

  /** The colour an element sits on: its ancestors' backgrounds laid over each other. `image` when a picture or gradient is in the way (the contrast is then unknown). */
  const backdrop = (element) => {
    const layers = [];
    let image = false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== "none") image = true;
      const c = colour(style.backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    let base = [11, 11, 12, 1];
    for (const layer of layers.reverse()) base = over(layer, base);
    return { rgb: base, image };
  };

  const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role="button"], [role="radio"], [role="tab"], [role="menuitem"], [role="switch"], [role="checkbox"], [role="link"], [role="option"], [tabindex]:not([tabindex="-1"]), [data-nav]';
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "HEAD", "META", "LINK", "BR", "TITLE", "PATH", "CIRCLE", "RECT", "LINE", "POLYLINE", "POLYGON", "ELLIPSE", "G", "DEFS", "USE", "LINEARGRADIENT", "STOP", "CLIPPATH", "TEXT", "TSPAN"]);
  const W = innerWidth;
  const H = innerHeight;
  const out = [];
  for (const element of document.body.querySelectorAll("*")) {
    if (out.length >= limit) break;
    if (SKIP.has(element.tagName.toUpperCase())) continue;
    if (element.closest("svg") && element.tagName.toLowerCase() !== "svg") continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const kinds = [];
    const tag = element.tagName.toLowerCase();
    let direct = "";
    for (const node of element.childNodes) if (node.nodeType === 3) direct += node.textContent;
    direct = direct.replace(/\s+/g, " ").trim();
    if (direct) kinds.push("text");
    if (element.matches(INTERACTIVE)) kinds.push("control");
    if (tag === "svg") kinds.push("icon");
    if (tag === "img" || tag === "video" || tag === "canvas") kinds.push("picture");
    const fill = colour(style.backgroundColor);
    const radius = num(style.borderTopLeftRadius);
    const edge = style.borderTopStyle !== "none" && num(style.borderTopWidth) > 0;
    if ((fill && fill[3] > 0.02) || edge || (style.boxShadow && style.boxShadow !== "none")) kinds.push("surface");
    if (kinds.length === 0) continue;

    const inView = rect.right > 0 && rect.bottom > 0 && rect.left < W && rect.top < H;
    const record = {
      tag,
      id: element.getAttribute("data-testid") || undefined,
      cls: (typeof element.className === "string" ? element.className : element.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 3).join(" ") || undefined,
      role: element.getAttribute("role") || undefined,
      label: element.getAttribute("aria-label") || element.getAttribute("title") || undefined,
      text: direct ? direct.slice(0, 40) : undefined,
      kinds,
      inView,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };
    if (kinds.includes("text") || kinds.includes("control")) {
      record.fs = num(style.fontSize);
      record.fw = style.fontWeight;
      record.lh = style.lineHeight === "normal" ? "normal" : num(style.lineHeight);
      record.ls = style.letterSpacing === "normal" ? undefined : num(style.letterSpacing);
      record.ff = style.fontFamily.split(",")[0].replace(/["']/g, "").trim();
      const fg = colour(style.color);
      const behind = backdrop(element);
      if (fg) {
        const seen = over(fg, behind.rgb);
        record.fg = hex(fg);
        record.bg = hex(behind.rgb);
        if (kinds.includes("text")) {
          record.contrast = behind.image ? null : Math.round(ratio(seen, behind.rgb) * 100) / 100;
          record.onImage = behind.image || undefined;
        }
      }
      record.tt = style.textTransform !== "none" ? style.textTransform : undefined;
      // outlined digits (the rank numerals): the letters are the stroke, not the fill, so the fill's contrast says nothing about them
      if (num(style.webkitTextStrokeWidth) > 0) record.textStroke = `${num(style.webkitTextStrokeWidth)} ${hex(colour(style.webkitTextStrokeColor))}`;
      if (kinds.includes("text") && (style.overflow === "hidden" || style.overflowX === "hidden" || style.textOverflow === "ellipsis")) {
        record.clipped = element.scrollWidth > element.clientWidth + 1 || undefined;
        record.ellipsis = style.textOverflow === "ellipsis" || undefined;
        // letters cut off at the bottom: a box squeezed shorter than its text. A line clamp hides the rest of the text on purpose, so it only counts when the box is shorter than the lines it was meant to show.
        const clampLines = Number(style.webkitLineClamp);
        const lineHeight = style.lineHeight === "normal" ? num(style.fontSize) * 1.2 : num(style.lineHeight);
        record.clippedTall = (clampLines > 0
          ? element.scrollHeight > element.clientHeight + 2 && element.clientHeight < clampLines * lineHeight - 2
          : element.scrollHeight > element.clientHeight + Math.max(3, num(style.fontSize) * 0.25)) || undefined;
      }
    }
    if (kinds.includes("surface")) {
      record.fill = fill && fill[3] > 0 ? hex(fill) : undefined;
      record.radius = radius || undefined;
      if (edge) record.border = `${num(style.borderTopWidth)} ${style.borderTopStyle} ${hex(colour(style.borderTopColor))}`;
      if (style.boxShadow && style.boxShadow !== "none") record.shadow = style.boxShadow.slice(0, 120);
    }
    if (kinds.includes("icon")) {
      record.fs = num(style.fontSize);
      record.stroke = element.getAttribute("stroke") || style.stroke || undefined;
      record.fg = hex(colour(style.color));
    }
    const padding = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(num);
    if (padding.some((v) => v)) record.pad = padding.join(" ");
    const gap = num(style.columnGap) || num(style.rowGap);
    if (gap && (style.display.includes("flex") || style.display.includes("grid"))) record.gap = gap;
    if (style.opacity !== "1") record.opacity = num(style.opacity);
    const duration = style.transitionDuration.split(",").map(num).filter(Boolean);
    if (duration.length) record.transition = `${style.transitionProperty.slice(0, 60)} ${style.transitionDuration} ${style.transitionTimingFunction.slice(0, 40)}`;
    if (style.animationName && style.animationName !== "none") record.animation = `${style.animationName} ${style.animationDuration}`;
    if (style.outlineStyle !== "none" && num(style.outlineWidth) > 0) record.outline = `${num(style.outlineWidth)} ${style.outlineStyle} ${hex(colour(style.outlineColor))}`;
    if (style.position === "fixed" || style.position === "sticky") record.position = style.position;
    if (style.zIndex !== "auto") record.z = style.zIndex;
    if (kinds.includes("control")) {
      record.cursor = style.cursor !== "auto" ? style.cursor : undefined;
      record.named = !!(element.getAttribute("aria-label") || element.getAttribute("aria-labelledby") || (element.textContent || "").trim() || element.getAttribute("title") || element.getAttribute("alt"));
      const tabindex = element.getAttribute("tabindex");
      record.tabbable = tag === "button" || tag === "input" || tag === "select" || tag === "textarea" || (tag === "a" && element.hasAttribute("href")) || (tabindex !== null && Number(tabindex) >= 0) || undefined;
    }
    out.push(record);
  }
  const root = document.documentElement;
  const tv = document.querySelector(".tv");
  return {
    page: {
      width: W,
      height: H,
      dpr: devicePixelRatio,
      ui: root.dataset.ui || "classic",
      accent: root.dataset.accent || "red",
      url: location.pathname + location.search,
      em: tv ? num(getComputedStyle(tv).fontSize) : undefined,
      scrollWidth: root.scrollWidth,
      scrollHeight: root.scrollHeight,
      sidewaysScroll: root.scrollWidth > W + 1,
      focused: document.activeElement && document.activeElement !== document.body ? (document.activeElement.getAttribute("data-testid") || document.activeElement.tagName.toLowerCase()) : null,
    },
    elements: out,
    truncated: out.length >= limit,
  };
}

/** Reads the page and writes the scan next to where the walk's pictures go. */
export async function saveScan(page, folder, name) {
  mkdirSync(folder, { recursive: true });
  const data = await page.evaluate(inPage, 2500);
  writeFileSync(`${folder}/${name}.json`, JSON.stringify(data));
}
