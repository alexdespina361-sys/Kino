import { PlayIcon } from "./icons";

/** The app's name. Also in index.html (title and favicon): change all three together. */
export const APP_NAME = "Kino";

/**
 * The name in wide-set capitals, its last letter drawn as a red play button: "KIN" + ▶ = "KINO".
 * Everything scales with the surrounding font-size.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`logo ${className}`} role="img" aria-label={APP_NAME}>
      <span aria-hidden="true">{APP_NAME.slice(0, -1)}</span>
      <span className="logo-o" aria-hidden="true">
        <PlayIcon />
      </span>
    </span>
  );
}
