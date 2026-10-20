import { useEffect, useRef, useState, type ReactNode } from "react";
import { ACCENTS, friendChoices, MAX_PROFILES, UI_LANGUAGES, type Profile } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { api, ApiError } from "../account/api";
import { AuthForm } from "../account/AuthForm";
import { Avatar } from "../account/Avatar";
import { CAT_COATS, CAT_SIZES, useCatSettings } from "../cat/settings";
import { describeError } from "../account/errors";
import { useLinkApproval } from "../account/LinkApprove";
import { ProfileEditor, ProfileGrid } from "../account/Profiles";
import { chooseAccent, chooseLanguage, useSettings } from "../account/settings";
import { ACCENT_INK, ACCENT_SWATCH } from "../account/theme";
import { LANGUAGE_NAMES, useLanguage, useT } from "../i18n";
import { formatLinkCode } from "../shared/format";
import { CheckIcon, ChevronIcon, InfoIcon, LogoutIcon, PencilIcon, TvIcon, UserIcon, UsersIcon } from "../shared/icons";
import { linkCodeOf, typedLinkCode } from "../shared/launch";
import { QrCode } from "../shared/QrCode";
import { BackButton, Screen } from "./Idle";
import { TvCode } from "./TvCode";

/** The pages of the account on the TV: the panel (who, settings), signing in, signing another screen in, "Who's watching?", and the same page for making and changing profiles. */
export type AccountView = "panel" | "signin" | "approve" | "profiles" | "manage";

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
 * and the answer to the TV's next question carries the session. A name and password typed here is the way for a TV with a keyboard.
 */
