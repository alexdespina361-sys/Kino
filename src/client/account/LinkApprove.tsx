import { useEffect, useState } from "react";
import type { LinkView } from "../../shared";
import { useT } from "../i18n";
import { formatLinkCode } from "../shared/format";
import { CheckIcon, TvIcon } from "../shared/icons";
import { useAccount } from "./AccountProvider";
import { api, ApiError } from "./api";
import { AuthForm } from "./AuthForm";
import { describeError } from "./errors";

export type LinkOutcome = "asking" | "approved" | "denied";

/**
 * A screen that is not signed in has asked for a code, and somebody signed in is looking at the request: who is asking, and the two
 * answers. Nothing is signed in until they say so. Shared by the phone's page and by the TV page of a screen that is signed in itself.
 */
export function useLinkApproval(code: string) {
  const t = useT();
  const account = useAccount();
  const signedIn = account.me !== null;
  const [view, setView] = useState<LinkView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<LinkOutcome>("asking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setProblem(null);
    api
      .linkView(code)
      .then((found) => live && setView(found))
      .catch((cause: unknown) => live && setProblem(describeError(cause)));
    return () => {
      live = false;
    };
  }, [code, signedIn]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      await (approve ? api.linkApprove(code) : api.linkDeny(code));
      setOutcome(approve ? "approved" : "denied");
    } catch (cause) {
      setProblem(cause instanceof ApiError && cause.status === 401 ? t("link.needSignIn") : describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  /** "A TV (Chrome on Windows)": who is asking, in words. */
  const who = view ? `${t(`link.device.${view.kind}`)}${view.label ? ` (${view.label})` : ""}` : "";
  return { signedIn, email: account.me?.account.email ?? "", view, who, problem, outcome, busy, decide };
}

/** "Sign in this screen?" on the phone: who is asking, and a button for each answer. */
export function LinkApprove({ code, onClose }: { code: string; onClose: () => void }) {
  const t = useT();
  const { signedIn, email, view, who, problem, outcome, busy, decide } = useLinkApproval(code);

  if (!signedIn) {
    return (
      <div className="link-approve" data-testid="link-signin">
        <span className="link-icon">
          <TvIcon />
        </span>
        <h2>{t("link.needSignIn")}</h2>
        <AuthForm />
      </div>
    );
  }

  if (outcome !== "asking") {
    return (
      <div className="link-approve" data-testid="link-done">
        <span className="link-icon done">{outcome === "approved" ? <CheckIcon /> : <TvIcon />}</span>
        <h2>{outcome === "approved" ? t("link.approved") : t("link.denied")}</h2>
        <button className="btn btn-block" onClick={onClose} data-testid="link-close">
          {t("common.done")}
        </button>
      </div>
    );
  }

  return (
    <div className="link-approve" data-testid="link-approve">
      <span className="link-icon">
        <TvIcon />
      </span>
      <h2>{t("link.approveTitle")}</h2>
      {view ? (
        <>
          <p className="link-code" aria-label={t("link.codeLabel")} data-testid="link-code">
            {formatLinkCode(view.code)}
          </p>
          <p className="muted center">{t("link.approveBody", { device: who, email })}</p>
        </>
      ) : problem ? null : (
        <p className="muted center">
          <span className="spinner" /> {t("common.loading")}
        </p>
      )}
      {problem && (
        <p className="auth-error" role="alert" data-testid="link-error">
          {problem}
        </p>
      )}
      {view && (
        <div className="link-actions">
          <button className="btn btn-red btn-block" disabled={busy} onClick={() => void decide(true)} data-testid="link-approve-button">
            {t("link.approve")}
          </button>
          <button className="btn btn-block" disabled={busy} onClick={() => void decide(false)} data-testid="link-deny-button">
            {t("link.deny")}
          </button>
        </div>
      )}
      {!view && problem && (
        <button className="btn btn-block" onClick={onClose}>
          {t("common.close")}
        </button>
      )}
    </div>
  );
}
