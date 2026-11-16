import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ACCENTS, LINK_TTL_MS, MAX_PROFILES, preferredLanguages, UI_LANGUAGES, type Profile } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { api, ApiError } from "../account/api";
import { AuthForm } from "../account/AuthForm";
import { Avatar } from "../account/Avatar";
import { emitCat } from "../cat/bus";
import { CatIcon } from "../cat/Chip";
import { CAT_LOOKS, CAT_SIZES, useCatAsleep, useCatSettings, useCatShown } from "../cat/settings";
import { describeError } from "../account/errors";
import { signedInLine } from "../account/google";
import { GoogleMark, useCanConnectGoogle } from "../account/GoogleButton";
import { useLinkApproval } from "../account/LinkApprove";
import { ProfileEditor, ProfileGrid } from "../account/Profiles";
import { chooseAccent, chooseLanguage, useSettings } from "../account/settings";
import { keptLanguages, languageNamer, MAX_SUBTITLE_LANGUAGES, pickableLanguages, toggleLanguage } from "../account/subtitleLanguages";
import { ACCENT_INK, ACCENT_SWATCH } from "../account/theme";
import { LANGUAGE_NAMES, useLanguage, useT } from "../i18n";
import { formatLinkCode } from "../shared/format";
import { CheckIcon, ChevronIcon, InfoIcon, LogoutIcon, PencilIcon, SubtitlesIcon, TvIcon, UserIcon, UsersIcon } from "../shared/icons";
import { linkCodeOf, typedLinkCode } from "../shared/launch";
import { QrCode } from "../shared/QrCode";
import { handHeld } from "../shared/backButton";
import { BackButton, Screen } from "./Idle";
import { TvCode } from "./TvCode";

/** The pages of the account on the TV: the panel (who, settings), signing in, signing another screen in, "Who's watching?", the same page for making and changing profiles, and the pages of the settings that open from a row of it (the subtitle languages, the cat). */
export type AccountView = "panel" | "signin" | "approve" | "profiles" | "manage" | "subtitles" | "cat";

/** How often the TV asks whether a phone has approved it. */
const POLL_MS = 2000;

/** How long a TV that nobody answers goes on asking (a code lasts 5 minutes, so it is given a second one) before it rests until someone says to go on. */
const LISTEN_MS = 10 * 60_000;

interface Request {
  code: string;
  secret: string;
  expiresAt: number;
}

/**
 * Sign this TV in without typing: it shows a code and a QR code, a phone that is already signed in opens the code and approves it,
 * and the answer to the TV's next question carries the session. A name and password typed here is the way for a TV with a keyboard, and the first
 * one for a phone or a tablet that is the screen: it has a keyboard of its own, and the code would ask for another phone (it is a press away).
 */
