import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/AccountProvider";
import { Avatar } from "../account/Avatar";
import { useT } from "../i18n";
import { formatCode } from "../shared/format";
import { CheckIcon, UserIcon } from "../shared/icons";
import { controlLink, pairLink } from "../shared/launch";
import { Logo } from "../shared/Logo";
import { RoleSwitch } from "../shared/RoleSwitch";
import { QrCode } from "../shared/QrCode";
import { navItems, useBack, useDpad } from "./dpad";

export interface Pairing {
  code: string;
  /** Local deadline (Date.now() based) computed from the server's remaining lifetime. */
  expiresAt: number;
}

function Brand() {
  return (
    <div className="tv-brand">
      <Logo />
    </div>
  );
}

interface ScreenProps {
  children: ReactNode;
  testId?: string;
  /** Tighter spacing, for pages with more on them than a headline and a button. */
  compact?: boolean;
  /** Land on the first button (or the one marked `data-autofocus`) as the screen opens, for screens that are a question. */
  focus?: boolean;
  /** What the remote's Back does here. Without it, Back is left to whoever listens. */
  onBack?: (() => void) | undefined;
}

/** A full-screen page the remote can walk around: its `[data-nav]` buttons are reached with the arrow keys. */
export function Screen({ children, testId, compact = false, focus = false, onBack }: ScreenProps) {
  const ref = useRef<HTMLElement>(null);
  useDpad(ref);
  useBack(onBack);
  useEffect(() => {
    if (!focus || !ref.current) return;
    (ref.current.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)") ?? navItems(ref.current)[0])?.focus();
  }, [focus]);
  return (
    <section className={`tv-screen${compact ? " tv-screen-compact" : ""}`} ref={ref} data-testid={testId}>
      <Brand />
      {children}
    </section>
  );
}

/** Top right of the library: who is watching on this TV, or a way to sign in. `zone`: the library's own arrow keys walk to it, not the screen's. */
export function AccountChip({ onOpen, zone = false }: { onOpen: () => void; zone?: boolean }) {
  const t = useT();
  const { status, me, profile } = useAccount();
  if (status !== "ready") return null;
  return (
    <button
      className="tv-account-chip"
      onClick={onOpen}
      {...(zone ? { "data-zone": "top", "data-row": 0, "data-col": 0 } : { "data-nav": true })}
      data-testid="tv-account-chip"
      aria-label={me && profile ? `${t("account.open")}: ${profile.name}` : t("account.signInPrompt")}
    >
      {me && profile ? (
        <>
          <Avatar id={profile.avatar} className="tv-chip-avatar" />
          <span>{profile.name}</span>
        </>
      ) : (
        <>
          <UserIcon />
          <span>{t("account.signInPrompt")}</span>
        </>
      )}
    </button>
  );
}

/** How long the welcome stays before it fades, and how long the fade takes. */
const WELCOME_MS = 1400;
const WELCOME_FADE_MS = 700;

/**
 * The first moments of a screen that has just opened: the name and a greeting over the library as it fills in. It fades away by
 * itself, or at the first press, and never takes a press: the library under it is already there.
 */
