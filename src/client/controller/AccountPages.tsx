import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ACCENTS, preferredLanguages, UI_LANGUAGES, type SessionInfo } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { api } from "../account/api";
import { describeError } from "../account/errors";
import { chooseAccent, chooseLanguage, useSettings } from "../account/settings";
import { ACCENT_SWATCH } from "../account/theme";
import { ago } from "../account/time";
import { LANGUAGE_NAMES, useLanguage, useT } from "../i18n";
import { CheckIcon, CloseIcon, GlobeIcon, PhoneIcon, PlusIcon, ScanIcon, TrashIcon, TvIcon } from "../shared/icons";
import { linkCodeOf, typedLinkCode } from "../shared/launch";
import { linkFromScan } from "./scan";
import { cameraAvailable, Scanner } from "./Scanner";

/** A labelled group of settings. */
export function Group({ title, help, children }: { title: string; help?: string | undefined; children: ReactNode }) {
  return (
    <section className="group">
      <h3>{title}</h3>
      {help && <p className="muted small">{help}</p>}
      {children}
    </section>
  );
}

/** An on/off setting. */
export function Switch({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (checked: boolean) => void; testId?: string }) {
  return (
    <button className="switch-row" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} data-testid={testId}>
      <span>{label}</span>
      <span className="switch" aria-hidden="true" />
    </button>
  );
}

/* ------------------------------ settings ------------------------------ */

/** Subtitle languages people choose from, besides the ones the site is written in. */
const COMMON_LANGUAGES = ["en", "ro", "it", "es", "fr", "de", "pt", "hu", "bg", "el", "tr", "pl", "nl", "ru", "uk", "ar", "he", "sv", "cs", "hr", "sr", "sq", "hi", "zh", "ja", "ko"];

/** The languages of subtitles this profile cares about: listed first in the subtitle menus, in this order. */
function SubtitleLanguages() {
  const t = useT();
  const language = useLanguage();
  const { settings, set } = useSettings();
  const account = useAccount();
  const chosen = settings.subtitleLanguages ?? [];
  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([language], { type: "language" });
    } catch {
      return undefined;
    }
  }, [language]);
  const name = (code: string) => names?.of(code) ?? code.toUpperCase();
  const save = (list: string[]) => set("subtitleLanguages", list.length > 0 ? list : undefined);
  const move = (index: number, by: number) => {
    const list = [...chosen];
    const [item] = list.splice(index, 1);
    list.splice(index + by, 0, item!);
    save(list);
  };

  return (
    <Group title={t("settings.subtitleLanguages")} help={t("settings.subtitleLanguagesHelp")}>
      {chosen.length === 0 ? (
        <p className="muted small" data-testid="subtitle-defaults">
          {t("settings.subtitleDefaults", { languages: preferredLanguages(undefined, language).map(name).join(", ") })}
        </p>
      ) : (
        <ol className="language-list" data-testid="subtitle-languages">
          {chosen.map((code, index) => (
            <li key={code}>
              <span className="language-rank">{index + 1}</span>
              <span className="language-name">{name(code)}</span>
              <button className="mini" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`${t("settings.moveUp")}: ${name(code)}`}>
                ▲
              </button>
              <button className="mini" disabled={index === chosen.length - 1} onClick={() => move(index, 1)} aria-label={`${t("settings.moveDown")}: ${name(code)}`}>
                ▼
              </button>
              <button className="mini" onClick={() => save(chosen.filter((other) => other !== code))} aria-label={`${t("settings.removeLanguage")}: ${name(code)}`}>
                <CloseIcon />
              </button>
            </li>
          ))}
        </ol>
      )}
      {chosen.length < 12 && (
        <div className="language-add" role="group" aria-label={t("settings.addLanguage")}>
          {COMMON_LANGUAGES.filter((code) => !chosen.includes(code)).map((code) => (
            <button key={code} className="chip-pill" onClick={() => save([...chosen, code])} data-testid={`add-language-${code}`}>
              <PlusIcon /> {name(code)}
            </button>
          ))}
        </div>
      )}
      <Switch label={t("settings.onlySubtitleLanguages")} checked={settings.onlySubtitleLanguages ?? false} onChange={(on) => set("onlySubtitleLanguages", on ? true : undefined)} testId="only-languages" />
      {account.me === null && <p className="muted small">{t("settings.signInToSave")}</p>}
    </Group>
  );
}