export function TvSignIn({ onClose, onBack = onClose }: { onClose: () => void; /** Where Back goes, when that is not where signing in ends up (the panel it was opened from). */ onBack?: () => void }) {
  const t = useT();
  const account = useAccount();
  const [typed] = useState(handHeld);
  const [mode, setMode] = useState<"phone" | "email">(typed ? "email" : "phone");
  /** Back from the typed form: to the code where that is the first page, out where the form is. */
  const formBack = typed ? onBack : () => setMode("phone");
  const [creating, setCreating] = useState(false); // the typed form is making an account, not signing in
  const [asking, setAsking] = useState(false); // ...and is asking whether to, with the password it was given
  const [request, setRequest] = useState<Request | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [resting, setResting] = useState(false); // nobody answered for LISTEN_MS: no more asking until the button says to
  const until = useRef(Date.now() + LISTEN_MS); // when it rests
  const again = useRef<HTMLButtonElement>(null);
  const done = useRef({ account, onClose });
  done.current = { account, onClose };

  // One request at a time, asked for again whenever it ends: it ran out, or the phone said no. A TV that nobody is at would go on for ever:
  // once LISTEN_MS are over, a code that has run out (or could not be had) is not asked for again until the button is pressed.
  useEffect(() => {
    if (mode !== "phone") return;
    setResting(false); // (a page that comes back from the typed form is asking again)
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
      // (The code lasts this long from now by this screen's own clock. The server's `expiresAt` is by the server's: a TV whose clock runs minutes ahead would find every code already out of time and ask for a new one every other second.)
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
          // not reachable just now (or told to slow down): look again in a moment
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

  // The button is what is under the remote's OK when the page has been left alone.
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
      // (While the form asks whether to make an account with a poor password, Back is the form's: it goes back to the password.)
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
        {/* (A new visitor has no account to sign in with on another device: making one was two presses deep, behind the typed form. The judge, 16 Nov.) */}
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

/**
 * Sign another screen in from this one, for a computer with no phone at hand: type the code that screen shows, see who is asking,
 * and say yes. The code is typed on a keyboard (or the TV's own on-screen one), the way the name and password form is.
 */
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
    setCode(linkCodeOf(shown) ?? null); // all eight characters: on to the request
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

/** The request behind a typed code: who is asking, and yes or no. Nothing has the focus to begin with, so a stray OK press never signs a screen in. */
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
  /** Nobody has been picked on this screen yet: the page can't be left without choosing (or signing out). */
  forced: boolean;
  /** Opened by "Manage profiles": it starts on the pictures that lead to the editors, and Back goes to the account page. */
  manage: boolean;
  onDone: () => void;
  onBack: () => void;
}

/**
 * "Who's watching?": the profiles of the signed-in account as big pictures, shown by itself when nobody has been picked on this TV
 * yet. It is also where profiles are made, changed and removed, so none of that needs a phone: Manage profiles turns each picture
 * into the way to its editor, with a tile to add one while there is room.
 */
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
                account.choose(added.id); // nobody was picked yet, and this one was made by whoever is here
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

  const pick = (picked: Profile) => {
    account.choose(picked.id);
    onDone();
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
            <button className="tv-action" onClick={() => setManaging(true)} data-nav data-testid="tv-profiles-manage">
              {t("profiles.manage")}
            </button>
            <button className="tv-action" onClick={() => void account.signOut().then(onDone)} data-nav data-testid="tv-profiles-signout">
              {t("auth.signOut")}
            </button>
          </>
        )}
      </div>
      {!managing && !forced && <BackButton onClick={onBack} testId="tv-profiles-back" />}
    </Screen>
  );
}

/** A titled group of the settings page: its words above, and its things on one surface (rows with a hairline between them, or fields). */
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

/** A row of the settings page that leads on to another page, or does something to the account: an icon, what it does, how it stands (on a page that leads on), and for a page, an arrow. */
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

/** An on/off row of the settings page. */
function SettingsSwitch({ label, on, onToggle, testId }: { label: string; on: boolean; onToggle: () => void; testId: string }) {
  return (
    <button className="tv-switch-row" role="switch" aria-checked={on} onClick={onToggle} data-nav data-testid={testId}>
      <span>{label}</span>
      <span className="tv-switch" aria-hidden="true" />
    </button>
  );
}

/**
 * The settings, from the corner of the profile's page: who is watching and what can be done with the account (a column of its own), what the
 * site looks like (language, colour), what playback and sharing do. Three columns, each of groups with a name above and one surface under it,
 * so that a language is chosen from a few words in a row, a colour from dots, and the rest are switches, and none of them looks like the next.
 * For a guest the first column is where signing in starts.
 */
