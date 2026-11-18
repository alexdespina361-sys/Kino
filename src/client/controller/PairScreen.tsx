import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { t, useT, LANGUAGE_NAMES, useLanguage } from "../i18n";
import { Rich } from "../i18n/Rich";
import { switchRole } from "../role";
import type { SocketStatus } from "../shared/socket";
import { PlayIcon, ScanIcon, TvIcon } from "../shared/icons";
import { Logo } from "../shared/Logo";
import { cameraAvailable, Scanner } from "./Scanner";
import { UI_LANGUAGES } from "../../shared";
import { chooseLanguage } from "../account/settings";

function LanguageSwitch() {
  const language = useLanguage();
  return (
    <div className="segmented compact" role="radiogroup" aria-label={t("settings.language")} data-testid="language-switch">
      {UI_LANGUAGES.map((code) => (
        <button key={code} type="button" role="radio" lang={code} aria-checked={language === code} onClick={() => chooseLanguage(code)} data-testid={`switch-lang-${code}`}>
          {LANGUAGE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}

interface PairScreenProps {
  code: string;
  onCodeChange: (code: string) => void;
  onSubmit: (code: string) => void;
  connection: SocketStatus;
  pending: boolean;
  error: string | null;
  notice?: string | null;
  tvCount?: number;
  onTvs?: () => void;
  corner?: ReactNode;
}

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
  useEffect(() => {
    if (error && code === "") input.current?.focus();
  }, [error, code]);

  const change = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    onCodeChange(digits);
    if (digits.length === 6 && ready) onSubmit(digits);
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
          <p className="muted center" role="status">
            <span className="spinner" /> {offline ? t("error.offline") : t("pair.reaching")}
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
