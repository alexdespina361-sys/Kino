import { useEffect, useRef, useState } from "react";
import { ACCENTS, UI_LANGUAGES } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { api, ApiError } from "../account/api";
import { AuthForm } from "../account/AuthForm";
import { Avatar } from "../account/Avatar";
import { describeError } from "../account/errors";
import { useLinkApproval } from "../account/LinkApprove";
import { ProfileGrid } from "../account/Profiles";
import { chooseAccent, chooseLanguage, useSettings } from "../account/settings";
import { ACCENT_SWATCH } from "../account/theme";
import { LANGUAGE_NAMES, useLanguage, useT } from "../i18n";
import { formatLinkCode } from "../shared/format";
import { CheckIcon, TvIcon, UserIcon } from "../shared/icons";
import { linkCodeOf, typedLinkCode } from "../shared/launch";
import { QrCode } from "../shared/QrCode";
import { Screen } from "./Idle";

/** The pages of the account on the TV: the panel (who, settings), signing in, signing another screen in, and "Who's watching?". */
export type AccountView = "panel" | "signin" | "approve" | "profiles";

/** How often the TV asks whether a phone has approved it. */
const POLL_MS = 2000;

interface Request {
  code: string;
  secret: string;
  expiresAt: number;
}

/**
 * Sign this TV in without typing: it shows a code and a QR code, a phone that is already signed in opens the code and approves it,
 * and the answer to the TV's next question carries the session. Email and password typed here is the way for a TV with a keyboard.
 */
