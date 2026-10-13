import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { Me } from "../../shared";
import { useT } from "../i18n";
import { useBack } from "../tv/dpad";
import { useAccount } from "./AccountProvider";
import { describeError } from "./errors";
import { PasswordInput } from "./PasswordInput";
import { weakness, type Weakness } from "./password";

interface AuthFormProps {
  initialMode?: "signIn" | "signUp";
  /** Called once somebody is signed in (or signed up). */
  onDone?: (me: Me) => void;
  /** Called when the form turns from signing in to making an account, or back, so the page around it can say which. */
  onMode?: (mode: "signIn" | "signUp") => void;
  /** Called when the question that comes before an account with a poor password is made turns on or off: while it is on, Back is the form's (a TV page around it leaves Back to it). */
  onWarning?: (asking: boolean) => void;
  /** On the TV every control is reached with the remote's arrow keys (`data-nav`), and none is focused until one is pressed. */
  tv?: boolean;
  autoFocus?: boolean;
}

/**
 * A name and a password (anything at all, even none), to sign in or to make an account. The same form on the phone and, as a fallback to the QR code, on the TV.
 * An account is not made with a poor password (none, or one that is quick to guess) until it is said what that means, and the person agrees.
 */
export function AuthForm({ initialMode = "signIn", onDone, onMode, onWarning, tv = false, autoFocus = false }: AuthFormProps) {
  const t = useT();
  const account = useAccount();
  const open = account.registration === "open";
  const [mode, setMode] = useState<"signIn" | "signUp">(initialMode === "signUp" && open ? "signUp" : "signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  /** The form, or the question that comes before an account with a poor password. The page around it is told in the same update, so Back is never both's. */
  const ask = (next: Weakness | null) => {
    setWarning(next);
    onWarning?.(next !== null);
  };

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const me = await (signingUp ? account.signUp(email.trim(), password) : account.signIn(email.trim(), password));
      onDone?.(me);
    } catch (cause) {
      setError(describeError(cause));
      ask(null); // (the form again, with what went wrong)
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

  /** Back to the form from the question, with the remote on the password. */
  const change = () => {
    refocus.current = true;
    ask(null);
  };
  // The question is a page of its own in the form's place: the remote lands on the safe button, and Back (on a TV) is "change it".
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
        />
      </label>
      <label className="auth-field" htmlFor={`${id}-password`}>
        <span>{t("auth.password")}</span>
        {tv ? <input {...passwordField} type="password" {...nav} /> : <PasswordInput {...passwordField} />}
        {signingUp && <small data-testid="auth-password-hint">{t(password ? "auth.passwordHint" : "auth.noPasswordNote")}</small>}
      </label>

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
