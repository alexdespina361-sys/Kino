import { useRef, type ReactNode } from "react";
import { formatCode } from "../shared/format";
import { CheckIcon } from "../shared/icons";
import { Logo } from "../shared/Logo";
import { RoleSwitch } from "../shared/RoleSwitch";
import { QrCode } from "../shared/QrCode";
import { useDpad } from "./dpad";

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

/** A full-screen page the remote can walk around: its `[data-nav]` buttons are reached with the arrow keys. */
function Screen({ children, testId }: { children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLElement>(null);
  useDpad(ref);
  return (
    <section className="tv-screen" ref={ref} data-testid={testId}>
      <Brand />
      {children}
    </section>
  );
}

/** Before the first OK press the browser will not let a page play video, so the TV asks for one. */
export function TvLocked({ onUnlock }: { onUnlock: () => void }) {
  return (
    <Screen>
      <h1 className="tv-headline">Ready when you are</h1>
      <button className="tv-ok" autoFocus onClick={onUnlock} data-testid="unlock" data-nav>
        Press OK to enable playback
      </button>
      <RoleSwitch to="remote" />
    </Screen>
  );
}

interface IdleProps {
  paired: boolean;
  /** The name of the TV this one watches along with, if it does. */
  following: string | null;
  pairing: Pairing | null;
  /** The server is looking up a link that was just chosen. */
  resolving: boolean;
  /** Let go of the paired phone and show a new code. */
  onDisconnect: () => void;
  /** Open the library. Absent when this TV can't choose what plays (it watches along). */
  onBrowse?: () => void;
  /** Said once when the title that was just chosen could not be played. */
  notice?: string | null;
}

/** Everything the TV shows while nothing is playing. */
export function TvIdle({ paired, following, pairing, resolving, onDisconnect, onBrowse, notice }: IdleProps) {
  const browse = onBrowse && (
    <button className="tv-action tv-action-primary" onClick={onBrowse} data-testid="tv-browse-open" data-nav>
      Browse library
    </button>
  );
  const alert = notice && (
    <p className="tv-notice" role="alert" data-testid="tv-notice">
      {notice}
    </p>
  );

  if (resolving) {
    return (
      <Screen testId="tv-resolving">
        <div className="spinner tv-spinner" />
        <h1 className="tv-headline">Finding your video…</h1>
      </Screen>
    );
  }

  if (paired) {
    return (
      <Screen>
        <span className="tv-ready-icon">
          <CheckIcon />
        </span>
        <h1 className="tv-headline" data-testid={following ? "tv-following" : "tv-paired"}>
          {following ? `Watching along with ${following}` : "Connected. Waiting for a video…"}
        </h1>
        <p className="tv-lead">{following ? "It starts here when it starts there." : "Send a link from your phone, or pick a title here."}</p>
        {alert}
        {/* Reached with the remote's arrow keys; the first press only lands on a button, it never presses one. */}
        <div className="tv-actions">
          {browse}
          <button className="tv-action" onClick={onDisconnect} data-testid="tv-disconnect" data-nav>
            {following ? "Stop watching along" : "Disconnect from phone"}
          </button>
        </div>
      </Screen>
    );
  }

  if (pairing) {
    // The QR code opens the phone page with the code filled in, so pairing needs no typing at all.
    const link = `${location.origin}/?code=${pairing.code}`;
    return (
      <Screen>
        <div className="tv-pair">
          <ol className="tv-steps">
            <li>
              <span className="tv-step-no">1</span>
              <span>
                On your phone, open <b>{location.host}</b>
              </span>
            </li>
            <li>
              <span className="tv-step-no">2</span>
              <span>Enter this code</span>
            </li>
            <li className="tv-code-row">
              <p className="tv-code" data-testid="pairing-code">
                {formatCode(pairing.code)}
              </p>
            </li>
          </ol>
          <div className="tv-qr">
            <QrCode value={link} label="Scan with your phone's camera to connect" />
            <p>Or scan this with your camera</p>
          </div>
        </div>
        {alert}
        {browse && <div className="tv-actions">{browse}</div>}
        <RoleSwitch to="remote" />
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="spinner tv-spinner" />
      <h1 className="tv-headline">Connecting…</h1>
    </Screen>
  );
}