/** What changes how the site looks and plays: language, colour, autoplay, subtitle languages. */
export function SettingsPage() {
  const t = useT();
  const language = useLanguage();
  const { settings, set } = useSettings();
  const account = useAccount();
  return (
    <div className="page-stack" data-testid="settings-page">
      <Group title={t("settings.language")}>
        <div className="segmented" role="radiogroup" aria-label={t("settings.language")}>
          {UI_LANGUAGES.map((code) => (
            <button key={code} role="radio" aria-checked={language === code} onClick={() => chooseLanguage(code)} data-testid={`lang-${code}`}>
              {LANGUAGE_NAMES[code]}
            </button>
          ))}
        </div>
      </Group>
      <Group title={t("settings.accent")}>
        <div className="swatches" role="radiogroup" aria-label={t("settings.accent")}>
          {ACCENTS.map((accent) => (
            <button
              key={accent}
              role="radio"
              aria-checked={(settings.accent ?? ACCENTS[0]) === accent}
              aria-label={t(`accent.${accent}`)}
              className="swatch"
              style={{ background: ACCENT_SWATCH[accent] }}
              onClick={() => chooseAccent(accent)}
              data-testid={`accent-${accent}`}
            >
              <CheckIcon />
            </button>
          ))}
        </div>
      </Group>
      <Group title={t("settings.playback")}>
        <Switch label={t("settings.autoplayNext")} checked={settings.autoplayNext ?? true} onChange={(on) => set("autoplayNext", on)} testId="autoplay-next" />
      </Group>
      <SubtitleLanguages />
      {account.me === null && <p className="muted small">{t("settings.signInToSave")}</p>}
    </div>
  );
}

/* ------------------------------ devices ------------------------------ */

const KIND_ICON = { tv: TvIcon, remote: PhoneIcon, browser: GlobeIcon } as const;

