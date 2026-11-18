import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ACCENTS, LINK_TTL_MS, MAX_PROFILES, preferredLanguages, UI_LANGUAGES, type Profile } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { api, ApiError } from "../account/api";
import { AuthForm } from "../account/AuthForm";
import { Avatar } from "../account/Avatar";
import { describeError } from "../account/errors";
import { signedInLine } from "../account/google";
import { GoogleMark, useCanConnectGoogle } from "../account/GoogleButton";
import { useLinkApproval } from "../account/LinkApprove";
import { ProfileEditor, ProfileGrid } from "../account/Profiles";
import { ProfileSetup, SectionPicker, sectionsKept, sectionsShown } from "../account/ProfileSetup";
import { chooseAccent, chooseLanguage, useSettings } from "../account/settings";
import { keptLanguages, languageNamer, MAX_SUBTITLE_LANGUAGES, pickableLanguages, toggleLanguage } from "../account/subtitleLanguages";
import { ACCENT_INK, ACCENT_SWATCH } from "../account/theme";
import { LANGUAGE_NAMES, useLanguage, useT } from "../i18n";
import { formatLinkCode } from "../shared/format";
import { CheckIcon, ChevronIcon, FilmIcon, InfoIcon, LockIcon, LogoutIcon, PencilIcon, SubtitlesIcon, TvIcon, UserIcon, UsersIcon } from "../shared/icons";
import { linkCodeOf, typedLinkCode } from "../shared/launch";
import { QrCode } from "../shared/QrCode";
import { handHeld } from "../shared/backButton";
import { BackButton, Screen } from "./Idle";
import { TvPinAsk, TvPinSetup } from "./Pin";
import { TvCode } from "./TvCode";

export type AccountView = "panel" | "signin" | "approve" | "profiles" | "manage" | "subtitles" | "pin" | "sections" | "setup";

type SettingsPage = "subtitles" | "pin" | "sections";

const POLL_MS = 2000;

const LISTEN_MS = 10 * 60_000;

interface Request {
  code: string;
  secret: string;
  expiresAt: number;
}

