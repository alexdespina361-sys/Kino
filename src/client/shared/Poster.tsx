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

/** The movie database keeps a poster in several sizes, and the rows' 500 px is soft over the width of a phone's screen: this one asks for its 780 px. */
export const sharper = (picture: string | undefined) => picture?.replace(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w500\//, "$1w780/");

/**
 * The sizes the movie database keeps a poster in (the library's are its 500 px), for the browser to take the smallest that is sharp where it is drawn:
 * `sizes="auto"` is the picture's width on the page (a lazy picture's, Chrome 126 and later), times the screen's density. A phone's tile of ~112 px takes the
 * 342 px one, a third of the bytes (the judge, 16 Nov: a phone's first open fetched 7.6 MB of posters); a banner as wide as a phone takes the 780 px one. A
 * browser that has no `auto` reads the next size, 160 px: a TV's 1x takes the 342, a phone's 2.75x the 500. Anything else (another site's picture, or a
 * size already chosen, as `sharper`'s) is left as it is.
 */
export function posterSizes(picture: string | undefined): { srcSet: string; sizes: string } | undefined {
  const match = picture?.match(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w500(\/[^\s,]+)$/);
  if (!match) return stillSizes(picture);
  return { srcSet: [342, 500, 780].map((width) => `${match[1]}w${width}${match[2]} ${width}w`).join(", "), sizes: "auto, 160px" };
}

/**
 * The same for a still (the library's wide pictures are the database's 1280 px ones): a card of a row (a phone's ~250 px, a TV's ~400 px) takes the 780 px
 * one, a fifth of the bytes, and a 300 px one where it is small. A browser that has no `auto` reads 400 px.
 */
function stillSizes(picture: string | undefined): { srcSet: string; sizes: string } | undefined {
  const match = picture?.match(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w1280(\/[^\s,]+)$/);
  if (!match) return undefined;
  return { srcSet: [300, 780, 1280].map((width) => `${match[1]}w${width}${match[2]} ${width}w`).join(", "), sizes: "auto, 400px" };
}

/** A title's picture, or (when there is none, or it does not load) its first letter on a colour made from its name. `children` sit on top of it. */
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
