import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { copyText } from "./clipboard";
import { CheckIcon, CopyIcon } from "./icons";

/** How a screen's buttons join its remote or its arrow keys (spread onto the button). */
type Nav = Record<string, string | number | boolean>;

/**
 * A link to paste into somebody's chat: the whole link, and a button beside it that copies it and says so. Where the browser would not
 * copy, the link is selected instead (a click on it selects it whole too), ready for the keys or the long press of the device.
 * The screen it is on says how its buttons look (`buttonClass`) and how its remote reaches them (`nav`).
 */
export function CopyLink({ link, testId, buttonClass, nav }: { link: string; testId: string; buttonClass: string; nav?: Nav }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const url = useRef<HTMLSpanElement>(null);
  // What was said is about the link that was copied: a renewed one starts over. And what is said goes by itself.
  useEffect(() => setState("idle"), [link]);
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), state === "copied" ? 2000 : 6000);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    const copied = await copyText(link);
    if (!copied && url.current) window.getSelection()?.selectAllChildren(url.current);
    setState(copied ? "copied" : "failed");
  };

  return (
    <div className="copy-link" data-testid={testId}>
      <div className="copy-link-row">
        <span className="copy-link-url" ref={url} data-testid={`${testId}-url`}>
          {link}
        </span>
        <button className={`${buttonClass} copy-link-button`} data-testid={`${testId}-copy`} data-state={state} onClick={copy} {...nav}>
          {state === "copied" ? (
            <>
              <CheckIcon /> {t("party.copied")}
            </>
          ) : (
            <>
              <CopyIcon /> {t("party.copyLink")}
            </>
          )}
        </button>
      </div>
      {state === "failed" && (
        <p className="copy-link-note" role="status">
          {t("party.copyFailed")}
        </p>
      )}
    </div>
  );
}
