import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LanguageSwitch } from "../account/LanguageSwitch";
import { t, useT } from "../i18n";
import { Rich } from "../i18n/Rich";
import { switchRole } from "../role";
import type { SocketStatus } from "../shared/socket";
import { PlayIcon, ScanIcon, TvIcon } from "../shared/icons";
import { Logo } from "../shared/Logo";
import { useWaking } from "../shared/useSlow";
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
  /** Something to know before trying again (the TV that was connected is gone). */
  notice?: string | null;
  /** How many TVs this phone still has on its list, and the way to them: choosing one of those takes no code. */
  tvCount?: number;
  onTvs?: () => void;
  /** Top right: the way into the account page. */
  corner?: ReactNode;
}

/** A connection that has not come in this long is said to be missing, not just "reaching". */
const OFFLINE_AFTER_MS = 4000;

export function PairScreen({ code, onCodeChange, onSubmit, connection, pending, error, notice, tvCount = 0, onTvs, corner }: PairScreenProps) {
  useT();
  const ready = connection === "open" && !pending;
  const [scanning, setScanning] = useState(false);
  const canScan = cameraAvailable();
  const input = useRef<HTMLInputElement>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (connection === "open") return setOffline(false);
    const timer = setTimeout(() => setOffline(true), OFFLINE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [connection]);
  const waking = useWaking(connection);
  // A code that was refused leaves an empty field: the keyboard stays up for the next try.
  useEffect(() => {
    if (error && code === "") input.current?.focus();
  }, [error, code]);

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
    <main className="phone pair phone-ui">
      <div className="pair-top">
        <div className="brand">
          <Logo />
        </div>
        {corner && <div className="pair-corner">{corner}</div>}
      </div>
      <div className="pair-icon" aria-hidden="true">
        <TvIcon />
      </div>
      <div className="pair-copy">
        <h1>{t("pair.title")}</h1>
        {notice && (
          <p className="banner" data-testid="pair-notice" role="status">
            {notice}
          </p>
        )}
        {/* A phone that has TVs has done this before: the way to them takes the place of the steps for a new one (the list has them too). */}
        {tvCount > 0 && onTvs ? (
          <button type="button" className="btn btn-block" data-testid="tvs-open" onClick={onTvs}>
            <TvIcon /> {tvCount > 1 ? t("menu.tvsCount", { count: tvCount }) : t("menu.tvs")}
          </button>
        ) : (
          <p className="muted">
            <Rich k={canScan ? "pair.introScan" : "pair.introType"} parts={{ host: <b>{location.host}</b>, connect: <b>{t("tv.connectPhone")}</b> }} />
          </p>
        )}
      </div>

      <div className="pair-actions">
        {canScan && (
          <button type="button" className="btn btn-red btn-block" data-testid="scan" onClick={() => setScanning(true)} disabled={!ready}>
            <ScanIcon /> {t("pair.scan")}
          </button>
        )}
        {canScan && <p className="or">{t("pair.orType")}</p>}

        <form onSubmit={submit}>
          <input
            ref={input}
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
          <p className="muted center" data-testid={waking ? "server-waking" : undefined} role="status">
            <span className="spinner" /> {waking ? t("server.waking") : offline ? t("error.offline") : t("pair.reaching")}
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
      </div>

      {scanning && <Scanner onCode={scanned} onClose={() => setScanning(false)} />}
      <LanguageSwitch />
    </main>
  );
}