export function TvSignIn({ onClose, onBack = onClose }: { onClose: () => void; /** Where Back goes, when that is not where signing in ends up (the panel it was opened from). */ onBack?: () => void }) {
  const t = useT();
  const account = useAccount();
  const [mode, setMode] = useState<"phone" | "email">("phone");
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
      const poll = async () => {
        if (!live) return;
        if (Date.now() >= started.expiresAt) return retry(null, 0);
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
      <Screen key="email" testId="tv-signin" compact focus onBack={asking ? undefined : () => setMode("phone")}>
        <h1 className="tv-headline tv-headline-small">{t(creating ? "auth.signUp" : "auth.signIn")}</h1>
        <AuthForm tv onDone={onClose} onMode={(next) => setCreating(next === "signUp")} onWarning={setAsking} />
        <button className="tv-action" onClick={() => setMode("phone")} data-nav data-testid="tv-signin-phone">
          {t("link.codeInstead")}
        </button>
        {!asking && <BackButton onClick={() => setMode("phone")} testId="tv-signin-form-back" />}
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
        <button className="tv-action" onClick={() => setMode("email")} data-nav data-testid="tv-signin-email">
          {t("link.emailInstead")}
        </button>
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
  const { email, view, who, problem, outcome, busy, decide } = useLinkApproval(code);

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
          <p className="tv-lead tv-approve-body">{t("link.approveBody", { device: who, email })}</p>
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

/** A row of the settings page that leads on to another page, or does something to the account: an icon, what it does, and for a page, an arrow. */
function SettingsLine({ icon, label, onPress, testId, autoFocus = false, tone = "plain" }: { icon: ReactNode; label: string; onPress: () => void; testId: string; autoFocus?: boolean; tone?: "plain" | "danger" }) {
  return (
    <button className={`tv-line${tone === "danger" ? " tv-line-danger" : ""}`} onClick={onPress} data-nav {...(autoFocus ? { "data-autofocus": true } : {})} data-testid={testId}>
      <span className="tv-line-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="tv-line-text">{label}</span>
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
export function TvAccountPanel({ onClose, onSignIn, onApprove, onSwitch, onManage }: { onClose: () => void; onSignIn: () => void; onApprove: () => void; onSwitch: () => void; onManage: () => void }) {
  const t = useT();
  const language = useLanguage();
  const account = useAccount();
  const { settings, set } = useSettings();
  const { me, profile } = account;
  const autoplay = settings.autoplayNext ?? true;
  const tapToPause = settings.tapToPause ?? false;
  const adaptiveQuality = settings.adaptiveQuality ?? true;
  const ratingsOn = settings.ratings ?? true;
  const friendsOn = friendChoices(settings).friends;
  const several = Boolean(me && me.profiles.length > 1);
  const cat = useCatSettings(); // (the cat's switches are there only on a host that offers a cat)
  return (
    <Screen testId="tv-account" focus onBack={onClose}>
      <div className="tv-set">
        <header className="tv-set-head" data-nav-column>
          <h1 className="tv-set-title" data-testid="tv-settings-title">
            {t("settings.title")}
          </h1>
          <BackButton onClick={onClose} testId="tv-account-back" />
        </header>

        <div className="tv-set-grid">
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
                  {me && <p>{t("account.signedInAs", { email: me.account.email })}</p>}
                </div>
              </div>
              {!me && <p className="tv-who-note">{t("auth.pitchDetail")}</p>}
              {me && profile ? (
                <>
                  {several && <SettingsLine icon={<UsersIcon />} label={t("profiles.switch")} onPress={onSwitch} testId="tv-switch-profile" autoFocus />}
                  <SettingsLine icon={<PencilIcon />} label={t("profiles.manage")} onPress={onManage} testId="tv-manage-profiles" autoFocus={!several} />
                  <SettingsLine icon={<TvIcon />} label={t("account.signInTv")} onPress={onApprove} testId="tv-approve" />
                </>
              ) : (
                account.status === "ready" && (
                  <div className="tv-who-cta">
                    <button className="tv-action tv-action-primary" onClick={onSignIn} data-nav data-autofocus data-testid="tv-sign-in">
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

            <SettingsGroup title={t("settings.ratingsFriends")} testId="tv-group-share">
              <SettingsSwitch label={t("rating.settingsSwitch")} on={ratingsOn} onToggle={() => set("ratings", !ratingsOn)} testId="tv-ratings-switch" />
              {me && profile && (
                <SettingsSwitch
                  label={t("friends.switch")}
                  on={friendsOn}
                  onToggle={() => {
                    set("friends", !friendsOn);
                    account.syncNow(); // (the server hears of it now: it is what decides what a friend is shown)
                  }}
                  testId="tv-friends-switch"
                />
              )}
            </SettingsGroup>

            {cat.offered && (
              <>
                <SettingsGroup title={t("cat.settings.title")} testId="tv-group-cat">
                  <SettingsSwitch label={t("cat.settings.on")} on={cat.settings.on} onToggle={() => cat.set({ on: !cat.settings.on })} testId="tv-cat-switch" />
                  {cat.settings.on && (
                    <>
                      <SettingsSwitch label={t("cat.settings.quiet")} on={cat.settings.quiet} onToggle={() => cat.set({ quiet: !cat.settings.quiet })} testId="tv-cat-quiet" />
                      <SettingsSwitch label={t("cat.settings.films")} on={cat.settings.films} onToggle={() => cat.set({ films: !cat.settings.films })} testId="tv-cat-films" />
                      <SettingsSwitch label={t("cat.settings.detail")} on={cat.settings.detail} onToggle={() => cat.set({ detail: !cat.settings.detail })} testId="tv-cat-detail" />
                      {cat.settings.detail && (
                        <div className="tv-field">
                          <span className="tv-field-label" aria-hidden="true">
                            {t("cat.settings.coat")}
                          </span>
                          <div className="tv-segmented tv-segmented-grid" role="radiogroup" aria-label={t("cat.settings.coat")}>
                            {CAT_COATS.map((coat) => (
                              <button key={coat} className="tv-choice" role="radio" aria-checked={cat.settings.coat === coat} onClick={() => cat.set({ coat })} data-nav data-testid={`tv-cat-coat-${coat}`}>
                                {t(`cat.coat.${coat}`)}
                              </button>
                            ))}
                          </div>
                        </div>
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
                    </>
                  )}
                </SettingsGroup>
                <p className="tv-hint tv-set-hint" data-testid="tv-cat-help">
                  <InfoIcon /> <span>{t("cat.settings.help")}</span>
                </p>
              </>
            )}
          </div>

          <div className="tv-set-col" data-nav-column>
            <SettingsGroup title={t("settings.playback")} testId="tv-group-playback">
              <SettingsSwitch label={t("settings.autoplayNext")} on={autoplay} onToggle={() => set("autoplayNext", !autoplay)} testId="tv-autoplay" />
              <SettingsSwitch label={t("settings.tapToPause")} on={tapToPause} onToggle={() => set("tapToPause", !tapToPause)} testId="tv-tap-to-pause" />
              <SettingsSwitch label={t("settings.adaptiveQuality")} on={adaptiveQuality} onToggle={() => set("adaptiveQuality", adaptiveQuality ? false : undefined)} testId="tv-adaptive-quality" />
            </SettingsGroup>
            {me && (
              <p className="tv-hint tv-set-hint">
                <InfoIcon /> <span>{t("tv.subtitlesHint")}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </Screen>
  );
}

/** Whichever page of the account is open. `forced`: signed in with nobody chosen yet, which can't be skipped. */
export function TvAccount({ view, onView, forced }: { view: AccountView; onView: (view: AccountView | null) => void; forced: boolean }) {
  const [fromPanel, setFromPanel] = useState(false); // (signing in was opened from the panel: Back goes there, not out to the library)
  if (view === "signin") return <TvSignIn onClose={() => onView(null)} onBack={() => onView(fromPanel ? "panel" : null)} />;
  if (view === "approve") return <TvApprove onClose={() => onView("panel")} />;
  if (view === "profiles" || view === "manage") return <TvProfiles forced={forced} manage={view === "manage"} onDone={() => onView(null)} onBack={() => onView("panel")} />;
  return (
    <TvAccountPanel
      onClose={() => onView(null)}
      onSignIn={() => {
        setFromPanel(true);
        onView("signin");
      }}
      onApprove={() => onView("approve")}
      onSwitch={() => onView("profiles")}
      onManage={() => onView("manage")}
    />
  );
}
