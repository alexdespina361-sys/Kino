import { useId, useState, type FormEvent } from "react";
import type { Me } from "../../shared";
import { useT } from "../i18n";
import { useAccount } from "./AccountProvider";
import { describeError } from "./errors";

interface AuthFormProps {
  initialMode?: "signIn" | "signUp";
  /** Called once somebody is signed in (or signed up). */
  onDone?: (me: Me) => void;
  /** On the TV every control is reached with the remote's arrow keys (`data-nav`), and none is focused until one is pressed. */
  tv?: boolean;
  autoFocus?: boolean;
}

/** Email and password, to sign in or to make an account. The same form on the phone and, as a fallback to the QR code, on the TV. */
export function AuthForm({ initialMode = "signIn", onDone, tv = false, autoFocus = false }: AuthFormProps) {
  const t = useT();
  const account = useAccount();
  const open = account.registration === "open";
  const [mode, setMode] = useState<"signIn" | "signUp">(initialMode === "signUp" && open ? "signUp" : "signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const signingUp = mode === "signUp";
  const nav = tv ? { "data-nav": true } : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) return setError(t(email.trim() ? "error.weak_password" : "error.invalid_email"));
    setBusy(true);
    setError(null);
    try {
      const me = await (signingUp ? account.signUp(email.trim(), password) : account.signIn(email.trim(), password));
      onDone?.(me);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`auth-form${tv ? " auth-tv" : ""}`} onSubmit={submit} noValidate data-testid="auth-form" data-mode={mode}>
      <label className="auth-field" htmlFor={`${id}-email`}>
        <span>{t("auth.email")}</span>
        <input
          id={`${id}-email`}
          data-testid="auth-email"
          type="email"
          inputMode="email"
          autoComplete="email"
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
        <input
          id={`${id}-password`}
          data-testid="auth-password"
          type="password"
          autoComplete={signingUp ? "new-password" : "current-password"}
          enterKeyHint="go"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          {...nav}
        />
        {signingUp && <small>{t("auth.passwordHint")}</small>}
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
            setMode(signingUp ? "signIn" : "signUp");
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
