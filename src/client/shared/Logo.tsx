/** The app's name. Also in index.html (title and favicon): change all three together. */
export const APP_NAME = "Kino";

/** The name as its wordmark, "kino", whose "o" is a ring with a red play button (public/branding). Each screen sets its width (styles.css) and the height follows. */
export const Logo = ({ className = "" }: { className?: string }) => (
  <span className={`logo ${className}`} role="img" aria-label={APP_NAME}>
    <img src="/branding/kino-cat-off.svg" width="269" height="115" alt="" aria-hidden="true" />
  </span>
);
