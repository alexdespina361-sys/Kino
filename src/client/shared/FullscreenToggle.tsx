import { useT } from "../i18n";
import { canFullscreen, toggleFullscreen, useFullscreen } from "./fullscreen";
import { ExitFullscreenIcon, FullscreenIcon } from "./icons";

interface FullscreenToggleProps {
  className: string;
  /** Says what it does in words beside the icon (a row of a menu), instead of in a tooltip. */
  labels?: { enter: string; exit: string };
  /** Where a screen's arrow keys find it. */
  data?: Record<string, string | number>;
}

/**
 * A button for the page itself to go full screen, or come back from it: small, for the corner next to the account's, or a row of a menu.
 * It isn't there where the browser has no full screen to give (an iPhone's).
 */
export function FullscreenToggle({ className, labels, data }: FullscreenToggleProps) {
  const t = useT();
  const on = useFullscreen();
  if (!canFullscreen()) return null;
  const label = labels ? labels[on ? "exit" : "enter"] : t(on ? "remote.exitFullscreen" : "remote.fullscreen");
  const icon = on ? <ExitFullscreenIcon /> : <FullscreenIcon />;
  return (
    <button type="button" className={className} onClick={toggleFullscreen} data-testid="fullscreen-toggle" {...(labels ? {} : { "aria-label": label, title: label })} {...data}>
      {labels ? (
        <>
          <span className="menu-icon">{icon}</span>
          <span className="menu-label">{label}</span>
        </>
      ) : (
        icon
      )}
    </button>
  );
}