export function TvSignIn({ onClose }: { onClose: () => void }) {
  const t = useT();
  const account = useAccount();
  const [mode, setMode] = useState<"phone" | "email">("phone");
  const [request, setRequest] = useState<Request | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const done = useRef({ account, onClose });
  done.current = { account, onClose };

  // One request at a time, asked for again whenever it ends: it ran out, or the phone said no.
  useEffect(() => {
    if (mode !== "phone") return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = (message: string | null, delay: number) => {
      if (!live) return;
      setRequest(null);
      setProblem(message);
      timer = setTimeout(() => setAttempt((n) => n + 1), delay);
    };
    void (async () => {
      let started: Request;
      try {
        started = await api.linkStart("tv");
      } catch (error) {
        return later(describeError(error), 6000);
      }
      if (!live) return;
      setRequest(started);
      setProblem(null);
      const poll = async () => {
        if (!live) return;
        if (Date.now() >= started.expiresAt) return later(null, 0);
        try {
          const outcome = await api.linkPoll(started.code, started.secret);
          if (!live) return;
          if (outcome.status === "approved") {
            done.current.account.signedInAs(outcome.me);
            done.current.onClose();
            return;
          }
          if (outcome.status === "denied") return later(t("link.denied"), 3500);
          if (outcome.status === "gone") return later(null, 0);
        } catch (error) {
          if (!live) return;
          if (error instanceof ApiError && error.status === 404) return later(describeError(error), 6000);
          // not reachable just now (or told to slow down): look again in a moment
        }
        timer = setTimeout(() => void poll(), POLL_MS);
      };
      timer = setTimeout(() => void poll(), POLL_MS);
    })();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [mode, attempt]);

  if (mode === "email") {
    return (
      <Screen key="email" testId="tv-signin" compact focus onBack={() => setMode("phone")}>
        <h1 className="tv-headline tv-headline-small">{t("auth.signIn")}</h1>
        <AuthForm tv onDone={onClose} />
        <button className="tv-action" onClick={() => setMode("phone")} data-nav data-testid="tv-signin-phone">
          {t("link.codeInstead")}
        </button>
      </Screen>
    );
  }

  return (
    <Screen key="phone" testId="tv-signin" compact onBack={onClose}>
      <h1 className="tv-headline tv-headline-small">{t("link.title")}</h1>
      <div className="tv-pair">
        <ol className="tv-steps">
          <li>
            <span className="tv-step-no">1</span>
            <span>{t("link.step1")}</span>
          </li>
          <li>
            <span className="tv-step-no">2</span>
            <span>{t("link.step2")}</span>
          </li>
          <li>
            <span className="tv-step-no">3</span>
            <span>{t("link.step3")}</span>
          </li>
          <li className="tv-code-row">
            <p className="tv-code tv-link-code" data-testid="tv-link-code" aria-live="polite">
              {request ? formatLinkCode(request.code) : "····-····"}
            </p>
          </li>
        </ol>
        <div className="tv-qr">
          {request ? <QrCode value={`${location.origin}/?link=${encodeURIComponent(request.code)}`} label={t("link.scan")} /> : <div className="tv-qr-wait spinner" />}
          <p>{t("link.scan")}</p>
        </div>
      </div>
      <p className={`tv-lead tv-signin-status${problem ? " is-problem" : ""}`} data-testid="tv-signin-status" role="status">
        {problem ?? (
          <>
            <span className="spinner" /> {t("link.waiting")}
          </>
        )}
      </p>
      <div className="tv-actions">
        <button className="tv-action" onClick={() => setMode("email")} data-nav data-testid="tv-signin-email">
          {t("link.emailInstead")}
        </button>
        <button className="tv-action" onClick={onClose} data-nav data-testid="tv-signin-back">
          {t("common.back")}
        </button>
      </div>
    </Screen>
  );
}

/**
 * Sign another screen in from this one, for a computer with no phone at hand: type the code that screen shows, see who is asking,
 * and say yes. The code is typed on a keyboard (or the TV's own on-screen one), the way the email form is.
 */
function TvApprove({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [code, setCode] = useState<string | null>(null);

  if (code) {
    return (
      <TvApproveAsk
        code={code}
        onBack={() => {
          setCode(null);
          setTyped("");
        }}
        onClose={onClose}
      />
    );
  }

  const change = (value: string) => {
    const shown = typedLinkCode(value);
    setTyped(shown);
    setCode(linkCodeOf(shown) ?? null); // all eight characters: on to the request
  };

  return (
    <Screen key="code" testId="tv-approve" compact focus onBack={onClose}>
      <h1 className="tv-headline tv-headline-small">{t("account.signInTv")}</h1>
      <p className="tv-lead">{t("tv.approveHelp")}</p>
      <form className="auth-form auth-tv" onSubmit={(event) => event.preventDefault()} noValidate>
        <label className="auth-field">
          <span>{t("link.enterCode")}</span>
          <input
            className="tv-link-input"
            data-testid="tv-approve-input"
            data-nav
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={9}
            placeholder="ABCD-2345"
            value={typed}
            onChange={(event) => change(event.target.value)}
          />
        </label>
      </form>
      <div className="tv-actions">
        <button className="tv-action" onClick={onClose} data-nav data-testid="tv-approve-back">
          {t("common.back")}
        </button>
      </div>
    </Screen>
  );
}

/** The request behind a typed code: who is asking, and yes or no. Nothing has the focus to begin with, so a stray OK press never signs a screen in. */
function TvApproveAsk({ code, onBack, onClose }: { code: string; onBack: () => void; onClose: () => void }) {
  const t = useT();
  const { email, view, who, problem, outcome, busy, decide } = useLinkApproval(code);

  if (outcome !== "asking") {
    return (
      <Screen key="done" testId="tv-approve-done" compact focus onBack={onClose}>
        <span className="tv-ready-icon">{outcome === "approved" ? <CheckIcon /> : <TvIcon />}</span>
        <h1 className="tv-headline tv-headline-small">{t(outcome === "approved" ? "link.approved" : "link.denied")}</h1>
        <div className="tv-actions">
          <button className="tv-action tv-action-primary" onClick={onClose} data-nav data-testid="tv-approve-close">
            {t("common.done")}
          </button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen key={view ? "ask" : "wait"} testId="tv-approve-ask" compact onBack={onBack}>
      <h1 className="tv-headline tv-headline-small">{t("link.approveTitle")}</h1>
      {view ? (
        <>
          <p className="tv-code tv-link-code" data-testid="tv-approve-code">
            {formatLinkCode(view.code)}
          </p>
          <p className="tv-lead tv-approve-body">{t("link.approveBody", { device: who, email })}</p>
        </>
      ) : problem ? null : (
        <p className="tv-lead tv-signin-status" role="status">
          <span className="spinner" /> {t("common.loading")}
        </p>
      )}
      {problem && (
        <p className="tv-lead tv-signin-status is-problem" role="alert" data-testid="tv-approve-error">
          {problem}
        </p>
      )}
      <div className="tv-actions">
        {view && (
          <>
            <button className="tv-action tv-action-primary" disabled={busy} onClick={() => void decide(true)} data-nav data-testid="tv-approve-yes">
              {t("link.approve")}
            </button>
            <button className="tv-action" disabled={busy} onClick={() => void decide(false)} data-nav data-testid="tv-approve-no">
              {t("link.deny")}
            </button>
          </>
        )}
        <button className="tv-action" onClick={onBack} data-nav data-testid="tv-approve-again">
          {t("common.back")}
        </button>
      </div>
    </Screen>
  );
}

/** "Who's watching?": the profiles of the signed-in account as big pictures. Shown by itself when nobody has been picked on this TV yet. */
export function TvProfiles({ forced, onDone, onBack }: { forced: boolean; onDone: () => void; onBack: () => void }) {
  const t = useT();
  const account = useAccount();
  if (!account.me) return null;
  return (
    <Screen testId="tv-profiles" focus onBack={forced ? undefined : onBack}>
      <h1 className="tv-headline">{t("profiles.title")}</h1>
      <ProfileGrid
        tv
        profiles={account.me.profiles}
        current={account.profile?.id}
        onPick={(picked) => {
          account.choose(picked.id);
          onDone();
        }}
      />
      <p className="tv-lead tv-hint">{t("tv.profilesHint")}</p>
      <div className="tv-actions">
        {!forced && (
          <button className="tv-action" onClick={onBack} data-nav data-testid="tv-profiles-back">
            {t("common.back")}
          </button>
        )}
        <button className="tv-action" onClick={() => void account.signOut().then(onDone)} data-nav data-testid="tv-profiles-signout">
          {t("auth.signOut")}
        </button>
      </div>
    </Screen>
  );
}

/** Who is watching, and what the site looks like and does: language, colour, autoplay. For guests it is where signing in starts. */
export function TvAccountPanel({ onClose, onSignIn, onApprove, onSwitch }: { onClose: () => void; onSignIn: () => void; onApprove: () => void; onSwitch: () => void }) {
  const t = useT();
  const language = useLanguage();
  const account = useAccount();
  const { settings, set } = useSettings();
  const { me, profile } = account;
  const autoplay = settings.autoplayNext ?? true;
  return (
    <Screen testId="tv-account" focus onBack={onClose}>
      <div className="tv-panel">
        <section className="tv-panel-who">
          {me && profile ? (
            <Avatar id={profile.avatar} className="tv-panel-avatar" />
          ) : (
            <span className="tv-panel-guest" aria-hidden="true">
              <UserIcon />
            </span>
          )}
          <h1 data-testid="tv-account-name">{me && profile ? profile.name : t("tv.notSignedIn")}</h1>
          <p>{me ? t("account.signedInAs", { email: me.account.email }) : t("auth.pitchDetail")}</p>
          <div className="tv-panel-actions">
            {me && profile ? (
              <>
                {me.profiles.length > 1 && (
                  <button className="tv-action" onClick={onSwitch} data-nav data-autofocus data-testid="tv-switch-profile">
                    {t("profiles.switch")}
                  </button>
                )}
                <button className="tv-action" onClick={onApprove} data-nav data-testid="tv-approve">
                  {t("account.signInTv")}
                </button>
                <button className="tv-action" onClick={() => void account.signOut().then(onClose)} data-nav data-testid="tv-sign-out">
                  {t("auth.signOut")}
                </button>
              </>
            ) : (
              account.status === "ready" && (
                <button className="tv-action tv-action-primary" onClick={onSignIn} data-nav data-autofocus data-testid="tv-sign-in">
                  {t("auth.signIn")}
                </button>
              )
            )}
            <button className="tv-action" onClick={onClose} data-nav data-testid="tv-account-back">
              {t("common.back")}
            </button>
          </div>
        </section>

        <section className="tv-panel-settings">
          <h2>{t("settings.language")}</h2>
          <div className="tv-choices" role="radiogroup" aria-label={t("settings.language")}>
            {UI_LANGUAGES.map((code) => (
              <button key={code} className="tv-choice" role="radio" aria-checked={language === code} onClick={() => chooseLanguage(code)} data-nav data-testid={`tv-lang-${code}`}>
                {LANGUAGE_NAMES[code]}
              </button>
            ))}
          </div>

          <h2>{t("settings.accent")}</h2>
          <div className="tv-swatches" role="radiogroup" aria-label={t("settings.accent")}>
            {ACCENTS.map((accent) => (
              <button
                key={accent}
                className="tv-swatch"
                role="radio"
                aria-checked={(settings.accent ?? ACCENTS[0]) === accent}
                aria-label={t(`accent.${accent}`)}
                style={{ background: ACCENT_SWATCH[accent] }}
                onClick={() => chooseAccent(accent)}
                data-nav
                data-testid={`tv-accent-${accent}`}
              >
                <CheckIcon />
              </button>
            ))}
          </div>

          <h2>{t("settings.playback")}</h2>
          <button className="tv-switch-row" role="switch" aria-checked={autoplay} onClick={() => set("autoplayNext", !autoplay)} data-nav data-testid="tv-autoplay">
            <span>{t("settings.autoplayNext")}</span>
            <span className="tv-switch" aria-hidden="true" />
          </button>
          {me && <p className="tv-hint">{t("tv.subtitlesHint")}</p>}
        </section>
      </div>
    </Screen>
  );
}

/** Whichever page of the account is open. `forced`: signed in with nobody chosen yet, which can't be skipped. */
export function TvAccount({ view, onView, forced }: { view: AccountView; onView: (view: AccountView | null) => void; forced: boolean }) {
  if (view === "signin") return <TvSignIn onClose={() => onView(null)} />;
  if (view === "approve") return <TvApprove onClose={() => onView("panel")} />;
  if (view === "profiles") return <TvProfiles forced={forced} onDone={() => onView(null)} onBack={() => onView("panel")} />;
  return <TvAccountPanel onClose={() => onView(null)} onSignIn={() => onView("signin")} onApprove={() => onView("approve")} onSwitch={() => onView("profiles")} />;
}
