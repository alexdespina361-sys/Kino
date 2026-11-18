import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { PROFILE_NAME_MAX, type Me } from "../../shared";
import { useT } from "../i18n";
import { useBack } from "../tv/dpad";
import { useAccount } from "./AccountProvider";
import { describeError } from "./errors";
import { GoogleButton } from "./GoogleButton";
import { PasswordInput } from "./PasswordInput";
import { weakness, type Weakness } from "./password";

interface AuthFormProps {
  initialMode?: "signIn" | "signUp";
  onDone?: (me: Me) => void;
  onMode?: (mode: "signIn" | "signUp") => void;
  onWarning?: (asking: boolean) => void;
  tv?: boolean;
  autoFocus?: boolean;
}

export function AuthForm({ initialMode = "signIn", onDone, onMode, onWarning, tv = false, autoFocus = false }: AuthFormProps) {
  const t = useT();
  const account = useAccount();
  const open = account.registration === "open";
  const [mode, setMode] = useState<"signIn" | "signUp">(initialMode === "signUp" && open ? "signUp" : "signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<Weakness | null>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const id = useId();
  const signingUp = mode === "signUp";
  const nav = tv ? { "data-nav": true } : {};
  const passwordField = {
    id: `${id}-password`,
    "data-testid": "auth-password",
    autoComplete: signingUp ? "new-password" : "current-password",
    enterKeyHint: "go" as const,
    value: password,
    onChange: (event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value),
  };

  const ask = (next: Weakness | null) => {
    setWarning(next);
    onWarning?.(next !== null);
  };

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const me = await (signingUp ? account.signUp(email.trim(), password, nickname.trim() || undefined) : account.signIn(email.trim(), password));
      onDone?.(me);
    } catch (cause) {
      setError(describeError(cause));
      ask(null);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!email.trim()) return setError(t("error.invalid_email"));
    const found = signingUp ? weakness(email, password) : null;
    if (found) {
      setError(null);
      return ask(found);
    }
    await go();
  };

  const change = () => {
    refocus.current = true;
    ask(null);
  };
  useEffect(() => {
    if (warning) changeRef.current?.focus();
    else if (refocus.current) {
      refocus.current = false;
      document.getElementById(`${id}-password`)?.focus();
    }
  }, [warning]);
  useEffect(() => () => onWarning?.(false), []);
  useBack(tv && warning ? change : undefined);

  if (warning) {
    return (
      <div className={`auth-form${tv ? " auth-tv" : ""}`} data-testid="auth-warning" data-kind={warning}>
        <p className="auth-error" role="alert">
          {t(warning === "none" ? "auth.warnNone" : "auth.warnWeak")} {t("auth.warnAsk")}
        </p>
        <button type="button" ref={changeRef} className={tv ? "tv-action" : "btn btn-block"} onClick={change} data-testid="auth-change" {...nav}>
          {t("auth.changePassword")}
        </button>
        <button type="button" className={tv ? "tv-action tv-action-primary" : "btn btn-red btn-block"} disabled={busy} onClick={() => void go()} data-testid="auth-agree" {...nav}>
          {busy ? (
            <>
              <span className="spinner" /> {t("auth.working")}
            </>
          ) : (
            t("auth.agree")
          )}
        </button>
      </div>
    );
  }

  return (
    <form className={`auth-form${tv ? " auth-tv" : ""}`} onSubmit={submit} noValidate data-testid="auth-form" data-mode={mode}>
      <GoogleButton tv={tv} />
      <label className="auth-field" htmlFor={`${id}-email`}>
        <span>{t("auth.email")}</span>
        <input
          id={`${id}-email`}
          data-testid="auth-email"
          type="text"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          autoFocus={autoFocus}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          {...nav}
          {...(tv ? { "data-autofocus": true } : {})}
        />
      </label>
      <label className="auth-field" htmlFor={`${id}-password`}>
        <span>{t("auth.password")}</span>
        {tv ? <input {...passwordField} type="password" {...nav} /> : <PasswordInput {...passwordField} />}
        {signingUp && <small data-testid="auth-password-hint">{t(password ? "auth.passwordHint" : "auth.noPasswordNote")}</small>}
      </label>
      {signingUp && (
        <label className="auth-field" htmlFor={`${id}-nickname`}>
          <span>{t("auth.nickname")}</span>
          <input
            id={`${id}-nickname`}
            data-testid="auth-nickname"
            type="text"
            autoComplete="nickname"
            enterKeyHint="go"
            maxLength={PROFILE_NAME_MAX}
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            {...nav}
          />
          <small>{t("auth.nicknameHint")}</small>
        </label>
      )}

      {error && (
        <p className="auth-error" role="alert" data-testid="auth-error">
          {error}
        </p>
      )}

      <button type="submit" className={tv ? "tv-action tv-action-primary" : "btn btn-red btn-block"} disabled={busy} data-testid="auth-submit" {...nav}>
        {busy ? (
          <>
            <span className="spinner" /> {t("auth.working")}
          </>
        ) : signingUp ? (
          t("auth.signUp")
        ) : (
          t("auth.signIn")
        )}
      </button>

      {open ? (
        <button
          type="button"
          className={tv ? "tv-action" : "auth-switch"}
          onClick={() => {
            const next = signingUp ? "signIn" : "signUp";
            setMode(next);
            onMode?.(next);
            setError(null);
          }}
          data-testid="auth-switch"
          {...nav}
        >
          {signingUp ? t("auth.toSignIn") : t("auth.toSignUp")}
        </button>
      ) : (
        <p className="auth-note" data-testid="auth-closed">
          {t("auth.closed")}
        </p>
      )}
    </form>
  );
}
