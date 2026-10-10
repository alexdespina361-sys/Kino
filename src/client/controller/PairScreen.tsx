import { useState, type FormEvent } from "react";
import type { SocketStatus } from "../shared/socket";
import { ScanIcon, TvIcon } from "../shared/icons";
import { Logo } from "../shared/Logo";
import { RoleSwitch } from "../shared/RoleSwitch";
import { cameraAvailable, Scanner } from "./Scanner";

interface PairScreenProps {
  code: string;
  onCodeChange: (code: string) => void;
  /** Send the code. Called automatically as soon as the sixth digit is in. */
  onSubmit: (code: string) => void;
  connection: SocketStatus;
  /** A code is out and the server hasn't answered yet. */
  pending: boolean;
  error: string | null;
}

export function PairScreen({ code, onCodeChange, onSubmit, connection, pending, error }: PairScreenProps) {
  const ready = connection === "open" && !pending;
  const [scanning, setScanning] = useState(false);
  const canScan = cameraAvailable();

  const change = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    onCodeChange(digits);
    if (digits.length === 6 && ready) onSubmit(digits); // nobody wants to hunt for a Connect button
  };

  const scanned = (digits: string) => {
    setScanning(false);
    onCodeChange(digits);
    if (ready) onSubmit(digits);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.length === 6 && ready) onSubmit(code);
  };

  return (
    <main className="phone pair">
      <div className="brand">
        <Logo />
      </div>
      <div className="pair-icon" aria-hidden="true">
        <TvIcon />
      </div>
      <h1>Connect to your TV</h1>
      <p className="muted">
        Open <b>{location.host}</b> on your TV and press OK. Then {canScan ? "scan the QR code it shows" : "type the 6-digit code it shows"}.
      </p>

      {canScan && (
        <button type="button" className="btn btn-red btn-block" data-testid="scan" onClick={() => setScanning(true)} disabled={!ready}>
          <ScanIcon /> Scan the TV's QR code
        </button>
      )}
      {canScan && <p className="or">or type the 6-digit code</p>}

      <form onSubmit={submit}>
        <input
          data-testid="code-input"
          className="code-input"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          placeholder="••••••"
          aria-label="6-digit code from the TV"
          value={code}
          onChange={(event) => change(event.target.value)}
        />
        <button type="submit" className={`btn btn-block ${canScan ? "" : "btn-red"}`} data-testid="connect" disabled={code.length !== 6 || !ready}>
          {pending ? (
            <>
              <span className="spinner" /> Connecting…
            </>
          ) : (
            "Connect"
          )}
        </button>
      </form>

      {connection !== "open" && (
        <p className="muted center">
          <span className="spinner" /> Reaching the server…
        </p>
      )}
      {error && (
        <p className="error" data-testid="error" role="alert">
          {error}
        </p>
      )}

      {scanning && <Scanner onCode={scanned} onClose={() => setScanning(false)} />}
      <RoleSwitch to="tv" />
    </main>
  );
}
