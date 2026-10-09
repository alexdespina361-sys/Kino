import { formatCode } from "../shared/format";
import { CheckIcon } from "../shared/icons";
import { Logo } from "../shared/Logo";
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
    </section>
  );
}

interface IdleProps {
  paired: boolean;
  pairing: Pairing | null;
  /** The server is looking up a link the phone just sent. */
  resolving: boolean;
  /** Let go of the paired phone and show a new code. */
  onDisconnect: () => void;
}

/** Everything the TV shows while nothing is playing. */
export function TvIdle({ paired, pairing, resolving, onDisconnect }: IdleProps) {
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
        <h1 className="tv-headline" data-testid="tv-paired">
          Connected. Waiting for a video…
        </h1>
        <p className="tv-lead">Send a link from your phone to start watching.</p>
        {/* Reached with the remote's Down button (see Tv.tsx), then OK. */}
        <button className="tv-disconnect" onClick={onDisconnect} data-testid="tv-disconnect">
          Disconnect from phone
        </button>
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
