import { useState, type ReactNode, type SyntheticEvent } from "react";

export function hueOf(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export const comesIn = {
  ref: (img: HTMLImageElement | null) => {
    if (img && !img.complete) img.setAttribute("data-late", "");
  },
  onLoad: (event: SyntheticEvent<HTMLImageElement>) => event.currentTarget.setAttribute("data-in", ""),
};

export const sharper = (picture: string | undefined) => picture?.replace(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w500\//, "$1w780/");

export function posterSizes(picture: string | undefined): { srcSet: string; sizes: string } | undefined {
  const match = picture?.match(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w500(\/[^\s,]+)$/);
  if (!match) return stillSizes(picture);
  return { srcSet: [342, 500, 780].map((width) => `${match[1]}w${width}${match[2]} ${width}w`).join(", "), sizes: "auto, 160px" };
}

function stillSizes(picture: string | undefined): { srcSet: string; sizes: string } | undefined {
  const match = picture?.match(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w1280(\/[^\s,]+)$/);
  if (!match) return undefined;
  return { srcSet: [300, 780, 1280].map((width) => `${match[1]}w${width}${match[2]} ${width}w`).join(", "), sizes: "auto, 400px" };
}

export function Poster({ title, image, seed, className, children }: { title: string; image?: string | undefined; seed?: string; className?: string; children?: ReactNode }) {
  const [broken, setBroken] = useState(false);
  const hue = hueOf(seed ?? title);
  return (
    <span className={className} style={{ background: `linear-gradient(135deg, hsl(${hue} 40% 26%), hsl(${(hue + 40) % 360} 45% 12%))` }}>
      {image && !broken ? (
        <img loading="lazy" {...posterSizes(image)} src={image} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} {...comesIn} />
      ) : (
        <span className="poster-initial" aria-hidden="true">
          {title.trim().charAt(0).toUpperCase()}
        </span>
      )}
      {children}
    </span>
  );
}
