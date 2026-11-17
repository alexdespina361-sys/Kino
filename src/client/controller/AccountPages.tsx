import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ACCENTS, DEVICE_NAME_MAX, friendChoices, friendSwitchWrites, preferredLanguages, sunsetSwitches, UI_LANGUAGES, type FriendSetting, type KeptFriend, type SessionInfo, type SunsetSwitch } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { api } from "../account/api";
import { Avatar } from "../account/Avatar";
import { describeError, describePasswordError } from "../account/errors";
import { GoogleMark } from "../account/GoogleButton";
import { PasswordInput } from "../account/PasswordInput";
import { chooseAccent, chooseLanguage, useSettings } from "../account/settings";
import { ACCENT_INK, ACCENT_SWATCH } from "../account/theme";
import { ago } from "../account/time";
import { COMMON_LANGUAGES, keptLanguages, languageNamer, MAX_SUBTITLE_LANGUAGES, moveLanguage } from "../account/subtitleLanguages";
import { CHAT_FACTS } from "../chat/state";
import { friendsApi } from "../friends/api";
import { useFriends } from "../friends/FriendsProvider";
import { LANGUAGE_NAMES, useLanguage, useT, type Key } from "../i18n";
import { CheckIcon, CloseIcon, GlobeIcon, PencilIcon, PhoneIcon, PlusIcon, ScanIcon, TrashIcon, TvIcon, UsersIcon } from "../shared/icons";
import { linkCodeOf, typedLinkCode } from "../shared/launch";
import { useLinkBox } from "../shared/linkBox";
import { PinSetting } from "./Pin";
import { linkFromScan } from "./scan";
import { cameraAvailable, Scanner } from "./Scanner";

/** A labelled group of settings (one whose button says it all has no heading). */
export function Group({ title, help, children }: { title?: string | undefined; help?: string | undefined; children: ReactNode }) {
  return (
    <section className="group">
      {title && <h3>{title}</h3>}
      {help && <p className="muted small">{help}</p>}
      {children}
    </section>
  );
}

