import { useCatWanted } from "../cat/settings";

/** The app's name. Also in index.html (title and favicon): change all three together. */
export const APP_NAME = "Kino";

/**
 * The name as its wordmark, "kino", whose "o" is a ring with a red play button (public/branding). On a screen that has the cat companion the ring has
 * two small ears: a second picture, the same with the ears, sits exactly over the first and fades in, so nothing moves. Whether the cat is on is the cat's
 * own setting (`useCatWanted`); until that is known the wordmark has no ears. Each screen sets its width (styles.css) and the height follows.
 */
export function Logo({ className = "" }: { className?: string }) {
  const cat = useCatWanted();
  return (
    <span className={`logo ${className}`} role="img" aria-label={APP_NAME} data-cat={cat ? "on" : "off"}>
      <img src="/branding/kino-cat-off.svg" width="269" height="115" alt="" aria-hidden="true" />
      <img className="logo-ears" src="/branding/kino-cat-on.svg" width="269" height="115" alt="" aria-hidden="true" />
    </span>
  );
}
