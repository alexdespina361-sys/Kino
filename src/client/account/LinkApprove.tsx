import { useEffect, useRef, useState } from "react";
import type { LinkView } from "../../shared";
import { PinAsk } from "../controller/Pin";
import { useT } from "../i18n";
import { formatLinkCode } from "../shared/format";
import { CheckIcon, TvIcon } from "../shared/icons";
import { useAccount } from "./AccountProvider";
import { api, ApiError } from "./api";
import { AuthForm } from "./AuthForm";
import { describeError } from "./errors";
import { pinAsker } from "./pinAsker";

export type LinkOutcome = "asking" | "approved" | "denied";

export function useLinkApproval(code: string, asker?: object) {
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

  const answer = async (approve: boolean) => {
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
  const decide = async (approve: boolean) => {
    if (!approve) return answer(false);
    if (asker) pinAsker.set(asker);
    account.childLock.grownUp(() => void answer(true));
  };

  const who = view ? `${t(`link.device.${view.kind}`)}${view.label ? ` (${view.label})` : ""}` : "";
  const body = account.me?.account.googleOnly ? t("link.approveBodyGoogle", { device: who }) : t("link.approveBody", { device: who, email: account.me?.account.email ?? "" });
  return { signedIn, view, body, problem, outcome, busy, decide };
}

export function LinkApprove({ code, onClose }: { code: string; onClose: () => void }) {
  const t = useT();
  const account = useAccount();
  const self = useRef({}).current;
  const { signedIn, view, body, problem, outcome, busy, decide } = useLinkApproval(code, self);
  const { cancel } = account.childLock;
  useEffect(
    () => () => {
      if (pinAsker.is(self)) cancel();
    },
    [cancel, self],
  );

  if (account.childLock.asking && pinAsker.is(self)) return <PinAsk />;
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
          <p className="muted center">{body}</p>
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
