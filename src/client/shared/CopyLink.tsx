import { useEffect, useRef, useState, type RefObject } from "react";
import { useT } from "../i18n";
import { copyText } from "./clipboard";
import { CheckIcon, CopyIcon } from "./icons";

/** How a screen's buttons join its remote or its arrow keys (spread onto the button). */
type Nav = Record<string, string | number | boolean>;

type Copying = "idle" | "copied" | "failed";

/**
 * Copying `text`, for the button that does it: what it says afterwards (copied, or that the browser would not) goes by itself, and a
 * text that was renewed starts over, since what was said was about the one before. Where the browser would not copy, `where` is the
 * text as the page shows it: it is selected instead, ready for the keys or the long press of the device.
 */
function useCopy(text: string, where: RefObject<HTMLElement | null>): [Copying, () => Promise<void>] {
  const [state, setState] = useState<Copying>("idle");
  useEffect(() => setState("idle"), [text]);
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), state === "copied" ? 2000 : 6000);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    const copied = await copyText(text);
    if (!copied && where.current) window.getSelection()?.selectAllChildren(where.current);
    setState(copied ? "copied" : "failed");
  };
  return [state, copy];
}

/**
 * A link to paste into somebody's chat: the whole link, and a button beside it that copies it and says so. Where the browser would not
 * copy, the link is selected instead (a click on it selects it whole too), ready for the keys or the long press of the device.
 * The screen it is on says how its buttons look (`buttonClass`) and how its remote reaches them (`nav`).
 */
export function CopyLink({ link, testId, buttonClass, nav }: { link: string; testId: string; buttonClass: string; nav?: Nav }) {
  const t = useT();
  const url = useRef<HTMLSpanElement>(null);
  const [state, copy] = useCopy(link, url);

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

/**
 * The same for a code a person gives to somebody: the code itself is on the page already, big, wherever the screen shows it (`shown`
 * is that element, which is selected when the browser would not copy), and this is the small button beside it that copies it and says so.
 * `testId` is the button's.
 */
export function CopyCode({ code, shown, testId, buttonClass, nav }: { code: string; shown: RefObject<HTMLElement | null>; testId: string; buttonClass: string; nav?: Nav }) {
  const t = useT();
  const [state, copy] = useCopy(code, shown);

  return (
    <div className="copy-link copy-code">
      <button className={`${buttonClass} copy-link-button`} data-testid={testId} data-state={state} onClick={copy} {...nav}>
        {state === "copied" ? (
          <>
            <CheckIcon /> {t("friends.codeCopied")}
          </>
        ) : (
          <>
            <CopyIcon /> {t("friends.copyCode")}
          </>
        )}
      </button>
      {state === "failed" && (
        <p className="copy-link-note" role="status">
          {t("friends.codeCopyFailed")}
        </p>
      )}
    </div>
  );
}
