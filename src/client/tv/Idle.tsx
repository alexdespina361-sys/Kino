import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/AccountProvider";
import { Avatar } from "../account/Avatar";
import { useBell } from "../friends/useBell";
import { useT } from "../i18n";
import { useHandHeldBack } from "../shared/backButton";
import { formatCode } from "../shared/format";
import { enterFullscreen, useFullscreen } from "../shared/fullscreen";
import { BellIcon, CheckIcon, ChevronLeftIcon, UserIcon } from "../shared/icons";
import { controlLink, pairLink } from "../shared/launch";
import { Logo } from "../shared/Logo";
import { RoleSwitch } from "../shared/RoleSwitch";
import { QrCode } from "../shared/QrCode";
import { navItems, useBack, useDpad } from "./dpad";
import { actionForKey } from "./keys";
import { TvCode } from "./TvCode";

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
  /** What the system's Back of a phone or a tablet does here, where it is not what the remote's does (see `useBack`). */
  leaving?: (() => void) | undefined;
}

/** A full-screen page the remote can walk around: its `[data-nav]` buttons are reached with the arrow keys. */
export function Screen({ children, testId, compact = false, focus = false, onBack, leaving }: ScreenProps) {
  const ref = useRef<HTMLElement>(null);
  useDpad(ref);
  useBack(onBack, leaving);
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

/**
 * The way out of a full-screen page, the same on every page that has one: a quiet button in the top corner (the stylesheet puts it there,
 * wherever it stands in the page), level with the wordmark. What a page is for is the accent's colour; leaving it never is. `label` says
 * where it goes when that is worth saying ("Back to the library").
 */
export function BackButton({ onClick, testId, label, autoFocus = false, col }: { onClick: () => void; testId: string; label?: string; autoFocus?: boolean; /** In the library's top bar: its place among the corner's buttons, which the library's own arrow keys walk (a page that fills the screen is walked by `data-nav`). */ col?: number }) {
  const t = useT();
  const text = label ?? t("common.back");
  // (In the library's top bar its name goes on a small screen, where the account button needs the room: the button then keeps it for a screen reader.)
  const place = col === undefined ? { "data-nav": true } : { "data-zone": "top", "data-row": 0, "data-col": col, "aria-label": text };
  return (
    <button className="tv-action tv-back" onClick={onClick} {...place} {...(autoFocus ? { "data-autofocus": true } : {})} data-testid={testId}>
      <ChevronLeftIcon /> {col === undefined ? text : <span className="tv-back-label">{text}</span>}
    </button>
  );
}

/**
 * The bell beside the account chip: a number on it while something waits for an answer, a quieter dot when friends only watched something.
 * Not there while friends are off. `col` is its place among the corner's buttons, for the library's arrow keys.
 */
export function BellChip({ onOpen, col }: { onOpen: () => void; col: number }) {
  const t = useT();
  const bell = useBell();
  if (!bell.on) return null;
  return (
    <button
      className="tv-corner-button tv-bell"
      onClick={onOpen}
      data-zone="top"
      data-row={0}
      data-col={col}
      data-testid="tv-bell"
      aria-label={bell.badge > 0 ? t("bell.ariaCount", { count: bell.badge }) : t("bell.title")}
    >
      <BellIcon />
      {bell.badge > 0 ? (
        <b className="tv-bell-badge" data-testid="tv-bell-badge">
          {bell.badge > 9 ? "9+" : bell.badge}
        </b>
      ) : (
        bell.fresh && <i className="tv-bell-dot" aria-hidden="true" data-testid="tv-bell-dot" />
      )}
    </button>
  );
}

/**
 * Top right of the library: who is watching on this TV, or a way to sign in. It opens the profile's page (what this profile rated, its friends and
 * History, and Settings in that page's corner). `zone`: the library's own arrow keys walk to it, not the screen's; `col` is its place among the
 * corner's buttons; `current`: the page that is open is the profile's (or one of the pages that belong to it). On a server that has no accounts
 * it is still there, as "Profile": nobody signs in, but the page has Settings in its corner, and there is no other way to them.
 */
export function AccountChip({ onOpen, zone = false, col = 0, current = false }: { onOpen: () => void; zone?: boolean; col?: number; current?: boolean }) {
  const t = useT();
  const { status, me, profile } = useAccount();
  if (status === "loading") return null;
  const guestWord = t(status === "ready" ? "account.signInPrompt" : "tv.profile");
  return (
    <button
      className="tv-account-chip"
      onClick={onOpen}
      aria-current={current ? "page" : undefined}
      {...(zone ? { "data-zone": "top", "data-row": 0, "data-col": col } : { "data-nav": true })}
      data-testid="tv-account-chip"
      aria-label={me && profile ? `${t("account.open")}: ${profile.name}` : guestWord}
    >
      {me && profile ? (
        <>
          <Avatar id={profile.avatar} className="tv-chip-avatar" />
          <span>{profile.name}</span>
        </>
      ) : (
        <>
          <UserIcon />
          <span>{guestWord}</span>
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
 *
 * A screen that is not full screen yet (and whose viewer has not turned that down) `ask`s instead: it waits, with a button that
 * takes it there, as that press is what a browser wants. Any other key or click is that press too (the page has already acted on
 * it by now) and Back says not now. While it waits, the library under it gets no keys, so OK can only mean the button.
 */
export function TvWelcome({ ask, onDone }: { ask: boolean; onDone: () => void }) {
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const fullscreen = useFullscreen();
  const enter = () => {
    enterFullscreen();
    setLeaving(true);
  };
  useHandHeldBack(ask && !leaving ? () => setLeaving(true) : undefined); // (a phone's own Back says not now, as the remote's does)
  useEffect(() => {
    const leave = () => setLeaving(true);
    if (!ask) {
      const timer = window.setTimeout(leave, WELCOME_MS);
      window.addEventListener("keydown", leave);
      window.addEventListener("pointerdown", leave);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("keydown", leave);
        window.removeEventListener("pointerdown", leave);
      };
    }
    const keys = (event: KeyboardEvent) => {
      const action = event.altKey || event.ctrlKey || event.metaKey ? null : actionForKey(event);
      if (!action) return; // the browser's own keys (reload, F11...) and ones that mean nothing here are left alone
      event.stopPropagation();
      event.preventDefault();
      if (event.type !== "keydown") return;
      if (action === "back") leave();
      else if (action === "select") enter();
    };
    window.addEventListener("keydown", keys, true);
    window.addEventListener("keyup", keys, true);
    return () => {
      window.removeEventListener("keydown", keys, true);
      window.removeEventListener("keyup", keys, true);
    };
  }, []);
  // However the page got there (the button, another key, the browser's own), being full screen is what it asked for.
  useEffect(() => {
    if (ask && fullscreen) setLeaving(true);
  }, [fullscreen]);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(onDone, WELCOME_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  return (
    <div className="tv-welcome" data-leaving={leaving} data-asking={ask} data-testid="tv-welcome" aria-hidden={!ask} onClick={ask ? enter : undefined}>
      <Logo />
      <p>{t("tv.welcome")}</p>
      {ask && (
        <button className="tv-action" data-testid="welcome-enter">
          {t("tv.welcomeStart")}
        </button>
      )}
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
  const back = <BackButton onClick={onBack} testId="tv-back-to-library" label={t("tv.backToLibrary")} />;

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
              <TvCode shown={control ? formatCode(control.code) : "…"} copy={control?.code} testId="tv-join-code" copyTestId="tv-join-code-copy" />
            </li>
          </ol>
          <div className="tv-qr">
            {control ? <QrCode value={controlLink(control.code)} label={t("menu.controlQr")} /> : <div className="spinner tv-qr-wait" />}
            <p>{t("tv.qrHint")}</p>
          </div>
        </div>
        {/* (The way out comes before Disconnect in page order, though the stylesheet puts it in the corner: the remote's first press lands on the first button, and while the code is on its way there is no Copy before it, so it must not be the one that lets go of every phone.) */}
        {back}
        {/* Reached with the remote's arrow keys; the first press only lands on a button, it never presses one. */}
        <div className="tv-actions">
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
              <TvCode shown={formatCode(pairing.code)} copy={pairing.code} testId="pairing-code" copyTestId="pairing-code-copy" />
            </li>
          </ol>
          <div className="tv-qr">
            <QrCode value={link} label={t("tv.qrLabel")} />
            <p>{t("tv.qrHint")}</p>
          </div>
        </div>
        {back}
        <RoleSwitch to="remote" />
      </Screen>
    );
  }

  return (
    // (Waiting for a code that may be a while coming: Back is the way out to the library, as it is from the code itself.)
    <Screen testId="tv-connecting" onBack={onBack}>
      <div className="spinner tv-spinner" />
      <h1 className="tv-headline">{t("tv.connecting")}</h1>
    </Screen>
  );
}