/** Where this account is signed in, with a way to sign any of them out (a TV left at a friend's, a lost phone). */
export function DevicesPage() {
  const t = useT();
  const language = useLanguage();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = () =>
    api
      .sessions()
      .then(setSessions)
      .catch((cause: unknown) => setProblem(describeError(cause)));
  useEffect(() => void load(), []);

  const end = async (id: string) => {
    try {
      await api.endSession(id);
      setSessions((list) => list?.filter((session) => session.id !== id) ?? null);
    } catch (cause) {
      setProblem(describeError(cause));
    }
  };
  const endOthers = async () => {
    try {
      await api.endOtherSessions();
      setNote(t("account.signedOutOthers"));
      await load();
    } catch (cause) {
      setProblem(describeError(cause));
    }
  };

  return (
    <div className="page-stack" data-testid="devices-page">
      <p className="muted">{t("account.devicesHelp")}</p>
      {sessions === null && !problem && (
        <p className="muted">
          <span className="spinner" /> {t("common.loading")}
        </p>
      )}
      <ul className="device-list">
        {sessions?.map((session) => {
          const Icon = KIND_ICON[session.kind];
          return (
            <li key={session.id} data-testid="device" data-current={session.current}>
              <span className="device-icon">
                <Icon />
              </span>
              <span className="device-text">
                <b>{session.label || t(`device.${session.kind}`)}</b>
                <small>{session.current ? t("account.thisDevice") : t("account.active", { when: ago(session.lastSeenAt, Date.now(), language) })}</small>
              </span>
              {!session.current && (
                <button className="mini" onClick={() => void end(session.id)} data-testid="device-signout">
                  {t("account.signOutDevice")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {sessions && sessions.length > 1 && (
        <button className="btn btn-block" onClick={() => void endOthers()} data-testid="signout-others">
          {t("account.signOutOthers")}
        </button>
      )}
      {note && (
        <p className="muted" role="status">
          {note}
        </p>
      )}
      {problem && (
        <p className="auth-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/* ------------------------------ password and deleting ------------------------------ */

/** A password field with its label. */
function Password({ label, value, onChange, autoComplete, testId }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string; testId: string }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <input type="password" autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} />
    </label>
  );
}

export function SecurityPage({ onDeleted }: { onDeleted: () => void }) {
  const t = useT();
  const account = useAccount();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [changed, setChanged] = useState(false);
  const [changeProblem, setChangeProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteProblem, setDeleteProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setChangeProblem(null);
    setChanged(false);
    try {
      await api.changePassword(current, next);
      setChanged(true);
      setCurrent("");
      setNext("");
    } catch (cause) {
      setChangeProblem(describeError(cause));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setDeleteProblem(null);
    try {
      await api.deleteAccount(confirm);
      await account.signOut();
      onDeleted();
    } catch (cause) {
      setDeleteProblem(describeError(cause));
      setBusy(false);
    }
  };

  return (
    <div className="page-stack" data-testid="security-page">
      <form className="auth-form" onSubmit={change} noValidate>
        <Group title={t("account.password")}>
          <Password label={t("account.currentPassword")} value={current} onChange={setCurrent} autoComplete="current-password" testId="password-current" />
          <Password label={t("auth.newPassword")} value={next} onChange={setNext} autoComplete="new-password" testId="password-new" />
          <small className="muted">{t("auth.passwordHint")}</small>
        </Group>
        {changeProblem && (
          <p className="auth-error" role="alert" data-testid="password-error">
            {changeProblem}
          </p>
        )}
        {changed && (
          <p className="auth-ok" role="status" data-testid="password-changed">
            <CheckIcon /> {t("account.passwordChanged")}
          </p>
        )}
        <button type="submit" className="btn btn-block" disabled={busy || !current || !next} data-testid="password-save">
          {t("common.save")}
        </button>
      </form>

      <Group title={t("account.delete")}>
        {deleting ? (
          <form className="auth-form" onSubmit={remove} noValidate>
            <p className="muted">{t("account.deleteWarn")}</p>
            <Password label={t("auth.password")} value={confirm} onChange={setConfirm} autoComplete="current-password" testId="delete-password" />
            {deleteProblem && (
              <p className="auth-error" role="alert" data-testid="delete-error">
                {deleteProblem}
              </p>
            )}
            <div className="editor-actions">
              <button type="submit" className="btn btn-danger" disabled={busy || !confirm} data-testid="delete-confirm">
                <TrashIcon /> {t("account.deleteConfirm")}
              </button>
              <button type="button" className="btn" onClick={() => setDeleting(false)}>
                {t("common.cancel")}
              </button>
            </div>
          </form>
        ) : (
          <button className="btn btn-danger btn-block" onClick={() => setDeleting(true)} data-testid="delete-account">
            <TrashIcon /> {t("account.delete")}
          </button>
        )}
      </Group>
    </div>
  );
}

/* ------------------------------ signing a TV in ------------------------------ */

/** Where a TV's sign-in code comes from: the camera, or typing what the TV shows. */
export function LinkPage({ onCode }: { onCode: (code: string) => void }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [scanning, setScanning] = useState(false);
  const canScan = cameraAvailable();
  const code = linkCodeOf(typed);

  const change = (value: string) => {
    const shown = typedLinkCode(value);
    setTyped(shown);
    const complete = linkCodeOf(shown);
    if (complete) onCode(complete);
  };

  return (
    <div className="page-stack" data-testid="link-page">
      <p className="muted">{t("account.signInTvHelp")}</p>
      {canScan && (
        <button className="btn btn-red btn-block" onClick={() => setScanning(true)} data-testid="link-scan">
          <ScanIcon /> {t("link.scan")}
        </button>
      )}
      {canScan && <p className="or">{t("link.codeOr")}</p>}
      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (code) onCode(code);
        }}
      >
        <label className="auth-field">
          <span>{t("link.enterCode")}</span>
          <input
            className="code-input link-code-input"
            data-testid="link-code-input"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={9}
            placeholder="ABCD-2345"
            value={typed}
            onChange={(event) => change(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-block" disabled={!code} data-testid="link-code-go">
          {t("common.continue")}
        </button>
      </form>
      {scanning && (
        <Scanner
          read={linkFromScan}
          onCode={(scanned) => {
            setScanning(false);
            onCode(scanned);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
