import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChildPinChange } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { api } from "../account/api";
import { GoogleMark } from "../account/GoogleButton";
import { PasswordInput } from "../account/PasswordInput";
import { CHILD_PIN_LENGTH, pinAnswer, pinDigits, pinProblem } from "../account/pin";
import { useT, type Key } from "../i18n";
import { CheckIcon, LockIcon } from "../shared/icons";

/** Four digits, as dots; the fourth sends them. Kept on the field while the server answers (read-only, not disabled: the keyboard stays up for another try). */
function PinField({ label, busy, onPin, testId, problem }: { label: string; busy: boolean; onPin: (pin: string) => void; testId: string; problem: string | null }) {
  const [value, setValue] = useState("");
  const field = useRef<HTMLInputElement>(null);
  // (A wrong one starts over, with the keyboard still up.)
  useEffect(() => {
    if (problem) field.current?.focus({ preventScroll: true });
  }, [problem]);
  return (
    <label className="auth-field pin-field">
      <span>{label}</span>
      {/* (Text with its digits drawn as dots, not a password field: a browser would offer to keep the four digits as the site's password.) */}
      <input
        ref={field}
        type="text"
        className="pin-masked"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={CHILD_PIN_LENGTH}
        autoFocus
        readOnly={busy}
        value={value}
        onChange={(event) => {
          const kept = pinDigits(event.target.value);
          if (kept.length < CHILD_PIN_LENGTH) return setValue(kept);
          setValue("");
          onPin(kept);
        }}
        data-testid={testId}
      />
    </label>
  );
}

/**
 * Asked before a child's profile is left (see `ChildLock`), in place of the page that was opened: the right PIN does what was waiting, Cancel drops it. A PIN forgotten is
 * taken off with the account's password (an account made with Google confirms with Google), and what was waiting is done.
 */
export function PinAsk() {
  const t = useT();
  const account = useAccount();
  const lock = account.childLock;
  const googleOnly = account.me?.account.googleOnly === true;
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [password, setPassword] = useState("");

  const check = async (pin: string) => {
    setBusy(true);
    setProblem(null);
    const answer = await lock.unlock(pin);
    setBusy(false);
    if (!answer.ok) setProblem(pinProblem(answer));
  };
  const takeOff = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const answer = await lock.forgot(password);
    setBusy(false);
    if (!answer.ok) setProblem(pinProblem(answer, t("error.wrong_password")));
  };

  return (
    <div className="page-stack pin-page" data-testid="pin-ask">
      <p className="pin-lead">
        <LockIcon /> <span>{t("pin.hint")}</span>
      </p>
      {!forgot ? (
        <>
          <PinField label={t("pin.digits")} busy={busy} onPin={(pin) => void check(pin)} problem={problem} testId="pin-input" />
          {problem && (
            <p className="auth-error" role="alert" data-testid="pin-error">
              {problem}
            </p>
          )}
          <button
            type="button"
            className="auth-switch"
            onClick={() => {
              setForgot(true);
              setProblem(null);
            }}
            data-testid="pin-forgot"
          >
            {t("pin.forgot")}
          </button>
        </>
      ) : googleOnly ? (
        <section className="group">
          <p className="muted small">{t("pin.googleHelp")}</p>
          <button type="button" className="google-btn" onClick={() => account.withGoogle("pin")} data-testid="pin-google">
            <GoogleMark />
            <span>{t("pin.googleConfirm")}</span>
          </button>
        </section>
      ) : (
        <form className="auth-form" onSubmit={(event) => void takeOff(event)} noValidate>
          <p className="muted small">{t("pin.forgotHelp")}</p>
          <label className="auth-field">
            <span>{t("pin.password")}</span>
            <PasswordInput autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus data-testid="pin-password" />
          </label>
          {problem && (
            <p className="auth-error" role="alert" data-testid="pin-error">
              {problem}
            </p>
          )}
          <button type="submit" className="btn btn-block" disabled={busy || password === ""} data-testid="pin-remove-password">
            {t("pin.removeWithPassword")}
          </button>
        </form>
      )}
      <button type="button" className="btn btn-block" onClick={lock.cancel} data-testid="pin-cancel">
        {t("common.cancel")}
      </button>
    </div>
  );
}

type Mode = "set" | "change" | "remove";
type Step = "current" | "password" | "new" | "again";

/**
 * The PIN in the settings (the account's, so on any of its profiles): set one (twice, the same), or change it or take it off with the one there is now, or with the
 * account's password when it was forgotten (an account made with Google takes it off by confirming with Google).
 */
