import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../account/AccountProvider";
import { Avatar } from "../account/Avatar";
import { chatWaiting } from "../chat/notices";
import { useFriends } from "../friends/FriendsProvider";
import { useBell } from "../friends/useBell";
import { useT } from "../i18n";
import { useHandHeldBack } from "../shared/backButton";
import { formatCode } from "../shared/format";
import { enterFullscreen, useFullscreen } from "../shared/fullscreen";
import { BellIcon, CheckIcon, ChevronLeftIcon, UserIcon, UsersIcon } from "../shared/icons";
import { controlLink, pairLink } from "../shared/launch";
import { Logo } from "../shared/Logo";
import { RoleSwitch } from "../shared/RoleSwitch";
import { QrCode } from "../shared/QrCode";
import { navItems, useBack, useDpad } from "./dpad";
import { actionForKey } from "./keys";
import { TvCode } from "./TvCode";

export interface Pairing {
  code: string;
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
  compact?: boolean;
  focus?: boolean;
  onBack?: (() => void) | undefined;
  leaving?: (() => void) | undefined;
  className?: string;
}

export function Screen({ children, testId, compact = false, focus = false, onBack, leaving, className }: ScreenProps) {
  const ref = useRef<HTMLElement>(null);
  useDpad(ref);
  useBack(onBack, leaving);
  useEffect(() => {
    if (!focus || !ref.current) return;
    (ref.current.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)") ?? navItems(ref.current)[0])?.focus();
  }, [focus]);
  return (
    <section className={`tv-screen${compact ? " tv-screen-compact" : ""}${className ? ` ${className}` : ""}`} ref={ref} data-testid={testId}>
      <Brand />
      {children}
    </section>
  );
}

export function BackButton({ onClick, testId, label, autoFocus = false, col }: { onClick: () => void; testId: string; label?: string; autoFocus?: boolean; col?: number }) {
  const t = useT();
  const text = label ?? t("common.back");
  const place = col === undefined ? { "data-nav": true } : { "data-zone": "top", "data-row": 0, "data-col": col, "aria-label": text };
  return (
    <button className="tv-action tv-back" onClick={onClick} {...place} {...(autoFocus ? { "data-autofocus": true } : {})} data-testid={testId}>
      <ChevronLeftIcon /> {col === undefined ? text : <span className="tv-back-label">{text}</span>}
    </button>
  );
}

export function ChatsChip({ onOpen, col }: { onOpen: () => void; col: number }) {
  const t = useT();
  const friends = useFriends();
  const count = chatWaiting(friends.state).length;
  return (
    <button
      className="tv-corner-button tv-bell tv-chats"
      onClick={onOpen}
      data-zone="top"
      data-row={0}
      data-col={col}
      data-testid="tv-chats"
      aria-label={count > 0 ? t("chats.ariaCount", { count }) : t("chats.title")}
    >
      <UsersIcon />
      {count > 0 && (
        <b className="tv-bell-badge" data-testid="tv-chats-badge">
          {count > 9 ? "9+" : count}
        </b>
      )}
    </button>
  );
}

export function BellChip({ onOpen, col, chatsApart = false }: { onOpen: () => void; col: number; chatsApart?: boolean }) {
  const t = useT();
  const bell = useBell(chatsApart);
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

const WELCOME_MS = 1400;
const WELCOME_FADE_MS = 700;

export function TvWelcome({ ask, onDone }: { ask: boolean; onDone: () => void }) {
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const fullscreen = useFullscreen();
  const enter = () => {
    enterFullscreen();
    setLeaving(true);
  };
  useHandHeldBack(ask && !leaving ? () => setLeaving(true) : undefined);
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
      if (!action) return;
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
        <p className="tv-welcome-about" data-testid="welcome-about">
          {t("tv.welcomeAbout")}
        </p>
      )}
      {ask && (
        <button className="tv-action" data-testid="welcome-enter">
          {t("tv.welcomeStart")}
        </button>
      )}
    </div>
  );
}

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
  control: Pairing | null;
  resolving: boolean;
  stuck: boolean;
  onCancel: () => void;
  onDisconnect: () => void;
  onBack: () => void;
}

export function TvIdle({ paired, pairing, control, resolving, stuck, onCancel, onDisconnect, onBack }: IdleProps) {
  const t = useT();
  const back = <BackButton onClick={onBack} testId="tv-back-to-library" label={t("tv.backToLibrary")} autoFocus />;

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
      <Screen key="paired" compact onBack={onBack}>
        <span className="tv-ready-icon">
          <CheckIcon />
        </span>
        <h1 className="tv-headline tv-headline-small" data-testid="tv-paired">
          {t("tv.connectedWaiting")}
        </h1>
        <p className="tv-lead">{t("tv.connectedLead")}</p>
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
        {back}
        <div className="tv-actions">
          <button className="tv-action" onClick={onDisconnect} data-testid="tv-disconnect" data-nav>
            {t("tv.disconnect")}
          </button>
        </div>
      </Screen>
    );
  }

  if (pairing) {
    const link = pairLink(pairing.code);
    return (
      <Screen key="pairing" focus onBack={onBack}>
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
    <Screen testId="tv-connecting" onBack={onBack}>
      <div className="spinner tv-spinner" />
      <h1 className="tv-headline">{t("tv.connecting")}</h1>
    </Screen>
  );
}