/** An on/off setting; what it does is said under it, in the same row (a tap on those words is a tap on the row), where a line or two of words is needed. */
export function Switch({ label, hint, checked, onChange, testId }: { label: string; hint?: string | undefined; checked: boolean; onChange: (checked: boolean) => void; testId?: string }) {
  const id = useId();
  return (
    <button
      className={`switch-row${hint ? " has-hint" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      {...(hint ? { "aria-describedby": `${id}-hint` } : {})}
      onClick={() => onChange(!checked)}
      data-testid={testId}
    >
      <span className="switch-text">
        <span id={`${id}-label`}>{label}</span>
        {hint && (
          <small id={`${id}-hint`} className="switch-hint">
            {hint}
          </small>
        )}
      </span>
      <span className="switch" aria-hidden="true" />
    </button>
  );
}

/** Settings that belong together are one card, a row to each with a hairline between (a card to each is a stack of ten the same). */
export function Rows({ children }: { children: ReactNode }) {
  return <div className="menu">{children}</div>;
}

/* ------------------------------ settings ------------------------------ */

/** The languages of subtitles this profile cares about: listed first in the subtitle menus, in this order. */
function SubtitleLanguages() {
  const t = useT();
  const language = useLanguage();
  const { settings, set } = useSettings();
  const chosen = settings.subtitleLanguages ?? [];
  const name = useMemo(() => languageNamer(language), [language]);
  const save = (list: string[]) => set("subtitleLanguages", keptLanguages(list));
  // (The 26 languages to add are folded until asked for: open, they were most of the page.)
  const [adding, setAdding] = useState(false);
  const move = (index: number, by: number) => save(moveLanguage(chosen, index, by));

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
      {chosen.length < MAX_SUBTITLE_LANGUAGES && (
        <button className="btn btn-block" aria-expanded={adding} onClick={() => setAdding((open) => !open)} data-testid="add-language">
          {adding ? <CloseIcon /> : <PlusIcon />} {adding ? t("common.close") : t("settings.addLanguage")}
        </button>
      )}
      {chosen.length < MAX_SUBTITLE_LANGUAGES && adding && (
        <div className="language-add" role="group" aria-label={t("settings.addLanguage")}>
          {COMMON_LANGUAGES.filter((code) => !chosen.includes(code)).map((code) => (
            <button key={code} className="chip-pill" onClick={() => save([...chosen, code])} data-testid={`add-language-${code}`}>
              <PlusIcon /> {name(code)}
            </button>
          ))}
        </div>
      )}
      <Switch label={t("settings.onlySubtitleLanguages")} checked={settings.onlySubtitleLanguages ?? false} onChange={(on) => set("onlySubtitleLanguages", on ? true : undefined)} testId="only-languages" />
    </Group>
  );
}

/**
 * What a friend may do is on for everybody while friends are on, and the one thing to choose is whether what is watched is shared (both ways). A profile that had
 * turned one of these off keeps the switch for it (`sunsetSwitches`; the chat's and the news' are drawn apart, they say more).
 */
const SUNSET_SWITCH_ROWS: ReadonlyArray<{ key: FriendSetting & SunsetSwitch; label: Key; testId: string }> = [
  { key: "friendsLists", label: "friends.switchLists", testId: "friends-lists" },
  { key: "friendsRatings", label: "friends.switchRatings", testId: "friends-ratings" },
  { key: "friendsInbox", label: "friends.switchInbox", testId: "friends-inbox-switch" },
  { key: "friendsPresence", label: "friends.switchPresence", testId: "friends-presence" },
];

/** How long to wait before looking again for the friends that are kept when the first look failed, and how many more tries there are. */
const KEPT_RETRY_MS = 5000;
const KEPT_RETRIES = 4;

/**
 * Friends turned off, but not gone: who they still are, with a way to end a friendship from here, so that nobody has to turn on (if
 * only for a moment) everything that is shared with all of them just to remove one. Only for a profile that has turned friends on
 * and off again; nothing at all if it has no friends left.
 */
function KeptFriends({ profileId }: { profileId: string }) {
  const t = useT();
  const account = useAccount();
  const [kept, setKept] = useState<KeptFriend[]>([]);
  /** The friend whose removal waits for a second tap. */
  const [asking, setAsking] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // (A look that failed, because the connection blinked or the server asked to slow down, is tried again a few times: nothing else would ask.)
    const ask = (retries: number): void => {
      friendsApi.kept(profileId).then(
        (answer) => !stopped && setKept(answer.friends),
        () => {
          if (!stopped && retries > 0) retry = setTimeout(() => ask(retries - 1), KEPT_RETRY_MS);
        },
      );
    };
    ask(KEPT_RETRIES);
    return () => {
      stopped = true;
      clearTimeout(retry);
    };
  }, [profileId]);

  // The second tap has to come soon; a button left asking goes back to what it was.
  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(null), 4000);
    return () => clearTimeout(timer);
  }, [asking]);

  if (kept.length === 0) return null;
  const remove = async (friend: KeptFriend) => {
    if (asking !== friend.id) return setAsking(friend.id);
    setAsking(null);
    try {
      await friendsApi.remove(profileId, friend.id);
      setKept((list) => list.filter((each) => each.id !== friend.id));
      account.say(t("friends.removed", { name: friend.name }));
    } catch (error) {
      account.say(describeError(error));
    }
  };
  return (
    <div className="kept-friends" data-testid="kept-friends">
      <p className="muted small">{t("friends.keptHelp")}</p>
      <ul className="friend-list">
        {kept.map((friend) => (
          <li key={friend.id} className="friend-row kept" data-testid="kept-friend" data-friend={friend.id}>
            <Avatar id={friend.avatar} className="friend-avatar" />
            <span className="friend-text">
              <b>{friend.name}</b>
            </span>
            <button className="btn btn-danger" onClick={() => void remove(friend)} data-testid="kept-friend-remove" data-asking={asking === friend.id}>
              {asking === friend.id ? t("friends.removeAgain", { name: friend.name }) : t("friends.remove")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Friends: whether what each watches is shared (and, for a profile that turned something else off before, that too). Friends themselves are on for
 * everybody and have no switch (the owner, 15 Nov 2026: "remove the ratings and friends and turn it on for all accounts"); for a profile they are turned off
 * for (`friendsOff`, nothing sets it yet), the friendships kept are listed instead.
 * These are settings of the profile (so they follow it onto every screen), and each change is sent to the server at once: the server is
 * what decides what a friend is shown, from what the profile has chosen here.
 */
function FriendsGroup({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const { settings, set } = useSettings();
  const [sunset] = useState(() => sunsetSwitches(settings)); // (asked once: a switch that is turned back on stays until the page is left)
  if (!account.me || !account.profile) {
    return (
      <Group title={t("friends.settings")}>
        <p className="muted small" data-testid="friends-sign-in">
          {t("friends.signInFirst")}
        </p>
      </Group>
    );
  }
  const choices = friendChoices(settings);
  const change = (key: FriendSetting, on: boolean) => {
    for (const [name, value] of friendSwitchWrites(settings, key, on)) set(name, value);
    account.syncNow();
  };
  return (
    <Group title={t("friends.settings")} help={t("friends.settingsHelp")}>
      {choices.friends && (
        <>
          <Rows>
            <Switch label={t("friends.switchGive")} hint={t("friends.switchGiveHint")} checked={choices.friendsGive} onChange={(on) => change("friendsGive", on)} testId="friends-give" />
            {SUNSET_SWITCH_ROWS.filter(({ key }) => sunset.includes(key)).map(({ key, label, testId }) => (
              <Switch key={key} label={t(label)} checked={choices[key]} onChange={(on) => change(key, on)} testId={testId} />
            ))}
            {sunset.includes("friendsMessages") && <Switch label={t("chat.settingsSwitch")} checked={choices.friendsMessages} onChange={(on) => change("friendsMessages", on)} testId="friends-messages" />}
            {sunset.includes("newsPopups") && <Switch label={t("friends.popups")} hint={t("friends.popupsHelp")} checked={settings.newsPopups !== false} onChange={(on) => set("newsPopups", on ? undefined : false)} testId="news-popups-switch" />}
          </Rows>
          {/* (What a chat is kept as, said where friends are chosen: plain text, on the server, unencrypted, for so long.) */}
          <p className="muted small" data-testid="friends-messages-hint">
            {t("chat.settingsHint", CHAT_FACTS)}
          </p>
          <button className="btn btn-block" onClick={onOpen} data-testid="friends-open">
            <UsersIcon /> {t("friends.open")}
            {friends.state && <small>{t("friends.count", { count: friends.state.friends.length })}</small>}
          </button>
        </>
      )}
      {!choices.friends && <KeptFriends profileId={account.profile.id} />}
    </Group>
  );
}

/** What changes how the site looks and plays: language, colour, autoplay, subtitle languages. */
export function SettingsPage({ onOpenFriends, grownUp }: { onOpenFriends: () => void; /** Do it once the PIN of a child's profile is given (the account's screen asks for it). */ grownUp: (action: () => void) => void }) {
  const t = useT();
  const language = useLanguage();
  const { settings, set } = useSettings();
  const account = useAccount();
  const [linkBox, setLinkBox] = useLinkBox();
  const child = settings.child === true;
  return (
    <div className="page-stack" data-testid="settings-page">
      {/* (The groups of the TV's settings, in its order: the language and the colour are one card, as there.) */}
      <Group title={t("settings.appearance")}>
        <p className="group-label">{t("settings.language")}</p>
        <div className="segmented" role="radiogroup" aria-label={t("settings.language")}>
          {UI_LANGUAGES.map((code) => (
            <button key={code} role="radio" aria-checked={language === code} onClick={() => chooseLanguage(code)} data-testid={`lang-${code}`}>
              {LANGUAGE_NAMES[code]}
            </button>
          ))}
        </div>
        <p className="group-label">{t("settings.accent")}</p>
        <div className="swatches" role="radiogroup" aria-label={t("settings.accent")}>
          {ACCENTS.map((accent) => (
            <button
              key={accent}
              role="radio"
              aria-checked={(settings.accent ?? ACCENTS[0]) === accent}
              aria-label={t(`accent.${accent}`)}
              className="swatch"
              style={{ background: ACCENT_SWATCH[accent], color: ACCENT_INK[accent] }}
              onClick={() => chooseAccent(accent)}
              data-testid={`accent-${accent}`}
            >
              <CheckIcon />
            </button>
          ))}
        </div>
      </Group>
      <Group title={t("settings.playback")} help={t("settings.playbackHelp")}>
        <Rows>
          <Switch label={t("settings.autoplayNext")} checked={settings.autoplayNext ?? true} onChange={(on) => set("autoplayNext", on)} testId="autoplay-next" />
          <Switch label={t("settings.autoSkip")} checked={settings.autoSkip ?? false} onChange={(on) => set("autoSkip", on)} testId="auto-skip" />
        </Rows>
        <p className="group-label">{t("settings.animeAudio")}</p>
        <div className="segmented" role="radiogroup" aria-label={t("settings.animeAudio")}>
          <button
            role="radio"
            aria-checked={(settings.animeAudio ?? "jp") === "jp"}
            onClick={() => set("animeAudio", "jp")}
            data-testid="anime-audio-jp"
          >
            {t("settings.animeAudioJp")}
          </button>
          <button
            role="radio"
            aria-checked={settings.animeAudio === "eng"}
            onClick={() => set("animeAudio", "eng")}
            data-testid="anime-audio-eng"
          >
            {t("settings.animeAudioEng")}
          </button>
        </div>
      </Group>
      <SubtitleLanguages />
      {/* A child's profile: only cartoons for children, no friends and no watch party, wherever the profile is used (see the TV's Browse). Sent at once: the server turns the friends off. */}
      <Group title={t("settings.childGroup")} help={t("settings.childHelp")}>
        <Rows>
          <Switch
            label={t("settings.child")}
            checked={child}
            onChange={(on) => {
              const change = () => {
                set("child", on ? true : undefined);
                account.syncNow();
              };
              if (on) change();
              else grownUp(change); // (made an ordinary profile again: with the PIN, if there is one)
            }}
            testId="child-profile"
          />
        </Rows>
      </Group>
      {/* (Set from a grown-up's profile only; one that is there is changed or taken off with it, or the password, from any.) */}
      {account.me && account.profile && (!child || account.me.account.childPin) && <PinSetting />}
      <FriendsGroup onOpen={onOpenFriends} />
      {/* Labs: what few people use, or what is still being tried, last and together (each keeps what was chosen for it). */}
      <Group title={t("settings.labs")} help={t("settings.labsHelp")}>
        <Rows>
          <Switch label={t("settings.tapToPause")} hint={t("settings.tapToPauseHelp")} checked={settings.tapToPause ?? false} onChange={(on) => set("tapToPause", on)} testId="tap-to-pause" />
          <Switch label={t("settings.adaptiveQuality")} hint={t("settings.adaptiveQualityHelp")} checked={settings.adaptiveQuality !== false} onChange={(on) => set("adaptiveQuality", on ? undefined : false)} testId="adaptive-quality" />
          {/* (A child's profile has no box for links: see the Home of the remote.) */}
          {!child && <Switch label={t("settings.pasteLinkSwitch")} hint={t("settings.linkBoxHelp")} checked={linkBox} onChange={setLinkBox} testId="link-box-setting" />}
        </Rows>
      </Group>
      {account.me === null && <p className="muted small">{t("settings.signInToSave")}</p>}
    </div>
  );
}

/* ------------------------------ devices ------------------------------ */

const KIND_ICON = { tv: TvIcon, remote: PhoneIcon, browser: GlobeIcon } as const;

/** Where this account is signed in, with a way to sign any of them out (a TV left at a friend's, a lost phone). */
export function DevicesPage({ onChanged }: { /** Some of them were signed out. */ onChanged?: (() => void) | undefined }) {
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
      onChanged?.();
    } catch (cause) {
      setProblem(describeError(cause));
    }
  };
  const endOthers = async () => {
    try {
      await api.endOtherSessions();
      setNote(t("account.signedOutOthers"));
      onChanged?.();
      await load();
    } catch (cause) {
      setProblem(describeError(cause));
    }
  };

  // A device is called what its owner calls it (every row saying "Chrome on Windows" tells a TV from a laptop by its icon only).
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);
  const nameOf = (session: SessionInfo) => session.label || t(`device.${session.kind}`);
  const startRename = (session: SessionInfo) => {
    cancelled.current = false;
    setProblem(null);
    setDraft(nameOf(session));
    setRenaming(session.id);
  };
  const saveRename = async (session: SessionInfo) => {
    const label = draft.trim();
    setRenaming(null);
    if (cancelled.current || !label || label === nameOf(session)) return;
    try {
      setSessions(await api.renameSession(session.id, label));
    } catch (cause) {
      setProblem(describeError(cause));
    }
  };

  return (
    <section className="page-stack" data-testid="devices-page" aria-label={t("account.devicesHelp")}>
      <h3 className="sheet-section">{t("account.devicesHelp")}</h3>
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
                {renaming === session.id ? (
                  <input
                    className="device-name"
                    value={draft}
                    maxLength={DEVICE_NAME_MAX}
                    autoFocus
                    aria-label={t("account.deviceName")}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => void saveRename(session)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur(); // (done: the blur saves it)
                      else if (event.key === "Escape") {
                        event.stopPropagation(); // not the page's own Escape, which goes back
                        cancelled.current = true;
                        event.currentTarget.blur();
                      }
                    }}
                    data-testid="device-name-input"
                  />
                ) : (
                  <button className="device-name-button" onClick={() => startRename(session)} aria-label={t("account.renameDevice", { name: nameOf(session) })} data-testid="device-rename">
                    <b>{nameOf(session)}</b>
                    <PencilIcon />
                  </button>
                )}
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
    </section>
  );
}

/* ------------------------------ password and deleting ------------------------------ */

/** A password field with its label. */
function Password({ label, value, onChange, autoComplete, testId }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string; testId: string }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <PasswordInput autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} />
    </label>
  );
}

/**
 * The password, Google, and deleting the account. An account made with Google has no password to change, and is deleted once the person has signed in to Google again
 * (the page goes to Google, and the account is deleted when it comes back with Google's yes); one with a password can connect Google too, and sign in with either.
 */
export function SecurityPage({ onDeleted }: { onDeleted: () => void }) {
  const t = useT();
  const account = useAccount();
  const googleOnly = account.me?.account.googleOnly === true;
  const googleLinked = account.me?.account.google === true;
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
      setChangeProblem(describePasswordError(cause));
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
      await account.signOut({ deleted: true });
      onDeleted();
    } catch (cause) {
      setDeleteProblem(describePasswordError(cause));
      setBusy(false);
    }
  };

  return (
    <div className="page-stack" data-testid="security-page">
      {googleOnly ? (
        <Group title={t("account.google")}>
          <p className="muted" data-testid="google-only">
            {t("account.googleOnly")}
          </p>
        </Group>
      ) : (
        <form className="auth-form" onSubmit={change} noValidate>
          <Group title={t("account.password")}>
            <Password label={t("account.currentPassword")} value={current} onChange={setCurrent} autoComplete="current-password" testId="password-current" />
            <Password label={t("auth.newPassword")} value={next} onChange={setNext} autoComplete="new-password" testId="password-new" />
            <small className="muted">{t(next ? "auth.passwordHint" : "auth.noPasswordNote")}</small>
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
          <button type="submit" className="btn btn-block" disabled={busy || current === next} data-testid="password-save">
            {t("common.save")}
          </button>
        </form>
      )}

      {!googleOnly && (googleLinked || account.google) && (
        <Group title={t("account.google")} help={googleLinked ? undefined : t("account.googleConnectHelp")}>
          {googleLinked ? (
            <p className="auth-ok" role="status" data-testid="google-connected">
              <CheckIcon /> {t("account.googleConnected")}
            </p>
          ) : (
            <button type="button" className="google-btn" onClick={() => account.withGoogle("link")} data-testid="google-connect">
              <GoogleMark />
              <span>{t("account.googleConnect")}</span>
            </button>
          )}
        </Group>
      )}

      <Group title={deleting ? t("account.delete") : undefined}>
        {deleting && googleOnly ? (
          <div className="auth-form">
            <p className="muted">{t("account.deleteWarnGoogle")}</p>
            <div className="editor-actions">
              <button type="button" className="btn btn-danger" onClick={() => account.withGoogle("delete")} data-testid="delete-google">
                <TrashIcon /> {t("account.deleteWithGoogle")}
              </button>
              <button type="button" className="btn" onClick={() => setDeleting(false)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : deleting ? (
          <form className="auth-form" onSubmit={remove} noValidate>
            <p className="muted">{t("account.deleteWarn")}</p>
            <Password label={t("auth.password")} value={confirm} onChange={setConfirm} autoComplete="current-password" testId="delete-password" />
            {deleteProblem && (
              <p className="auth-error" role="alert" data-testid="delete-error">
                {deleteProblem}
              </p>
            )}
            <div className="editor-actions">
              <button type="submit" className="btn btn-danger" disabled={busy} data-testid="delete-confirm">
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