export function TvSignIn({ onClose, onBack = onClose }: { onClose: () => void; onBack?: () => void }) {
  const t = useT();
  const account = useAccount();
  const [typed] = useState(handHeld);
  const [mode, setMode] = useState<"phone" | "email">(typed ? "email" : "phone");
  const formBack = typed ? onBack : () => setMode("phone");
  const [creating, setCreating] = useState(false);
  const [asking, setAsking] = useState(false);
  const [request, setRequest] = useState<Request | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [resting, setResting] = useState(false);
  const until = useRef(Date.now() + LISTEN_MS);
  const again = useRef<HTMLButtonElement>(null);
  const done = useRef({ account, onClose });
  done.current = { account, onClose };

  useEffect(() => {
    if (mode !== "phone") return;
    setResting(false);
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = (message: string | null, delay: number) => {
      if (!live) return;
      setRequest(null);
      setProblem(message);
      timer = setTimeout(() => setAttempt((n) => n + 1), delay);
    };
    const retry = (message: string | null, delay: number) => {
      if (Date.now() + delay <= until.current) return later(message, delay);
      if (!live) return;
      setRequest(null);
      setProblem(null);
      setResting(true);
    };
    void (async () => {
      let started: Request;
      try {
        started = await api.linkStart("tv");
      } catch (error) {
        return retry(describeError(error), 6000);
      }
      if (!live) return;
      setRequest(started);
      setProblem(null);
      const endsAt = Date.now() + LINK_TTL_MS;
      const poll = async () => {
        if (!live) return;
        if (Date.now() >= endsAt) return retry(null, 0);
        try {
          const outcome = await api.linkPoll(started.code, started.secret);
          if (!live) return;
          if (outcome.status === "approved") {
            done.current.account.signedInAs(outcome.me);
            done.current.onClose();
            return;
          }
          if (outcome.status === "denied") return later(t("link.denied"), 3500);
          if (outcome.status === "gone") return retry(null, 0);
        } catch (error) {
          if (!live) return;
          if (error instanceof ApiError && error.status === 404) return retry(describeError(error), 6000);
        }
        timer = setTimeout(() => void poll(), POLL_MS);
      };
      timer = setTimeout(() => void poll(), POLL_MS);
    })();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [mode, attempt]);

  useEffect(() => {
    if (resting) again.current?.focus();
  }, [resting]);
  const goOn = () => {
    until.current = Date.now() + LISTEN_MS;
    setResting(false);
    setAttempt((n) => n + 1);
  };

  if (mode === "email") {
    return (
      <Screen key="email" testId="tv-signin" compact focus onBack={asking ? undefined : formBack}>
        <h1 className="tv-headline tv-headline-small">{t(creating ? "auth.signUp" : "auth.signIn")}</h1>
        <AuthForm tv initialMode={creating ? "signUp" : "signIn"} onDone={onClose} onMode={(next) => setCreating(next === "signUp")} onWarning={setAsking} />
        <button className="tv-action" onClick={() => setMode("phone")} data-nav data-testid="tv-signin-phone">
          {t("link.codeInstead")}
        </button>
        {!asking && <BackButton onClick={formBack} testId="tv-signin-form-back" />}
      </Screen>
    );
  }

  return (
    <Screen key="phone" testId="tv-signin" compact onBack={onBack}>
      <h1 className="tv-headline tv-headline-small">{t("link.title")}</h1>
      <div className="tv-pair">
        <ol className="tv-steps">
          <li>
            <span className="tv-step-no">1</span>
            <span>{t("link.step1")}</span>
          </li>
          <li>
            <span className="tv-step-no">2</span>
            <span>{t("link.step2")}</span>
          </li>
          <li>
            <span className="tv-step-no">3</span>
            <span>{t("link.step3")}</span>
          </li>
          <li className="tv-code-row">
            <TvCode
              className="tv-link-code"
              shown={request ? formatLinkCode(request.code) : "····-····"}
              copy={request ? formatLinkCode(request.code) : undefined}
              testId="tv-link-code"
              copyTestId="tv-link-code-copy"
              live
            />
          </li>
        </ol>
        <div className="tv-qr">
          {request ? <QrCode value={`${location.origin}/?link=${encodeURIComponent(request.code)}`} label={t("link.step3")} /> : <div className={`tv-qr-wait${resting ? "" : " spinner"}`} />}
        </div>
      </div>
      <p className={`tv-lead tv-signin-status${problem ? " is-problem" : ""}`} data-testid="tv-signin-status" role="status">
        {(resting ? t("link.rested") : problem) ?? (
          <>
            <span className="spinner" /> {t("link.waiting")}
          </>
        )}
      </p>
      <div className="tv-actions">
        {resting && (
          <button ref={again} className="tv-action" onClick={goOn} data-nav data-testid="tv-signin-again">
            {t("link.newCode")}
          </button>
        )}
        <button
          className="tv-action"
          onClick={() => {
            setCreating(false);
            setMode("email");
          }}
          data-nav
          data-testid="tv-signin-email"
        >
          {t("link.emailInstead")}
        </button>
        {account.registration === "open" && (
          <button
            className="tv-action"
            onClick={() => {
              setCreating(true);
              setMode("email");
            }}
            data-nav
            data-testid="tv-signin-create"
          >
            {t("auth.toSignUp")}
          </button>
        )}
      </div>
      <BackButton onClick={onBack} testId="tv-signin-back" />
    </Screen>
  );
}

function TvApprove({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [code, setCode] = useState<string | null>(null);

  if (code) {
    return (
      <TvApproveAsk
        code={code}
        onBack={() => {
          setCode(null);
          setTyped("");
        }}
        onClose={onClose}
      />
    );
  }

  const change = (value: string) => {
    const shown = typedLinkCode(value);
    setTyped(shown);
    setCode(linkCodeOf(shown) ?? null);
  };

  return (
    <Screen key="code" testId="tv-approve" compact focus onBack={onClose}>
      <h1 className="tv-headline tv-headline-small">{t("account.signInTv")}</h1>
      <p className="tv-lead">{t("tv.approveHelp")}</p>
      <form className="auth-form auth-tv" onSubmit={(event) => event.preventDefault()} noValidate>
        <label className="auth-field">
          <span>{t("link.enterCode")}</span>
          <input
            className="tv-link-input"
            data-testid="tv-approve-input"
            data-nav
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={9}
            placeholder="ABCD-2345"
            value={typed}
            onChange={(event) => change(event.target.value)}
          />
        </label>
      </form>
      <BackButton onClick={onClose} testId="tv-approve-back" />
    </Screen>
  );
}

function TvApproveAsk({ code, onBack, onClose }: { code: string; onBack: () => void; onClose: () => void }) {
  const t = useT();
  const { view, body, problem, outcome, busy, decide } = useLinkApproval(code);

  if (outcome !== "asking") {
    return (
      <Screen key="done" testId="tv-approve-done" compact focus onBack={onClose}>
        <span className="tv-ready-icon">{outcome === "approved" ? <CheckIcon /> : <TvIcon />}</span>
        <h1 className="tv-headline tv-headline-small">{t(outcome === "approved" ? "link.approved" : "link.denied")}</h1>
        <div className="tv-actions">
          <button className="tv-action tv-action-primary" onClick={onClose} data-nav data-testid="tv-approve-close">
            {t("common.done")}
          </button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen key={view ? "ask" : "wait"} testId="tv-approve-ask" compact onBack={onBack}>
      <h1 className="tv-headline tv-headline-small">{t("link.approveTitle")}</h1>
      {view ? (
        <>
          <p className="tv-code tv-link-code" data-testid="tv-approve-code">
            {formatLinkCode(view.code)}
          </p>
          <p className="tv-lead tv-approve-body">{body}</p>
        </>
      ) : problem ? null : (
        <p className="tv-lead tv-signin-status" role="status">
          <span className="spinner" /> {t("common.loading")}
        </p>
      )}
      {problem && (
        <p className="tv-lead tv-signin-status is-problem" role="alert" data-testid="tv-approve-error">
          {problem}
        </p>
      )}
      <div className="tv-actions">
        {view && (
          <>
            <button className="tv-action tv-action-primary" disabled={busy} onClick={() => void decide(true)} data-nav data-testid="tv-approve-yes">
              {t("link.approve")}
            </button>
            <button className="tv-action" disabled={busy} onClick={() => void decide(false)} data-nav data-testid="tv-approve-no">
              {t("link.deny")}
            </button>
          </>
        )}
      </div>
      <BackButton onClick={onBack} testId="tv-approve-again" />
    </Screen>
  );
}

interface ProfilesProps {
  forced: boolean;
  manage: boolean;
  onDone: () => void;
  onBack: () => void;
}

export function TvProfiles({ forced, manage, onDone, onBack }: ProfilesProps) {
  const t = useT();
  const account = useAccount();
  const [managing, setManaging] = useState(manage);
  const [editing, setEditing] = useState<Profile | "new" | null>(null);
  if (!account.me) return null;
  const { profiles } = account.me;

  if (editing) {
    const existing = editing === "new" ? undefined : editing;
    const close = () => setEditing(null);
    return (
      <Screen key="edit" testId="tv-profile-edit" compact focus onBack={close}>
        <ProfileEditor
          tv
          heading={t(existing ? "profiles.edit" : "profiles.new")}
          profile={existing}
          taken={profiles.map((other) => other.avatar)}
          onSave={async (name, avatar) => {
            if (existing) {
              await account.updateProfile(existing.id, { name, avatar });
            } else {
              const added = await account.addProfile(name, avatar);
              if (added && forced) {
                account.choose(added.id);
                return onDone();
              }
            }
            close();
          }}
          onCancel={close}
          onDelete={
            existing && profiles.length > 1
              ? async () => {
                  await account.deleteProfile(existing.id);
                  close();
                }
              : undefined
          }
        />
      </Screen>
    );
  }

  const grownUp = account.childLock.grownUp;
  const pick = (picked: Profile) => {
    const go = () => {
      account.choose(picked.id);
      onDone();
    };
    if (picked.id === account.profile?.id) go();
    else grownUp(go);
  };
  const doneManaging = manage ? onBack : () => setManaging(false);
  return (
    <Screen key={managing ? "manage" : "pick"} testId="tv-profiles" focus onBack={managing ? doneManaging : forced ? undefined : onBack}>
      <h1 className="tv-headline">{t(managing ? "profiles.manage" : "profiles.title")}</h1>
      <ProfileGrid
        tv
        mode={managing ? "manage" : "pick"}
        profiles={profiles}
        current={account.profile?.id}
        onPick={managing ? setEditing : pick}
        {...(managing || forced ? { onAdd: () => setEditing("new") } : {})}
      />
      {managing && <p className="tv-lead tv-hint">{t("profiles.count", { count: profiles.length, max: MAX_PROFILES })}</p>}
      <div className="tv-actions">
        {managing ? (
          <button className="tv-action tv-action-primary" onClick={doneManaging} data-nav data-testid="tv-profiles-done">
            {t("common.done")}
          </button>
        ) : (
          <>
            <button className="tv-action" onClick={() => grownUp(() => setManaging(true))} data-nav data-testid="tv-profiles-manage">
              {t("profiles.manage")}
            </button>
            <button className="tv-action" onClick={() => grownUp(() => void account.signOut().then(onDone))} data-nav data-testid="tv-profiles-signout">
              {t("auth.signOut")}
            </button>
          </>
        )}
      </div>
      {!managing && !forced && <BackButton onClick={onBack} testId="tv-profiles-back" />}
    </Screen>
  );
}

function SettingsGroup({ title, children, testId }: { title?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="tv-group" {...(title ? { "aria-label": title } : {})} data-testid={testId}>
      {title && (
        <h2 className="tv-group-title" aria-hidden="true">
          {title}
        </h2>
      )}
      <div className="tv-group-body">{children}</div>
    </section>
  );
}

function SettingsLine({ icon, label, value, onPress, testId, autoFocus = false, tone = "plain" }: { icon: ReactNode; label: string; value?: string; onPress: () => void; testId: string; autoFocus?: boolean; tone?: "plain" | "danger" }) {
  return (
    <button className={`tv-line${tone === "danger" ? " tv-line-danger" : ""}`} onClick={onPress} data-nav {...(autoFocus ? { "data-autofocus": true } : {})} data-testid={testId}>
      <span className="tv-line-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="tv-line-text">{label}</span>
      {value !== undefined && <span className="tv-line-value">{value}</span>}
      {tone === "plain" && <ChevronIcon className="tv-line-chevron" />}
    </button>
  );
}

function SettingsSwitch({ label, on, onToggle, testId }: { label: string; on: boolean; onToggle: () => void; testId: string }) {
  return (
    <button className="tv-switch-row" role="switch" aria-checked={on} onClick={onToggle} data-nav data-testid={testId}>
      <span>{label}</span>
      <span className="tv-switch" aria-hidden="true" />
    </button>
  );
}

export function TvAccountPanel({
  onClose,
  onSignIn,
  onApprove,
  onSwitch,
  onManage,
  onSubtitles,
  onPin,
  onSections,
  cameFrom,
}: {
  onClose: () => void;
  onSignIn: () => void;
  onApprove: () => void;
  onSwitch: () => void;
  onManage: () => void;
  onSubtitles: () => void;
  onPin: () => void;
  onSections: () => void;
  cameFrom?: SettingsPage | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const account = useAccount();
  const { settings, set } = useSettings();
  const { me, profile } = account;
  const autoplay = settings.autoplayNext ?? true;
  const autoSkip = settings.autoSkip ?? false;
  const tapToPause = settings.tapToPause ?? false;
  const adaptiveQuality = settings.adaptiveQuality ?? true;
  const child = settings.child === true;
  const several = Boolean(me && me.profiles.length > 1);
  const canConnectGoogle = useCanConnectGoogle();
  const subtitleName = useMemo(() => languageNamer(language), [language]);
  const chosenSubtitles = settings.subtitleLanguages ?? [];
  const subtitlesValue = chosenSubtitles.length === 0 ? undefined : chosenSubtitles.length === 1 ? subtitleName(chosenSubtitles[0]!) : `${subtitleName(chosenSubtitles[0]!)} +${chosenSubtitles.length - 1}`;
  const top = cameFrom === undefined;
  const grownUp = account.childLock.grownUp;
  return (
    <Screen testId="tv-account" focus onBack={onClose} className="tv-screen-settings">
      <div className="tv-set tv-set-main">
        <header className="tv-set-head" data-nav-column>
          <h1 className="tv-set-title" data-testid="tv-settings-title">
            {t("settings.title")}
          </h1>
          <BackButton onClick={onClose} testId="tv-account-back" />
        </header>

        <div className="tv-set-grid tv-set-grid-panel">
          <div className="tv-set-col" data-nav-column>
            <SettingsGroup title={t("tv.profile")} testId="tv-group-profile">
              <div className="tv-who">
                {me && profile ? (
                  <Avatar id={profile.avatar} className="tv-who-avatar" />
                ) : (
                  <span className="tv-who-guest" aria-hidden="true">
                    <UserIcon />
                  </span>
                )}
                <div className="tv-who-text">
                  <h2 data-testid="tv-account-name">{me && profile ? profile.name : t("tv.notSignedIn")}</h2>
                  {me && <p>{signedInLine(me)}</p>}
                </div>
              </div>
              {!me && <p className="tv-who-note">{t("auth.pitchDetail")}</p>}
              {me && profile ? (
                <>
                  {several && <SettingsLine icon={<UsersIcon />} label={t("profiles.switch")} onPress={onSwitch} testId="tv-switch-profile" autoFocus={top} />}
                  <SettingsLine icon={<PencilIcon />} label={t("profiles.manage")} onPress={onManage} testId="tv-manage-profiles" autoFocus={top && !several} />
                  <SettingsLine icon={<TvIcon />} label={t("account.signInTv")} onPress={onApprove} testId="tv-approve" />
                  {canConnectGoogle && <SettingsLine icon={<GoogleMark />} label={t("account.googleConnect")} onPress={() => grownUp(() => account.withGoogle("link"))} testId="tv-connect-google" />}
                  {!child && (
                    <SettingsSwitch
                      label={t("settings.publicWatching")}
                      on={settings.publicWatching !== false}
                      onToggle={() => {
                        set("publicWatching", settings.publicWatching !== false ? false : undefined);
                        account.syncNow();
                      }}
                      testId="tv-public-watching"
                    />
                  )}
                </>
              ) : (
                account.status === "ready" && (
                  <div className="tv-who-cta">
                    <button className="tv-action tv-action-primary" onClick={onSignIn} data-nav {...(top ? { "data-autofocus": true } : {})} data-testid="tv-sign-in">
                      {t("auth.signIn")}
                    </button>
                  </div>
                )
              )}
            </SettingsGroup>
            {me && profile && (
              <SettingsGroup testId="tv-group-account">
                {(!child || me.account.childPin) && (
                  <SettingsLine icon={<LockIcon />} label={t("pin.setting")} value={me.account.childPin ? t("common.on") : t("common.off")} onPress={onPin} testId="tv-pin-setting" autoFocus={cameFrom === "pin"} />
                )}
                <SettingsLine icon={<LogoutIcon />} label={t("auth.signOut")} onPress={() => grownUp(() => void account.signOut().then(onClose))} testId="tv-sign-out" tone="danger" />
              </SettingsGroup>
            )}
          </div>

          <div className="tv-set-col" data-nav-column>
            <SettingsGroup title={t("settings.appearance")} testId="tv-group-look">
              <div className="tv-field">
                <span className="tv-field-label" aria-hidden="true">
                  {t("settings.language")}
                </span>
                <div className="tv-segmented" role="radiogroup" aria-label={t("settings.language")}>
                  {UI_LANGUAGES.map((code) => (
                    <button key={code} className="tv-choice" role="radio" aria-checked={language === code} onClick={() => chooseLanguage(code)} data-nav data-testid={`tv-lang-${code}`}>
                      {LANGUAGE_NAMES[code]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="tv-field">
                <div className="tv-swatches" role="radiogroup" aria-label={t("settings.accent")}>
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent}
                      className="tv-swatch"
                      role="radio"
                      aria-checked={(settings.accent ?? ACCENTS[0]) === accent}
                      aria-label={t(`accent.${accent}`)}
                      style={{ background: ACCENT_SWATCH[accent], color: ACCENT_INK[accent] }}
                      onClick={() => chooseAccent(accent)}
                      data-nav
                      data-testid={`tv-accent-${accent}`}
                    >
                      <CheckIcon />
                    </button>
                  ))}
                </div>
              </div>
            </SettingsGroup>

            <SettingsGroup title={t("settings.playback")} testId="tv-group-playback">
              <SettingsSwitch label={t("settings.autoplayNext")} on={autoplay} onToggle={() => set("autoplayNext", !autoplay)} testId="tv-autoplay" />
              <SettingsSwitch label={t("settings.autoSkip")} on={autoSkip} onToggle={() => set("autoSkip", !autoSkip)} testId="tv-autoskip" />
              <div className="tv-field">
                <span className="tv-field-label" aria-hidden="true">
                  {t("settings.animeAudio")}
                </span>
                <div className="tv-segmented" role="radiogroup" aria-label={t("settings.animeAudio")}>
                  <button
                    className="tv-choice"
                    role="radio"
                    aria-checked={(settings.animeAudio ?? "jp") === "jp"}
                    onClick={() => set("animeAudio", "jp")}
                    data-nav
                    data-testid="tv-anime-audio-jp"
                  >
                    {t("settings.animeAudioJp")}
                  </button>
                  <button
                    className="tv-choice"
                    role="radio"
                    aria-checked={settings.animeAudio === "eng"}
                    onClick={() => set("animeAudio", "eng")}
                    data-nav
                    data-testid="tv-anime-audio-eng"
                  >
                    {t("settings.animeAudioEng")}
                  </button>
                </div>
              </div>
            </SettingsGroup>

          </div>

          <div className="tv-set-col" data-nav-column>
            <SettingsGroup testId="tv-group-sections">
              {!child && (
                <SettingsLine
                  icon={<FilmIcon />}
                  label={t("settings.sectionsLine")}
                  value={settings.sections ? sectionsShown(settings.sections).map((section) => t(SECTION_NAME[section])).join(", ") : t("settings.sectionsAll")}
                  onPress={onSections}
                  testId="tv-sections-setting"
                  autoFocus={cameFrom === "sections"}
                />
              )}
              <SettingsLine icon={<SubtitlesIcon />} label={t("settings.subtitleLanguages")} {...(subtitlesValue ? { value: subtitlesValue } : {})} onPress={onSubtitles} testId="tv-subtitle-languages" autoFocus={cameFrom === "subtitles"} />
              {!child && (
                <SettingsSwitch
                  label={t("settings.titleNotices")}
                  on={settings.titleNotices !== false}
                  onToggle={() => {
                    set("titleNotices", settings.titleNotices !== false ? false : undefined);
                    account.syncNow();
                  }}
                  testId="tv-title-notices"
                />
              )}
              <SettingsSwitch
                label={t("settings.child")}
                on={child}
                onToggle={() => {
                  const change = () => {
                    set("child", child ? undefined : true);
                    account.syncNow();
                  };
                  if (child) grownUp(change);
                  else change();
                }}
                testId="tv-child"
              />
              <p className="tv-hint tv-set-note" data-testid="tv-child-help">
                {t("settings.childNote")}
              </p>
            </SettingsGroup>
            <SettingsGroup title={t("settings.labs")} testId="tv-group-labs">
              <SettingsSwitch label={t("settings.tapToPause")} on={tapToPause} onToggle={() => set("tapToPause", !tapToPause)} testId="tv-tap-to-pause" />
              <SettingsSwitch label={t("settings.adaptiveQuality")} on={adaptiveQuality} onToggle={() => set("adaptiveQuality", adaptiveQuality ? false : undefined)} testId="tv-adaptive-quality" />
            </SettingsGroup>
          </div>
        </div>
      </div>
    </Screen>
  );
}

export function TvSubtitleLanguages({ onBack }: { onBack: () => void }) {
  const t = useT();
  const language = useLanguage();
  const { settings, set } = useSettings();
  const chosen = settings.subtitleLanguages ?? [];
  const only = settings.onlySubtitleLanguages ?? false;
  const name = useMemo(() => languageNamer(language), [language]);
  const full = chosen.length >= MAX_SUBTITLE_LANGUAGES;
  const order = chosen.length > 0 ? chosen.map((code, index) => `${index + 1}. ${name(code)}`).join("  ·  ") : t("settings.subtitleDefaults", { languages: preferredLanguages(undefined, language).map(name).join(", ") });
  return (
    <Screen testId="tv-subtitle-settings" focus onBack={onBack}>
      <div className="tv-set tv-set-languages">
        <header className="tv-set-head" data-nav-column>
          <h1 className="tv-set-title" data-testid="tv-subtitles-title">
            {t("settings.subtitleLanguages")}
          </h1>
          <BackButton onClick={onBack} testId="tv-subtitles-back" />
        </header>
        <div className="tv-set-col" data-nav-column>
          <p className="tv-hint tv-set-hint">
            <InfoIcon /> <span>{t("settings.subtitlePickHelp")}</span>
          </p>
          <SettingsGroup testId="tv-group-subtitle-languages">
            <div className="tv-field">
              <span className="tv-field-label" aria-hidden="true">
                {t("settings.subtitleOrder")}
              </span>
              <p className="tv-lang-order" data-testid="tv-subtitle-order" aria-live="polite">
                {order}
              </p>
            </div>
            <div className="tv-lang-grid" role="group" aria-label={t("settings.subtitleLanguages")}>
              {pickableLanguages(chosen).map((code, index) => {
                const rank = chosen.indexOf(code);
                const blocked = rank < 0 && full;
                return (
                  <button
                    key={code}
                    className="tv-lang"
                    aria-pressed={rank >= 0}
                    {...(blocked ? { "aria-disabled": true } : {})}
                    onClick={() => {
                      if (!blocked) set("subtitleLanguages", keptLanguages(toggleLanguage(chosen, code)));
                    }}
                    data-nav
                    {...(index === 0 ? { "data-autofocus": true } : {})}
                    data-testid={`tv-subtitle-lang-${code}`}
                  >
                    <span className="tv-lang-name">{name(code)}</span>
                    {rank >= 0 && <span className="tv-lang-rank">{rank + 1}</span>}
                  </button>
                );
              })}
            </div>
            <SettingsSwitch label={t("settings.onlySubtitleLanguages")} on={only} onToggle={() => set("onlySubtitleLanguages", only ? undefined : true)} testId="tv-only-languages" />
          </SettingsGroup>
        </div>
      </div>
    </Screen>
  );
}

const SECTION_NAME = { movie: "tv.movies", series: "tv.series", cartoon: "tv.cartoons", anime: "tv.anime" } as const;
function TvSections({ onBack }: { onBack: () => void }) {
  const t = useT();
  const { settings, set } = useSettings();
  return (
    <Screen testId="tv-sections-settings" focus onBack={onBack}>
      <div className="tv-set tv-set-sections">
        <header className="tv-set-head" data-nav-column>
          <h1 className="tv-set-title">{t("settings.sections")}</h1>
          <BackButton onClick={onBack} testId="tv-sections-back" />
        </header>
        <div className="tv-set-col" data-nav-column>
          <p className="tv-hint tv-set-hint">
            <InfoIcon /> <span>{t("setup.sectionsHelp")}</span>
          </p>
          <SectionPicker tv value={sectionsShown(settings.sections)} onChange={(next) => set("sections", sectionsKept(next))} />
        </div>
      </div>
    </Screen>
  );
}

function TvSetup({ onDone }: { onDone: () => void }) {
  const { profile } = useAccount();
  if (!profile?.setup) return null;
  return (
    <ProfileSetup
      tv
      profile={profile}
      onDone={onDone}
      frame={(step, children) => (
        <Screen key={step} testId="tv-setup" compact={step === "who"} focus>
          {children}
        </Screen>
      )}
    />
  );
}

export function TvAccount({ view, onView, forced }: { view: AccountView; onView: (view: AccountView | null) => void; forced: boolean }) {
  const account = useAccount();
  const { asking, grownUp, cancel, relock } = account.childLock;
  const [fromPanel, setFromPanel] = useState(false);
  const [cameFrom, setCameFrom] = useState<SettingsPage | undefined>(undefined);
  useEffect(
    () => () => {
      cancel();
      relock();
    },
    [cancel, relock],
  );
  const backFrom = (page: SettingsPage) => () => {
    setCameFrom(page);
    onView("panel");
  };
  const open = (page: AccountView) => () => {
    setCameFrom(undefined);
    onView(page);
  };
  const guarded = (page: AccountView) => () => grownUp(open(page));
  if (asking) return <TvPinAsk />;
  if (view === "signin") return <TvSignIn onClose={() => onView(null)} onBack={() => onView(fromPanel ? "panel" : null)} />;
  if (view === "approve") return <TvApprove onClose={() => onView("panel")} />;
  if (view === "subtitles") return <TvSubtitleLanguages onBack={backFrom("subtitles")} />;
  if (view === "pin") return <TvPinSetup onBack={backFrom("pin")} />;
  if (view === "sections") return <TvSections onBack={backFrom("sections")} />;
  if (view === "setup") return <TvSetup onDone={() => onView(null)} />;
  if (view === "profiles" || view === "manage") return <TvProfiles forced={forced} manage={view === "manage"} onDone={() => onView(null)} onBack={() => onView("panel")} />;
  return (
    <TvAccountPanel
      onClose={() => onView(null)}
      onSignIn={() => {
        setFromPanel(true);
        onView("signin");
      }}
      onApprove={guarded("approve")}
      onSwitch={guarded("profiles")}
      onManage={guarded("manage")}
      onSubtitles={open("subtitles")}
      onPin={open("pin")}
      onSections={open("sections")}
      cameFrom={cameFrom}
    />
  );
}
