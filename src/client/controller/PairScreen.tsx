import { useState, type FormEvent, type ReactNode } from "react";
import { LanguageSwitch } from "../account/LanguageSwitch";
import { t, useT } from "../i18n";
import { Rich } from "../i18n/Rich";
import { switchRole } from "../role";
import type { SocketStatus } from "../shared/socket";
import { PlayIcon, ScanIcon, TvIcon } from "../shared/icons";
import { Logo } from "../shared/Logo";
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
  /** Top right: the way into the account page. */
  corner?: ReactNode;
}

export function PairScreen({ code, onCodeChange, onSubmit, connection, pending, error, corner }: PairScreenProps) {
  useT();
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
      {corner && <div className="pair-corner">{corner}</div>}
      <div className="brand">
        <Logo />
      </div>
      <div className="pair-icon" aria-hidden="true">
        <TvIcon />
      </div>
      <h1>{t("pair.title")}</h1>
      <p className="muted">
        <Rich k={canScan ? "pair.introScan" : "pair.introType"} parts={{ host: <b>{location.host}</b> }} />
      </p>

      {canScan && (
        <button type="button" className="btn btn-red btn-block" data-testid="scan" onClick={() => setScanning(true)} disabled={!ready}>
          <ScanIcon /> {t("pair.scan")}
        </button>
      )}
      {canScan && <p className="or">{t("pair.orType")}</p>}

      <form onSubmit={submit}>
        <input
          data-testid="code-input"
          className="code-input"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          placeholder="••••••"
          aria-label={t("pair.codeLabel")}
          value={code}
          onChange={(event) => change(event.target.value)}
        />
        <button type="submit" className={`btn btn-block ${canScan ? "" : "btn-red"}`} data-testid="connect" disabled={code.length !== 6 || !ready}>
          {pending ? (
            <>
              <span className="spinner" /> {t("tv.connecting")}
            </>
          ) : (
            t("pair.connect")
          )}
        </button>
      </form>

      {connection !== "open" && (
        <p className="muted center">
          <span className="spinner" /> {t("pair.reaching")}
        </p>
      )}
      {error && (
        <p className="error" data-testid="error" role="alert">
          {error}
        </p>
      )}

      <p className="or">{t("pair.orWatch")}</p>
      <button type="button" className="btn btn-block" data-testid="switch-to-tv" onClick={() => switchRole("tv")}>
        <PlayIcon /> {t("pair.watchHere")}
      </button>

      {scanning && <Scanner onCode={scanned} onClose={() => setScanning(false)} />}
      <LanguageSwitch />
    </main>
  );
}
