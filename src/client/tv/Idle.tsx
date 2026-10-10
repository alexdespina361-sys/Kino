import { formatCode } from "../shared/format";
import { CheckIcon } from "../shared/icons";
import { Logo } from "../shared/Logo";
import { RoleSwitch } from "../shared/RoleSwitch";
import { QrCode } from "../shared/QrCode";

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

/** Before the first OK press the browser will not let a page play video, so the TV asks for one. */
export function TvLocked({ onUnlock }: { onUnlock: () => void }) {
  return (
    <section className="tv-screen">
      <Brand />
      <h1 className="tv-headline">Ready when you are</h1>
      <button className="tv-ok" autoFocus onClick={onUnlock} data-testid="unlock">
        Press OK to enable playback
      </button>
      <RoleSwitch to="remote" />
    </section>
  );
}

interface IdleProps {
  paired: boolean;
  /** The name of the TV this one watches along with, if it does. */
  following: string | null;
  pairing: Pairing | null;
  /** The server is looking up a link the phone just sent. */
  resolving: boolean;
  /** Let go of the paired phone and show a new code. */
  onDisconnect: () => void;
  /** Open TV library browse screen. */
  onBrowse?: () => void;
}

/** Everything the TV shows while nothing is playing. */
export function TvIdle({ paired, following, pairing, resolving, onDisconnect, onBrowse }: IdleProps) {
  if (resolving) {
    return (
      <section className="tv-screen" data-testid="tv-resolving">
        <Brand />
        <div className="spinner tv-spinner" />
        <h1 className="tv-headline">Finding your video…</h1>
      </section>
    );
  }

  if (paired) {
    return (
      <section className="tv-screen">
        <Brand />
        <span className="tv-ready-icon">
          <CheckIcon />
        </span>
        <h1 className="tv-headline" data-testid={following ? "tv-following" : "tv-paired"}>
          {following ? `Watching along with ${following}` : "Connected. Waiting for a video…"}
        </h1>
        <p className="tv-lead">{following ? "It starts here when it starts there." : "Send a link from your phone or browse titles directly."}</p>
        <div style={{ display: "flex", gap: "1em", alignItems: "center" }}>
          {onBrowse && (
            <button className="tv-btn tv-btn-red" onClick={onBrowse} data-testid="tv-browse-open">
              Browse Library
            </button>
          )}
          <button className="tv-disconnect" onClick={onDisconnect} data-testid="tv-disconnect">
            {following ? "Stop watching along" : "Disconnect from phone"}
          </button>
        </div>
      </section>
    );
  }

  if (pairing) {
    // The QR code opens the phone page with the code filled in, so pairing needs no typing at all.
    const link = `${location.origin}/?code=${pairing.code}`;
    return (
      <section className="tv-screen">
        <Brand />
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
        {onBrowse && (
          <button className="tv-btn tv-btn-red" onClick={onBrowse} data-testid="tv-browse-open" style={{ marginTop: "1em" }}>
            Browse Library
          </button>
        )}
        <RoleSwitch to="remote" />
      </section>
    );
  }

  return (
    <section className="tv-screen">
      <Brand />
      <div className="spinner tv-spinner" />
      <h1 className="tv-headline">Connecting…</h1>
    </section>
  );
}
