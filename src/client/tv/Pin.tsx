import { useEffect, useRef, useState } from "react";
import type { ChildPinChange } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { api } from "../account/api";
import { CHILD_PIN_LENGTH, pinAnswer, pinDigits, pinProblem } from "../account/pin";
import { useT, type Key } from "../i18n";
import { BackspaceIcon, CloseIcon } from "../shared/icons";
import { BackButton, Screen } from "./Idle";
import { isEditable } from "./keys";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

interface PadProps {
  testId: string;
  title: string;
  hint?: string | undefined;
  note?: string | undefined;
  problem: string | null;
  busy: boolean;
  onPin: (pin: string) => void;
  onBack: () => void;
}

function TvPinPad({ testId, title, hint, note, problem, busy, onPin, onBack }: PadProps) {
  const t = useT();
  const [digits, setDigits] = useState("");
  const latest = useRef("");
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onPinRef = useRef(onPin);
  onPinRef.current = onPin;

  const put = (typed: string) => {
    if (busyRef.current) return;
    const kept = pinDigits(typed);
    if (kept.length === CHILD_PIN_LENGTH) {
      latest.current = "";
      setDigits("");
      onPinRef.current(kept);
      return;
    }
    latest.current = kept;
    setDigits(kept);
  };
  const putRef = useRef(put);
  putRef.current = put;
  const remove = () => put(latest.current.slice(0, -1));

  useEffect(() => {
    if (!problem) return;
    latest.current = "";
    setDigits("");
  }, [problem]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !/^[0-9]$/.test(event.key) || isEditable(event.target)) return;
      event.preventDefault();
      putRef.current(latest.current + event.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const back = () => (latest.current ? remove() : onBack());
  return (
    <Screen testId={testId} compact focus onBack={back} leaving={onBack}>
      <h1 className="tv-headline tv-headline-small">{title}</h1>
      {hint && <p className="tv-hint">{hint}</p>}
      <p className="tv-code-boxes tv-pin-boxes" data-testid="tv-pin-digits" data-count={digits.length} aria-label={t("pin.digits")} aria-live="polite">
        {Array.from({ length: CHILD_PIN_LENGTH }, (_, i) => (
          <i key={i} data-filled={i < digits.length}>
            {i < digits.length ? "•" : ""}
          </i>
        ))}
      </p>
      <p className={`tv-party-error${problem ? " is-shown" : ""}`} role="alert" data-testid="tv-pin-error">
        {problem ?? ""}
      </p>
      <div className="tv-pad" role="group" aria-label={t("pin.digits")} aria-busy={busy}>
        {DIGITS.map((digit) => (
          <button className="tv-key" key={digit} onClick={() => put(latest.current + digit)} data-testid={`pin-key-${digit}`} data-nav {...(digit === "1" ? { "data-autofocus": true } : {})}>
            {digit}
          </button>
        ))}
        <button className="tv-key" onClick={remove} aria-label={t("tv.delete")} data-testid="pin-key-delete" data-nav>
          <BackspaceIcon />
        </button>
        <button className="tv-key" onClick={() => put(latest.current + "0")} data-testid="pin-key-0" data-nav>
          0
        </button>
        <button className="tv-key" onClick={onBack} aria-label={t("common.back")} data-testid="pin-key-back" data-nav>
          <CloseIcon />
        </button>
      </div>
      {note && (
        <p className="tv-hint tv-pin-note" data-testid="tv-pin-note">
          {note}
        </p>
      )}
      <BackButton onClick={onBack} testId="tv-pin-back" />
    </Screen>
  );
}

export function TvPinAsk() {
  const t = useT();
  const { childLock } = useAccount();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async (pin: string) => {
    setBusy(true);
    setProblem(null);
    const answer = await childLock.unlock(pin);
    setBusy(false);
    if (!answer.ok) setProblem(pinProblem(answer));
  };
  return <TvPinPad testId="tv-pin-page" title={t("pin.title")} hint={t("pin.hint")} note={t("pin.forgotTv")} problem={problem} busy={busy} onPin={(pin) => void check(pin)} onBack={childLock.cancel} />;
}

type Step = "menu" | "current" | "new" | "again";

export function TvPinSetup({ onBack }: { onBack: () => void }) {
  const t = useT();
  const account = useAccount();
  const has = account.me?.account.childPin === true;
  const [mode, setMode] = useState<"set" | "change" | "remove">(has ? "change" : "set");
  const [step, setStep] = useState<Step>(has ? "menu" : "new");
  const [current, setCurrent] = useState("");
  const [first, setFirst] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (change: ChildPinChange, done: Key) => {
    setBusy(true);
    try {
      await account.changeChildPin(change);
    } catch (error) {
      setBusy(false);
      const answer = pinAnswer(error);
      setProblem(pinProblem(answer));
      if (answer.why === "wrong") {
        setCurrent("");
        setStep("current");
      }
      return;
    }
    account.say(t(done));
    onBack();
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
    void save(mode === "set" ? { next: pin } : { next: pin, pin: current }, mode === "set" ? "pin.set" : "pin.changed");
  };
  const begin = (next: "change" | "remove") => {
    setMode(next);
    setProblem(null);
    setStep("current");
  };
  const stepBack = () => {
    setProblem(null);
    if (has && step !== "menu") setStep("menu");
    else onBack();
  };

  if (step === "menu") {
    return (
      <Screen testId="tv-pin-setup" compact focus onBack={onBack}>
        <h1 className="tv-headline tv-headline-small">{t("pin.setting")}</h1>
        <p className="tv-hint tv-pin-help">{t("pin.settingHelp")}</p>
        <div className="tv-actions">
          <button className="tv-action tv-action-primary" onClick={() => begin("change")} data-nav data-autofocus data-testid="tv-pin-change">
            {t("pin.change")}
          </button>
          <button className="tv-action" onClick={() => begin("remove")} data-nav data-testid="tv-pin-remove">
            {t("pin.remove")}
          </button>
        </div>
        <p className="tv-hint tv-pin-note">{t("pin.forgotTv")}</p>
        <BackButton onClick={onBack} testId="tv-pin-setup-back" />
      </Screen>
    );
  }
  const title: Key = step === "current" ? "pin.current" : step === "new" ? "pin.new" : "pin.again";
  return (
    <TvPinPad
      key={step}
      testId="tv-pin-setup"
      title={t(title)}
      hint={step === "new" && !has ? t("pin.settingHelp") : undefined}
      note={step === "current" ? t("pin.forgotTv") : undefined}
      problem={problem}
      busy={busy}
      onPin={onPin}
      onBack={stepBack}
    />
  );
}
