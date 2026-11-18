import { useT } from "../i18n";
import { canFullscreen, toggleFullscreen, useFullscreen } from "./fullscreen";
import { ExitFullscreenIcon, FullscreenIcon } from "./icons";

interface FullscreenToggleProps {
  className: string;
  labels?: { enter: string; exit: string };
  data?: Record<string, string | number>;
}

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