export function PinSetting() {
  const t = useT();
  const account = useAccount();
  const has = account.me?.account.childPin === true;
  const googleOnly = account.me?.account.googleOnly === true;
  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState<Step>("new");
  const [current, setCurrent] = useState("");
  const [first, setFirst] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  if (!account.me) return null;

  const reset = () => {
    setMode(null);
    setProblem(null);
    setCurrent("");
    setFirst("");
    setPassword("");
  };
  const start = (next: Mode) => {
    reset();
    setSaid(null);
    setMode(next);
    setStep(next === "set" ? "new" : "current");
  };
  /** The proof that it is the grown-up: the PIN there is, or the password. */
  const proof = (): Pick<ChildPinChange, "pin" | "password"> => (password ? { password } : current ? { pin: current } : {});
  const save = async (change: ChildPinChange, done: Key) => {
    setBusy(true);
    try {
      await account.changeChildPin(change);
    } catch (error) {
      setBusy(false);
      const answer = pinAnswer(error);
      const byPassword = change.password !== undefined;
      setProblem(pinProblem(answer, byPassword ? t("error.wrong_password") : undefined));
      if (answer.why === "wrong") {
        setCurrent("");
        setStep(byPassword ? "password" : "current");
      }
      return;
    }
    setBusy(false);
    reset();
    setSaid(t(done));
  };
  const checkCurrent = async (pin: string) => {
    setBusy(true);
    try {
      await api.checkChildPin(pin);
    } catch (error) {
      setBusy(false);
      return setProblem(pinProblem(pinAnswer(error)));
    }
    setBusy(false);
    setCurrent(pin);
    setStep("new");
  };
  const onPin = (pin: string) => {
    setProblem(null);
    if (step === "current") return void (mode === "remove" ? save({ next: null, pin }, "pin.gone") : checkCurrent(pin));
    if (step === "new") {
      setFirst(pin);
      return setStep("again");
    }
    if (pin !== first) {
      setFirst("");
      setProblem(t("pin.mismatch"));
      return setStep("new");
    }
    void save({ next: pin, ...proof() }, mode === "set" ? "pin.set" : "pin.changed");
  };
  const withPassword = (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    if (mode === "remove") return void save({ next: null, password }, "pin.gone");
    setStep("new"); // (the password is checked with the new PIN)
  };

  const label: Key = step === "current" ? "pin.current" : step === "new" ? "pin.new" : "pin.again";
  return (
    <section className="group" data-testid="pin-setting">
      <h3>{t("pin.setting")}</h3>
      <p className="muted small">{t("pin.settingHelp")}</p>
      {said && (
        <p className="auth-ok" role="status" data-testid="pin-done">
          <CheckIcon /> {said}
        </p>
      )}
      {mode === null ? (
        has ? (
          <div className="editor-actions">
            <button type="button" className="btn" onClick={() => start("change")} data-testid="pin-change">
              {t("pin.change")}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => start("remove")} data-testid="pin-remove">
              {t("pin.remove")}
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-block" onClick={() => start("set")} data-testid="pin-add">
            <LockIcon /> {t("pin.add")}
          </button>
        )
      ) : step === "password" ? (
        <form className="auth-form" onSubmit={withPassword} noValidate>
          <label className="auth-field">
            <span>{t("pin.password")}</span>
            <PasswordInput autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus data-testid="pin-setting-password" />
          </label>
          {problem && (
            <p className="auth-error" role="alert" data-testid="pin-setting-error">
              {problem}
            </p>
          )}
          <div className="editor-actions">
            <button type="submit" className={mode === "remove" ? "btn btn-danger" : "btn"} disabled={busy || password === ""} data-testid="pin-setting-password-go">
              {t(mode === "remove" ? "pin.remove" : "common.continue")}
            </button>
            <button type="button" className="btn" onClick={reset}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="auth-form">
          <PinField key={step} label={t(label)} busy={busy} onPin={onPin} problem={problem} testId="pin-setting-input" />
          {problem && (
            <p className="auth-error" role="alert" data-testid="pin-setting-error">
              {problem}
            </p>
          )}
          {step === "current" &&
            (googleOnly ? (
              <>
                <p className="muted small">{t("pin.googleHelp")}</p>
                <button type="button" className="google-btn" onClick={() => account.withGoogle("pin")} data-testid="pin-setting-google">
                  <GoogleMark />
                  <span>{t("pin.googleConfirm")}</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="auth-switch"
                onClick={() => {
                  setProblem(null);
                  setStep("password");
                }}
                data-testid="pin-use-password"
              >
                {t("pin.usePassword")}
              </button>
            ))}
          <button type="button" className="btn btn-block" onClick={reset} data-testid="pin-setting-cancel">
            {t("common.cancel")}
          </button>
        </div>
      )}
    </section>
  );
}
