import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ACCENTS, DEVICE_NAME_MAX, friendChoices, preferredLanguages, UI_LANGUAGES, type FriendSetting, type KeptFriend, type SessionInfo } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { api } from "../account/api";
import { Avatar } from "../account/Avatar";
import { describeError } from "../account/errors";
import { PasswordInput } from "../account/PasswordInput";
import { chooseAccent, chooseLanguage, useSettings } from "../account/settings";
import { ACCENT_INK, ACCENT_SWATCH } from "../account/theme";
import { ago } from "../account/time";
import { friendsApi } from "../friends/api";
import { useFriends } from "../friends/FriendsProvider";
import { LANGUAGE_NAMES, useLanguage, useT, type Key } from "../i18n";
import { CheckIcon, CloseIcon, GlobeIcon, PencilIcon, PhoneIcon, PlusIcon, ScanIcon, TrashIcon, TvIcon, UsersIcon } from "../shared/icons";
import { linkCodeOf, typedLinkCode } from "../shared/launch";
import { useLinkBox } from "../shared/linkBox";
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
    </Group>
  );
}

/** What a friend may do while friends are on, each its own switch. */
const FRIEND_SWITCHES: ReadonlyArray<{ key: FriendSetting; label: Key; testId: string }> = [
  { key: "friendsLists", label: "friends.switchLists", testId: "friends-lists" },
  { key: "friendsRatings", label: "friends.switchRatings", testId: "friends-ratings" },
  { key: "friendsGive", label: "friends.switchGive", testId: "friends-give" },
  { key: "friendsGet", label: "friends.switchGet", testId: "friends-get" },
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
 * Friends: the master switch and, once it is on, what friends may see and send and whether what each watches is told. These are
 * settings of the profile (so they follow it onto every screen), and each change is sent to the server at once: the server is
 * what decides what a friend is shown, from what the profile has chosen here.
 */
function FriendsGroup({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const { settings, set } = useSettings();
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
    set(key, on);
    account.syncNow();
  };
  return (
    <Group title={t("friends.settings")} help={t("friends.settingsHelp")}>
      <Switch label={t("friends.switch")} checked={choices.friends} onChange={(on) => change("friends", on)} testId="friends-switch" />
      {choices.friends && (
        <>
          {FRIEND_SWITCHES.filter(({ key }) => key !== "friendsRatings" || settings.ratings !== false).map(({ key, label, testId }) => (
            <Switch key={key} label={t(label)} checked={choices[key]} onChange={(on) => change(key, on)} testId={testId} />
          ))}
          <Switch label={t("friends.popups")} checked={settings.newsPopups !== false} onChange={(on) => set("newsPopups", on ? undefined : false)} testId="news-popups-switch" />
          <p className="muted small">{t("friends.popupsHelp")}</p>
          <button className="btn btn-block" onClick={onOpen} data-testid="friends-open">
            <UsersIcon /> {t("friends.open")}
            {friends.state && <small>{t("friends.count", { count: friends.state.friends.length })}</small>}
          </button>
        </>
      )}
      {!choices.friends && settings.friends === false && <KeptFriends profileId={account.profile.id} />}
    </Group>
  );
}

/** What changes how the site looks and plays: language, colour, autoplay, subtitle languages. */
export function SettingsPage({ onOpenFriends }: { onOpenFriends: () => void }) {
  const t = useT();
  const language = useLanguage();
  const { settings, set } = useSettings();
  const account = useAccount();
  const [linkBox, setLinkBox] = useLinkBox();
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
        <Switch label={t("settings.autoplayNext")} checked={settings.autoplayNext ?? true} onChange={(on) => set("autoplayNext", on)} testId="autoplay-next" />
        <Switch label={t("settings.tapToPause")} checked={settings.tapToPause ?? false} onChange={(on) => set("tapToPause", on)} testId="tap-to-pause" />
        <p className="muted small">{t("settings.tapToPauseHelp")}</p>
        <Switch label={t("settings.adaptiveQuality")} checked={settings.adaptiveQuality !== false} onChange={(on) => set("adaptiveQuality", on ? undefined : false)} testId="adaptive-quality" />
        <p className="muted small">{t("settings.adaptiveQualityHelp")}</p>
      </Group>
      <Group title={t("settings.pasteLink")} help={t("settings.linkBoxHelp")}>
        <Switch label={t("settings.pasteLinkSwitch")} checked={linkBox} onChange={setLinkBox} testId="link-box-setting" />
      </Group>
      <Group title={t("rating.settings")} help={t("rating.settingsHelp")}>
        <Switch label={t("rating.settingsSwitch")} checked={settings.ratings ?? true} onChange={(on) => set("ratings", on)} testId="ratings-switch" />
      </Group>
      <FriendsGroup onOpen={onOpenFriends} />
      <SubtitleLanguages />
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
    </div>
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
