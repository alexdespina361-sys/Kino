import { useState, type ReactNode, type SyntheticEvent } from "react";

/** Every title gets a colour of its own, so a missing picture still makes a tile that can be told apart. */
export function hueOf(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

/**
 * What a picture is given for the look to bring it in softly (`img[data-late][data-in]`, polish/base.css): it is marked late if it was not there as its tile
 * was drawn, and in when it has arrived. One that was there (kept from a moment ago) is never hidden for a moment to be shown again.
 */
export const comesIn = {
  ref: (img: HTMLImageElement | null) => {
    if (img && !img.complete) img.setAttribute("data-late", "");
  },
  onLoad: (event: SyntheticEvent<HTMLImageElement>) => event.currentTarget.setAttribute("data-in", ""),
};

/** A title's picture, or (when there is none, or it does not load) its first letter on a colour made from its name. `children` sit on top of it. */
export function Poster({ title, image, seed, className, children }: { title: string; image?: string | undefined; seed?: string; className?: string; children?: ReactNode }) {
  const [broken, setBroken] = useState(false);
  const hue = hueOf(seed ?? title);
  return (
    <span className={className} style={{ background: `linear-gradient(135deg, hsl(${hue} 40% 26%), hsl(${(hue + 40) % 360} 45% 12%))` }}>
      {image && !broken ? (
        <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} {...comesIn} />
      ) : (
        <span className="poster-initial" aria-hidden="true">
          {title.trim().charAt(0).toUpperCase()}
        </span>
      )}
      {children}
    </span>
  );
}