export function TvWelcome({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const leave = () => setLeaving(true);
    const timer = window.setTimeout(leave, WELCOME_MS);
    window.addEventListener("keydown", leave);
    window.addEventListener("pointerdown", leave);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", leave);
      window.removeEventListener("pointerdown", leave);
    };
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(onDone, WELCOME_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  return (
    <div className="tv-welcome" data-leaving={leaving} data-testid="tv-welcome" aria-hidden="true">
      <Logo />
      <p>{t("tv.welcome")}</p>
    </div>
  );
}

/** A screen that opened on a watch party's link needs one press before the browser will let the host's video play, so it asks for it. */
export function TvLocked({ onUnlock }: { onUnlock: () => void }) {
  const t = useT();
  return (
    <Screen>
      <h1 className="tv-headline">{t("tv.ready")}</h1>
      <button className="tv-ok" autoFocus onClick={onUnlock} data-testid="unlock" data-nav>
        {t("tv.pressOk")}
      </button>
      <RoleSwitch to="remote" />
    </Screen>
  );
}

interface IdleProps {
  paired: boolean;
  pairing: Pairing | null;
  /** Once a phone is connected: the code that lets another one in (null until the server has answered). */
  control: Pairing | null;
  /** The server is looking up a link that was just chosen. */
  resolving: boolean;
  /** The lookup has gone on too long: a button to give up on it appears. */
  stuck: boolean;
  /** Give up waiting for the video. Back does it too. */
  onCancel: () => void;
  /** Let go of the paired phone and show a new code. */
  onDisconnect: () => void;
  /** Back to the library. */
  onBack: () => void;
}

/** What the TV shows besides the library, a video and a watch party: finding one, pairing a phone, being paired. */
export function TvIdle({ paired, pairing, control, resolving, stuck, onCancel, onDisconnect, onBack }: IdleProps) {
  const t = useT();
  const back = (
    <button className="tv-action tv-action-primary" onClick={onBack} data-testid="tv-back-to-library" data-nav>
      {t("tv.backToLibrary")}
    </button>
  );

  if (resolving) {
    return (
      <Screen testId="tv-resolving" focus={stuck} onBack={onCancel}>
        <div className="spinner tv-spinner" />
        <h1 className="tv-headline">{t("tv.finding")}</h1>
        {stuck && (
          <>
            <p className="tv-lead">{t("tv.slow")}</p>
            <div className="tv-actions">
              <button className="tv-action tv-action-primary" onClick={onCancel} data-testid="tv-cancel-load" data-nav>
                {t("common.cancel")}
              </button>
            </div>
          </>
        )}
      </Screen>
    );
  }

  if (paired) {
    return (
      <Screen compact onBack={onBack}>
        <span className="tv-ready-icon">
          <CheckIcon />
        </span>
        <h1 className="tv-headline tv-headline-small" data-testid="tv-paired">
          {t("tv.connectedWaiting")}
        </h1>
        <p className="tv-lead">{t("tv.connectedLead")}</p>
        {/* Another phone joins the way the first did: the same steps, and the QR code opens the page with this code in it. */}
        <p className="tv-join-title">{t("tv.morePhones")}</p>
        <div className="tv-pair tv-party-invite" data-testid="tv-join">
          <ol className="tv-steps">
            <li>
              <span className="tv-step-no">1</span>
              <span>
                {t("tv.stepOpen")} <b>{location.host}</b>
              </span>
            </li>
            <li>
              <span className="tv-step-no">2</span>
              <span>{t("tv.stepEnter")}</span>
            </li>
            <li className="tv-code-row">
              <p className="tv-code" data-testid="tv-join-code">
                {control ? formatCode(control.code) : "…"}
              </p>
            </li>
          </ol>
          <div className="tv-qr">
            {control ? <QrCode value={controlLink(control.code)} label={t("menu.controlQr")} /> : <div className="spinner tv-qr-wait" />}
            <p>{t("tv.qrHint")}</p>
          </div>
        </div>
        {/* Reached with the remote's arrow keys; the first press only lands on a button, it never presses one. */}
        <div className="tv-actions">
          {back}
          <button className="tv-action" onClick={onDisconnect} data-testid="tv-disconnect" data-nav>
            {t("tv.disconnect")}
          </button>
        </div>
      </Screen>
    );
  }

  if (pairing) {
    // The QR code opens the phone page with the code filled in, so pairing needs no typing at all.
    const link = pairLink(pairing.code);
    return (
      <Screen onBack={onBack}>
        <div className="tv-pair">
          <ol className="tv-steps">
            <li>
              <span className="tv-step-no">1</span>
              <span>
                {t("tv.stepOpen")} <b>{location.host}</b>
              </span>
            </li>
            <li>
              <span className="tv-step-no">2</span>
              <span>{t("tv.stepEnter")}</span>
            </li>
            <li className="tv-code-row">
              <p className="tv-code" data-testid="pairing-code">
                {formatCode(pairing.code)}
              </p>
            </li>
          </ol>
          <div className="tv-qr">
            <QrCode value={link} label={t("tv.qrLabel")} />
            <p>{t("tv.qrHint")}</p>
          </div>
        </div>
        <div className="tv-actions">{back}</div>
        <RoleSwitch to="remote" />
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="spinner tv-spinner" />
      <h1 className="tv-headline">{t("tv.connecting")}</h1>
    </Screen>
  );
}
