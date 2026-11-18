import { useRef } from "react";
import { CopyCode } from "../shared/CopyLink";

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
