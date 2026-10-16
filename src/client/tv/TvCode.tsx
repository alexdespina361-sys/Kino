import { useRef } from "react";
import { CopyCode } from "../shared/CopyLink";

/**
 * A code that is read off the screen and typed on another device: big, selected whole by one click (a right click then copies it), and
 * with a small button under it that copies it and says so, for a screen that has a mouse and no phone at hand (the other device is
 * another tab, or a computer). `shown` is the code as the page writes it, `copy` what the other device's field takes; while the code is
 * not there yet (`copy` is undefined) the page shows `shown` (dots) and no button.
 */
export function TvCode({ shown, copy, testId, copyTestId, className = "", live = false }: { shown: string; copy: string | undefined; testId: string; copyTestId: string; className?: string; live?: boolean }) {
  const text = useRef<HTMLParagraphElement>(null);
  return (
    <div className="tv-code-box">
      <p className={`tv-code copy-code-text${className ? ` ${className}` : ""}`} ref={text} data-testid={testId} {...(live ? { "aria-live": "polite" as const } : {})}>
        {shown}
      </p>
      {copy !== undefined && <CopyCode code={copy} shown={text} testId={copyTestId} buttonClass="tv-action" nav={{ "data-nav": true }} />}
    </div>
  );
}