export function TvAccountPanel({
  onClose,
  onSignIn,
  onApprove,
  onSwitch,
  onManage,
  onSubtitles,
  onCat,
  cameFrom,
}: {
  onClose: () => void;
  onSignIn: () => void;
  onApprove: () => void;
  onSwitch: () => void;
  onManage: () => void;
  onSubtitles: () => void;
  onCat: () => void;
  /** The page of the settings Back came from: the remote lands on its row again, not at the top. */
  cameFrom?: "subtitles" | "cat" | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const account = useAccount();
  const { settings, set } = useSettings();
  const { me, profile } = account;
  const autoplay = settings.autoplayNext ?? true;
  const tapToPause = settings.tapToPause ?? false;
  const adaptiveQuality = settings.adaptiveQuality ?? true;
  const child = settings.child === true;
  const several = Boolean(me && me.profiles.length > 1);
  const canConnectGoogle = useCanConnectGoogle(); // (an account that has no Google account yet is offered to connect one, with the lines of the profile)
  const cat = useCatSettings(); // (the cat's switches are there only on a host that offers a cat)
  const subtitleName = useMemo(() => languageNamer(language), [language]);
  const chosenSubtitles = settings.subtitleLanguages ?? [];
  // (how the row stands, short: the first language chosen and how many more; nothing while the defaults apply)
  const subtitlesValue = chosenSubtitles.length === 0 ? undefined : chosenSubtitles.length === 1 ? subtitleName(chosenSubtitles[0]!) : `${subtitleName(chosenSubtitles[0]!)} +${chosenSubtitles.length - 1}`;
  const top = cameFrom === undefined; // (the first row of the profile lands the remote, unless it came back from a page of the settings)
  return (
    <Screen testId="tv-account" focus onBack={onClose}>
      <div className="tv-set">
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
                  {canConnectGoogle && <SettingsLine icon={<GoogleMark />} label={t("account.googleConnect")} onPress={() => account.withGoogle("link")} testId="tv-connect-google" />}
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
                <SettingsLine icon={<LogoutIcon />} label={t("auth.signOut")} onPress={() => void account.signOut().then(onClose)} testId="tv-sign-out" tone="danger" />
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
                <span className="tv-field-label" aria-hidden="true">
                  {t("settings.accent")}
                </span>
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

            {/* (The subtitle languages were a line in the third column that said to choose them on the phone: they are chosen here, on a page of their own, by a guest too.
                A group of its own, under the look, so that the three columns are about as tall as each other.) */}
            <SettingsGroup title={t("settings.subtitles")} testId="tv-group-subtitles">
              <SettingsLine icon={<SubtitlesIcon />} label={t("settings.subtitleLanguages")} {...(subtitlesValue ? { value: subtitlesValue } : {})} onPress={onSubtitles} testId="tv-subtitle-languages" autoFocus={cameFrom === "subtitles"} />
            </SettingsGroup>

            {/* (Ratings and friends had a group of two switches here: they are on for everybody since 15 Nov 2026, and what a friend may see is chosen on the friends' page.) */}
          </div>

          <div className="tv-set-col" data-nav-column>
            <SettingsGroup title={t("settings.playback")} testId="tv-group-playback">
              <SettingsSwitch label={t("settings.autoplayNext")} on={autoplay} onToggle={() => set("autoplayNext", !autoplay)} testId="tv-autoplay" />
            </SettingsGroup>
            {/* A child's profile (the owner, 15 Nov 2026): only cartoons for children, and no friends or watch party. A setting of the profile, so it follows it to every screen.
                In the column with the most room, with a short line under it: the settings still fit a 720p screen in every language. */}
            <SettingsGroup title={t("settings.childGroup")} testId="tv-group-child">
              <SettingsSwitch
                label={t("settings.child")}
                on={child}
                onToggle={() => {
                  set("child", child ? undefined : true);
                  account.syncNow(); // (the server turns the friends off at once)
                }}
                testId="tv-child"
              />
              <p className="tv-hint tv-set-note" data-testid="tv-child-help">
                {t("settings.childNote")}
              </p>
            </SettingsGroup>
            {/* Labs: what few people use, or what is still being tried, last and together (each keeps what was chosen for it). The cat is one row, and its switches are on a page
                of their own, in the column with the most room: the settings are no taller with a cat offered than without, on any screen. */}
            <SettingsGroup title={t("settings.labs")} testId="tv-group-labs">
              <SettingsSwitch label={t("settings.tapToPause")} on={tapToPause} onToggle={() => set("tapToPause", !tapToPause)} testId="tv-tap-to-pause" />
              <SettingsSwitch label={t("settings.adaptiveQuality")} on={adaptiveQuality} onToggle={() => set("adaptiveQuality", adaptiveQuality ? false : undefined)} testId="tv-adaptive-quality" />
              {cat.offered && <SettingsLine icon={<CatIcon />} label={t("cat.settings.title")} value={cat.settings.on ? t("common.on") : t("common.off")} onPress={onCat} testId="tv-cat-open" autoFocus={cameFrom === "cat"} />}
            </SettingsGroup>
          </div>
        </div>
      </div>
    </Screen>
  );
}

/**
 * The subtitle languages' page of the settings (the phone has them on its settings page): the languages a profile wants listed first in the subtitle menus, in its
 * order, and whether the others are left out. Every language is a button that stays where it is: one press adds it at the end of the order (its number shows on
 * it), one more takes it out, so the remote never loses its place (nothing it can be on goes away or is switched off under it). A guest's are kept on this screen.
 * (The owner, 15 Nov 2026: "allow subtitle picking on tv/pc too not just phone as it says in the image".)
 */
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
                const blocked = rank < 0 && full; // (twelve are chosen: one more is not taken until one is taken out; the button stays, so the remote is never left on nothing)
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

/**
 * The cat's page of the settings: whether there is a cat on this screen, whether it keeps still, whether it keeps the viewer company in films, whether it is the
 * detailed one, what coat it wears and how big it is. A page of its own, two columns (what it does, and what it looks like), so that the settings page is no taller
 * on a host that offers a cat than on one that does not.
 */
export function TvCatSettings({ onBack }: { onBack: () => void }) {
  const t = useT();
  const cat = useCatSettings();
  const shown = useCatShown();
  const asleep = useCatAsleep(); // (the viewer sent the cat to sleep from its menu or its panel: this is where it is woken, as well)
  // (what is really drawn, when the white and grey cat was chosen: said, so that a screen that gives the simple version is not left to look like a choice that did nothing)
  const said = cat.settings.look === "ragdoll" && shown.art === "solid" ? t("cat.shown.solid") : cat.settings.look === "ragdoll" && shown.art === "classic" && shown.why ? t(`cat.shown.${shown.why}`) : "";
  return (
    <Screen testId="tv-cat-settings" focus onBack={onBack}>
      <div className="tv-set tv-set-cat">
        <header className="tv-set-head" data-nav-column>
          <h1 className="tv-set-title" data-testid="tv-cat-title">
            {t("cat.settings.title")}
          </h1>
          <BackButton onClick={onBack} testId="tv-cat-back" />
        </header>
        <div className="tv-set-grid tv-set-grid-2">
          <div className="tv-set-col" data-nav-column>
            {/* (why the cat is off: the owner turned it off on every screen, see cat/settings.ts CAT_SWITCH) */}
            <p className="tv-hint tv-set-hint" data-testid="tv-cat-notice" role="note">
              <InfoIcon /> <span>{t("cat.settings.notice")}</span>
            </p>
            <SettingsGroup title={t("cat.settings.behaviour")} testId="tv-group-cat-behaviour">
              <SettingsSwitch label={t("cat.settings.on")} on={cat.settings.on} onToggle={() => cat.set({ on: !cat.settings.on })} testId="tv-cat-switch" />
              {cat.settings.on && (
                <>
                  <SettingsSwitch label={t("cat.settings.quiet")} on={cat.settings.quiet} onToggle={() => cat.set({ quiet: !cat.settings.quiet })} testId="tv-cat-quiet" />
                  <SettingsSwitch label={t("cat.settings.films")} on={cat.settings.films} onToggle={() => cat.set({ films: !cat.settings.films })} testId="tv-cat-films" />
                  {asleep && (
                    <SettingsLine
                      icon={<CatIcon />}
                      label={t("cat.wake")}
                      onPress={() => {
                        emitCat({ type: "wake" });
                        // (the row goes with the sleep: the remote is put on the switch above it, not left on a button that is gone)
                        document.querySelector<HTMLElement>('[data-testid="tv-cat-films"]')?.focus({ preventScroll: true });
                      }}
                      testId="tv-cat-wake"
                    />
                  )}
                </>
              )}
            </SettingsGroup>
            <p className="tv-hint tv-set-hint" data-testid="tv-cat-help">
              <InfoIcon /> <span>{t("cat.settings.help")}</span>
            </p>
          </div>
          <div className="tv-set-col" data-nav-column>
            {cat.settings.on && (
              <SettingsGroup title={t("cat.settings.look")} testId="tv-group-cat-look">
                <div className="tv-field">
                  <span className="tv-field-label" aria-hidden="true">
                    {t("cat.settings.cat")}
                  </span>
                  <div className="tv-segmented" role="radiogroup" aria-label={t("cat.settings.cat")}>
                    {CAT_LOOKS.map((look) => (
                      <button key={look} className="tv-choice" role="radio" aria-checked={cat.settings.look === look} onClick={() => cat.set({ look })} data-nav data-testid={`tv-cat-look-${look}`}>
                        {t(`cat.look.${look}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="tv-hint tv-set-hint" data-testid="tv-cat-look-help">
                  <span>{t(`cat.look.${cat.settings.look}.help`)}</span>
                </p>
                {said && (
                  <p className="tv-hint tv-set-hint" role="status" data-testid="tv-cat-shown" data-art={shown.art} data-why={shown.why}>
                    <InfoIcon /> <span>{said}</span>
                  </p>
                )}
                {cat.settings.look === "ragdoll" && shown.art === "classic" && shown.why && (
                  <SettingsLine icon={<CatIcon />} label={t("cat.shown.retry")} onPress={() => emitCat({ type: "retry" })} testId="tv-cat-retry" />
                )}
                <div className="tv-field">
                  <span className="tv-field-label" aria-hidden="true">
                    {t("cat.settings.size")}
                  </span>
                  <div className="tv-segmented" role="radiogroup" aria-label={t("cat.settings.size")}>
                    {CAT_SIZES.map((size) => (
                      <button key={size} className="tv-choice" role="radio" aria-checked={cat.settings.size === size} onClick={() => cat.set({ size })} data-nav data-testid={`tv-cat-size-${size}`}>
                        {t(`cat.size.${size}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </SettingsGroup>
            )}
            {/* (the detailed cat is drawn from models licensed CC BY 4.0, which ask for the makers to be named and the changes to be said: said under the look it is the credit of, in the column with the room, where it made the left one taller than a TV's screen in Italian) */}
            <p className="tv-hint tv-set-hint tv-set-credit" data-testid="tv-cat-credit">
              <span>{t("cat.settings.credit")}</span>
            </p>
          </div>
        </div>
      </div>
    </Screen>
  );
}

/** Whichever page of the account is open. `forced`: signed in with nobody chosen yet, which can't be skipped. */
export function TvAccount({ view, onView, forced }: { view: AccountView; onView: (view: AccountView | null) => void; forced: boolean }) {
  const [fromPanel, setFromPanel] = useState(false); // (signing in was opened from the panel: Back goes there, not out to the library)
  const [cameFrom, setCameFrom] = useState<"subtitles" | "cat" | undefined>(undefined); // (the page of the settings Back came from, for the remote to land on its row)
  const backFrom = (page: "subtitles" | "cat") => () => {
    setCameFrom(page);
    onView("panel");
  };
  const open = (page: AccountView) => () => {
    setCameFrom(undefined);
    onView(page);
  };
  if (view === "signin") return <TvSignIn onClose={() => onView(null)} onBack={() => onView(fromPanel ? "panel" : null)} />;
  if (view === "approve") return <TvApprove onClose={() => onView("panel")} />;
  if (view === "subtitles") return <TvSubtitleLanguages onBack={backFrom("subtitles")} />;
  if (view === "cat") return <TvCatSettings onBack={backFrom("cat")} />;
  if (view === "profiles" || view === "manage") return <TvProfiles forced={forced} manage={view === "manage"} onDone={() => onView(null)} onBack={() => onView("panel")} />;
  return (
    <TvAccountPanel
      onClose={() => onView(null)}
      onSignIn={() => {
        setFromPanel(true);
        onView("signin");
      }}
      onApprove={open("approve")}
      onSwitch={open("profiles")}
      onManage={open("manage")}
      onSubtitles={open("subtitles")}
      onCat={open("cat")}
      cameFrom={cameFrom}
    />
  );
}
