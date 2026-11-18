import { useEffect, useRef, useState, type RefObject } from "react";
import { useT } from "../i18n";
import { copyText } from "./clipboard";
import { CheckIcon, CopyIcon } from "./icons";

type Nav = Record<string, string | number | boolean>;

type Copying = "idle" | "copied" | "failed";

export function useCopy(text: string, where: RefObject<HTMLElement | null>): [Copying, () => Promise<void>] {
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

export function CopyCode({ code, shown, testId, buttonClass, nav, words = "code" }: { code: string; shown: RefObject<HTMLElement | null>; testId: string; buttonClass: string; nav?: Nav; words?: "code" | "tag" }) {
  const t = useT();
  const [state, copy] = useCopy(code, shown);

  return (
    <div className="copy-link copy-code">
      <button className={`${buttonClass} copy-link-button`} data-testid={testId} data-state={state} onClick={copy} {...nav}>
        {state === "copied" ? (
          <>
            <CheckIcon /> {t(words === "tag" ? "friends.tagCopied" : "friends.codeCopied")}
          </>
        ) : (
          <>
            <CopyIcon /> {t(words === "tag" ? "friends.copyTag" : "friends.copyCode")}
          </>
        )}
      </button>
      {state === "failed" && (
        <p className="copy-link-note" role="status">
          {t(words === "tag" ? "friends.tagCopyFailed" : "friends.codeCopyFailed")}
        </p>
      )}
    </div>
  );
}
