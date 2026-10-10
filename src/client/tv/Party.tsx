import { useEffect, useRef, useState, type RefObject } from "react";
import type { PartyView } from "../../shared";
import { useT } from "../i18n";
import { formatCode } from "../shared/format";
import { BackspaceIcon, CheckIcon, CloseIcon, FullscreenIcon, UsersIcon } from "../shared/icons";
import { partyLink } from "../shared/launch";
import { QrCode } from "../shared/QrCode";
import { Screen } from "./Idle";

/** How a button joins the remote's arrow keys: the pages use `data-nav`, the panel over a film `data-opt` (see dpad.ts and Menu.tsx). */
type Nav = Record<string, string | number | boolean>;
const PAGE_NAV: Nav = { "data-nav": true };
const PANEL_NAV: Nav = { "data-opt": true, "data-col": 1 };

/** Who is in the party, the host first. The host can send a guest away; a screen that is gone from the network is dimmed. */
function Members({ party, nav, onRemove }: { party: PartyView; nav: Nav; onRemove?: (id: string) => void }) {
  const t = useT();
  const all = [
    { ...party.host, host: true },
    ...party.guests.map((guest) => ({ ...guest, host: false })),
  ];
  return (
    <ul className="tv-party-members" data-testid="tv-party-members" aria-label={t("party.members")}>
      {all.map((tv) => (
        <li className="tv-party-member" key={tv.id} data-testid="tv-party-member" data-online={tv.online} data-host={tv.host}>
          <i className="tv-party-dot" aria-hidden="true" />
          <span className="tv-party-name">{tv.name}</span>
          {tv.id === party.you && <small>{t("party.you")}</small>}
          {tv.host && <small>{t("party.host")}</small>}
          {!tv.online && <small>{t("party.offline")}</small>}
          {onRemove && !tv.host && (
            <button className="tv-party-remove" data-testid="tv-party-remove" onClick={() => onRemove(tv.id)} {...nav}>
              {t("party.remove")}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** How to get in: the steps, the code and the QR code that carries it. The code is renewed while it is on screen, so it can be a moment late. */
function Invite({ code }: { code: string | undefined }) {
  const t = useT();
  return (
    <div className="tv-pair tv-party-invite">
      <ol className="tv-steps">
        <li>
          <span className="tv-step-no">1</span>
          <span>
            {t("party.stepOpen")} <b>{location.host}</b>
          </span>
        </li>
        <li>
          <span className="tv-step-no">2</span>
          <span>{t("party.stepJoin")}</span>
        </li>
        <li>
          <span className="tv-step-no">3</span>
          <span>{t("party.stepCode")}</span>
        </li>
        <li className="tv-code-row">
          <p className="tv-code" data-testid="tv-party-code">
            {code ? formatCode(code) : "…"}
          </p>
        </li>
      </ol>
      <div className="tv-qr">
        {code ? <QrCode value={partyLink(code)} label={t("party.qrLabel")} /> : <div className="spinner tv-qr-wait" />}
        <p>{t("party.qrHint")}</p>
      </div>
    </div>
  );
}

interface PageProps {
  /** The party this screen is in, if it is in one. */
  party: PartyView | null;
  /** The name of the screen this one watches along with. Known before the list of who is in the party is. */
  following: string | null;
  /** Whether the page is full screen, and the way to change that (null where the browser has no full screen to give a page). */
  fullscreen: boolean;
  onFullscreen: (() => void) | null;
  /** Why the code that was typed was refused. `id` changes with every refusal. */
  error: { id: number; text: string } | null;
  onStart: () => void;
  onJoin: (code: string) => void;
  onRemove: (id: string) => void;
  onEnd: () => void;
  onLeave: () => void;
  onBack: () => void;
}

/** What the TV shows for a watch party while nothing plays: starting or joining one, inviting the others, or waiting for the host. */
export function PartyPage(p: PageProps) {
  const t = useT();
  const [joining, setJoining] = useState(false);
  // Back from a party that was joined: the question again, not the number pad.
  useEffect(() => {
    if (p.following) setJoining(false);
  }, [p.following]);

  // A screen that watches along: the host chooses what plays, so there is nothing to do but wait, or leave.
  if (p.following) {
    return (
      <Screen testId="tv-party-guest">
        <span className="tv-ready-icon">
          <CheckIcon />
        </span>
        <h1 className="tv-headline" data-testid="tv-following">
          {t("tv.following", { name: p.following })}
        </h1>
        <p className="tv-lead">{t("tv.followingLead")}</p>
        {p.party && <Members party={p.party} nav={PAGE_NAV} />}
        <div className="tv-actions">
          {/* A phone's browser keeps its address bar over the page until the page goes full screen, so the way there is offered while waiting. */}
          {p.onFullscreen && (
            <button className="tv-action" onClick={p.onFullscreen} data-testid="tv-fullscreen" data-nav>
              <FullscreenIcon /> {t(p.fullscreen ? "remote.exitFullscreen" : "remote.fullscreen")}
            </button>
          )}
          <button className="tv-action" onClick={p.onLeave} data-testid="tv-disconnect" data-nav>
            {t("tv.stopFollowing")}
          </button>
        </div>
      </Screen>
    );
  }

  if (p.party?.role === "host") {
    return (
      <Screen testId="tv-party" compact focus onBack={p.onBack}>
        <h1 className="tv-headline tv-headline-small">{t("party.rail")}</h1>
        <Invite code={p.party.code?.code} />
        <Members party={p.party} nav={PAGE_NAV} onRemove={p.onRemove} />
        {p.party.guests.length === 0 && <p className="tv-hint">{t("party.waiting")}</p>}
        <div className="tv-actions">
          <button className="tv-action tv-action-primary" onClick={p.onBack} data-testid="tv-back-to-library" data-nav data-autofocus>
            {t("tv.backToLibrary")}
          </button>
          <button className="tv-action" onClick={p.onEnd} data-testid="tv-party-end" data-nav>
            {t("party.end")}
          </button>
        </div>
      </Screen>
    );
  }

  if (joining) return <JoinPage error={p.error} onJoin={p.onJoin} onBack={() => setJoining(false)} />;

  return (
    <Screen testId="tv-party" focus onBack={p.onBack}>
      <h1 className="tv-headline">{t("party.rail")}</h1>
      <p className="tv-lead">{t("party.lead")}</p>
      <div className="tv-party-choices">
        <button className="tv-party-choice" onClick={p.onStart} data-testid="tv-party-start" data-nav>
          <UsersIcon />
          <b>{t("party.start")}</b>
          <small>{t("party.startHint")}</small>
        </button>
        <button className="tv-party-choice" onClick={() => setJoining(true)} data-testid="tv-party-join" data-nav>
          <UsersIcon />
          <b>{t("party.join")}</b>
          <small>{t("party.joinHint")}</small>
        </button>
      </div>
      <div className="tv-actions">
        <button className="tv-action" onClick={p.onBack} data-testid="tv-back-to-library" data-nav>
          {t("tv.backToLibrary")}
        </button>
      </div>
    </Screen>
  );
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/** Typing the 6-digit code of a party: the digits of the remote or keyboard, or the number pad on screen. The sixth digit sends it. */
function JoinPage({ error, onJoin, onBack }: { error: PageProps["error"]; onJoin: (code: string) => void; onBack: () => void }) {
  const t = useT();
  const [digits, setDigits] = useState("");
  // The key listener below lives as long as the page, so what it reads is kept where it always finds the latest.
  const latest = useRef(digits);
  latest.current = digits;
  const submit = useRef(onJoin);
  submit.current = onJoin;

  const add = (digit: string) => {
    const now = latest.current;
    if (now.length >= 6) return;
    const next = now + digit;
    latest.current = next;
    setDigits(next);
    if (next.length === 6) submit.current(next);
  };
  const remove = () => setDigits((now) => now.slice(0, -1));

  // A code that was refused is used up: start over.
  useEffect(() => {
    if (error) setDigits("");
  }, [error?.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !/^[0-9]$/.test(event.key)) return;
      event.preventDefault();
      add(event.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Back takes digits back one at a time and leaves when there are none, the way a PIN screen does.
  const back = () => (latest.current ? remove() : onBack());

  return (
    <Screen testId="tv-party-join-page" compact focus onBack={back}>
      <h1 className="tv-headline tv-headline-small">{t("party.join")}</h1>
      <p className="tv-hint">{t("party.joinHint")}</p>
      <p className="tv-code-boxes" data-testid="tv-party-digits" aria-live="polite">
        {Array.from({ length: 6 }, (_, i) => (
          <i key={i} data-filled={i < digits.length}>
            {digits[i] ?? ""}
          </i>
        ))}
      </p>
      <p className={`tv-party-error${error ? " is-shown" : ""}`} role="alert" data-testid="tv-party-error">
        {error?.text ?? ""}
      </p>
      <div className="tv-pad" role="group" aria-label={t("party.keys")}>
        {DIGITS.map((digit) => (
          <button className="tv-key" key={digit} onClick={() => add(digit)} data-testid={`pad-${digit}`} data-nav>
            {digit}
          </button>
        ))}
        <button className="tv-key" onClick={remove} aria-label={t("tv.delete")} data-testid="pad-delete" data-nav>
          <BackspaceIcon />
        </button>
        <button className="tv-key" onClick={() => add("0")} data-testid="pad-0" data-nav>
          0
        </button>
        <button className="tv-key" onClick={onBack} aria-label={t("common.back")} data-testid="pad-back" data-nav>
          <CloseIcon />
        </button>
      </div>
    </Screen>
  );
}

interface PanelProps {
  party: PartyView | null;
  following: string | null;
  rootRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onStart: () => void;
  onRemove: (id: string) => void;
  onEnd: () => void;
  onLeave: () => void;
}

/** The watch party over a film: start one, see who is in it and how to join, end it or leave it. Looks and walks like the other pickers (Menu.tsx). */
export function PartyPanel(p: PanelProps) {
  const t = useT();
  const host = p.party?.role === "host";

  // What was focused may be gone (Start becomes the code, a guest left): land on the first thing that is there.
  useEffect(() => {
    const root = p.rootRef.current;
    if (root && !root.contains(document.activeElement)) root.querySelector<HTMLElement>("[data-opt]")?.focus();
  });

  return (
    <div className="tv-menu-backdrop" data-kind="party" onClick={p.onClose}>
      <div
        className="tv-menu"
        ref={p.rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("party.rail")}
        data-testid="tv-party-panel"
        data-kind="party"
        data-cols={host ? 2 : 1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tv-menu-top">
          <h2>{t("party.rail")}</h2>
          <button className="tv-btn tv-btn-icon" onClick={p.onClose} aria-label={t("common.close")} title={t("common.close")}>
            <CloseIcon />
          </button>
        </div>

        {!p.party && !p.following && (
          <div className="tv-party-start">
            <p>{t("party.overlayLead")}</p>
            <button className="tv-opt" onClick={p.onStart} data-testid="tv-party-start" {...PANEL_NAV}>
              <span>{t("party.start")}</span>
              <UsersIcon />
            </button>
          </div>
        )}

        {p.party && (
          <div className="tv-menu-cols">
            {host && (
              <div className="tv-menu-col tv-party-invite-col">
                <Invite code={p.party.code?.code} />
              </div>
            )}
            <div className="tv-menu-col tv-party-side">
              <h3>{t("party.members")}</h3>
              <Members party={p.party} nav={PANEL_NAV} {...(host ? { onRemove: p.onRemove } : {})} />
              {host && p.party.guests.length === 0 && <p className="tv-hint">{t("party.waiting")}</p>}
              <button className="tv-opt" onClick={host ? p.onEnd : p.onLeave} data-testid={host ? "tv-party-end" : "tv-party-leave"} {...PANEL_NAV}>
                <span>{host ? t("party.end") : t("party.leave")}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
