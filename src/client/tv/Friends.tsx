import { useEffect, useRef, useState } from "react";
import { friendChoices, friendLink, parseTag, reachable, tagLabel, type FriendSetting, type Message, type OpenInvite, type Person } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { Avatar } from "../account/Avatar";
import { describeError } from "../account/errors";
import { useSettings } from "../account/settings";
import { formatDay } from "../account/time";
import { nameOf } from "../friends/entries";
import { useFriends } from "../friends/FriendsProvider";
import { bellRows, type BellRow } from "../friends/pages";
import { useAnswerRequests, useTagAsk } from "../friends/useRequests";
import { useBell } from "../friends/useBell";
import { usePeek } from "../friends/usePeek";
import { useLanguage, useT, type Key } from "../i18n";
import { CopyCode } from "../shared/CopyLink";
import { CheckIcon, PlayIcon, PlusIcon, SearchIcon, UsersIcon } from "../shared/icons";
import { linkCodeOf, typedLinkCode } from "../shared/launch";
import { QrCode } from "../shared/QrCode";
import { BackButton, Screen } from "./Idle";
import type { Entry } from "./pages";
import "./friends.css";

/** The pages friends need besides the library's own: sending to friends, adding one, and choosing what is shared. Each is a page the remote walks (see Idle.tsx). */

/* ------------------------------ sending to friends ------------------------------ */

/**
 * Choosing the friends a title, or an invitation to a watch party, goes to, and sending it: what the page below and the panel over a film
 * (Party.tsx) share. Only friends who take things are offered, and with just one she is chosen already; the server has the last word on
 * who gets it. `said` is what is told when it has gone.
 */
export function useFriendPicker({ build, said, onClose }: { build: () => Message; said: "friends.sent" | "friends.inviteSent"; onClose: () => void }) {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const all = friends.state?.friends ?? [];
  const takers = reachable(all);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(takers.length === 1 ? [takers[0]!.id] : []));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const toggle = (id: string) =>
    setPicked((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const send = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await friends.send([...picked], build());
      const names = (ids: readonly string[]) => ids.map((id) => nameOf(all, id)).filter(Boolean).join(", ");
      // (Both are told when some took it and some did not: the ones who did must not be sent it again.)
      const told: string[] = [];
      if (answer.sent.length > 0) told.push(t(said, { names: names(answer.sent) }));
      if (answer.declined.length > 0) told.push(t(answer.declined.length > 1 ? "friends.declinedMany" : "friends.declined", { names: names(answer.declined) }));
      if (told.length > 0) account.say(told.join(". "));
      onClose();
    } catch (error) {
      setProblem(describeError(error));
      setBusy(false);
    }
  };

  return { all, takers, picked, busy, problem, toggle, send };
}

/** The page that chooses the friends a title, or an invitation to a watch party, goes to. */
export function FriendPickerTv({ title, lead, build, said, onClose }: { title: string; lead: string; build: () => Message; said: "friends.sent" | "friends.inviteSent"; onClose: () => void }) {
  const t = useT();
  const { all, takers, picked, busy, problem, toggle, send } = useFriendPicker({ build, said, onClose });

  return (
    <Screen testId="tv-friend-picker" compact focus onBack={onClose}>
      <h1 className="tv-headline tv-headline-small">{title}</h1>
      <p className="tv-lead">{lead}</p>
      {takers.length === 0 ? (
        <>
          <p className="tv-hint" data-testid="tv-friend-picker-none">
            {all.length === 0 ? t("friends.noFriends") : t("friends.nobody")}
          </p>
          <div className="tv-actions">
            <button className="tv-action tv-action-primary" onClick={onClose} data-nav data-autofocus data-testid="tv-friend-cancel">
              {t("common.done")}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="tv-list-picks" role="group" aria-label={title}>
            {takers.map((friend) => (
              <button key={friend.id} className="tv-action" aria-pressed={picked.has(friend.id)} onClick={() => toggle(friend.id)} data-nav data-testid="tv-friend-pick" data-friend={friend.id}>
                {picked.has(friend.id) ? <CheckIcon /> : <PlusIcon />} {friend.name}
              </button>
            ))}
          </div>
          {problem && (
            <p className="tv-lead tv-signin-status is-problem" role="alert">
              {problem}
            </p>
          )}
          <div className="tv-actions">
            <button className="tv-action tv-action-primary" disabled={busy || picked.size === 0} onClick={() => void send()} data-nav data-testid="tv-friend-send">
              {t("friends.send")}
            </button>
            <button className="tv-action" onClick={onClose} data-nav data-testid="tv-friend-cancel">
              {t("common.cancel")}
            </button>
          </div>
        </>
      )}
    </Screen>
  );
}

/* ------------------------------ adding a friend ------------------------------ */

/** How the copy button joins the remote's arrow keys, as the page's other buttons do (`data-nav`: see dpad.ts). */
const PAGE_NAV = { "data-nav": true };

/**
 * A code made for a friend: the code, the QR code that carries its link, and a way to take it back. One is made as the page opens, when
 * there is none. When the code that was on the page is gone and there is a friend more than when it came up, a friend has used it: that
 * is all it was for. A code that went another way (taken back on a phone, run out) is made again.
 */
function GiveCode({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const t = useT();
  const language = useLanguage();
  const friends = useFriends();
  const [problem, setProblem] = useState<string | null>(null);
  const asked = useRef(false);
  const shown = useRef(false);
  const takingBack = useRef(false);
  const codeText = useRef<HTMLParagraphElement>(null);
  /** How many friends there were when the first code came up. */
  const friendsThen = useRef(0);
  const friendCount = friends.state?.friends.length ?? 0;
  const invite = (friends.state?.invites ?? []).reduce<OpenInvite | undefined>((newest, each) => (!newest || each.expiresAt > newest.expiresAt ? each : newest), undefined);

  // (this one first: a code that is gone makes the next effect ask for another in the same moment)
  useEffect(() => {
    if (shown.current && !takingBack.current && friendCount > friendsThen.current) {
      onDone();
    } else if (invite) {
      if (!shown.current) friendsThen.current = friendCount;
      shown.current = true;
    } else if (shown.current && !takingBack.current) {
      shown.current = false;
      asked.current = false;
    }
  }, [invite?.code]);
  useEffect(() => {
    if (invite || asked.current || !friends.state) return;
    asked.current = true;
    friends.invite().catch((error: unknown) => setProblem(describeError(error)));
  }, [invite, friends.state]);

  return (
    <Screen key="give" testId="tv-friend-give-page" compact focus onBack={onBack}>
      <h1 className="tv-headline tv-headline-small">{t("friends.makeCode")}</h1>
      {invite ? (
        <div className="tv-pair tv-party-invite">
          <div className="tv-friend-code">
            <p className="tv-code tv-link-code copy-code-text" ref={codeText} data-testid="tv-friend-code">
              {typedLinkCode(invite.code)}
            </p>
            <CopyCode code={typedLinkCode(invite.code)} shown={codeText} testId="tv-friend-code-copy" buttonClass="tv-action" nav={PAGE_NAV} />
            <p className="tv-hint">{t("friends.codeHelp", { day: formatDay(invite.expiresAt, language) })}</p>
          </div>
          <div className="tv-qr">
            <QrCode value={friendLink(invite.code, location.origin)} label={t("friends.qrLabel")} />
            <p>{t("friends.qrHint")}</p>
          </div>
        </div>
      ) : problem ? (
        <p className="tv-lead tv-signin-status is-problem" role="alert">
          {problem}
        </p>
      ) : (
        <p className="tv-lead" role="status">
          <span className="spinner" /> {t("common.loading")}
        </p>
      )}
      <div className="tv-actions">
        <button className="tv-action tv-action-primary" onClick={onBack} data-nav data-autofocus data-testid="tv-friend-give-done">
          {t("common.done")}
        </button>
        {invite && (
          <button
            className="tv-action"
            onClick={() => {
              takingBack.current = true;
              void friends.revoke(invite.code).then(onBack, () => (takingBack.current = false));
            }}
            data-nav
            data-testid="tv-friend-revoke"
          >
            {t("friends.takeBack")}
          </button>
        )}
      </div>
    </Screen>
  );
}

/** A friend's code that was typed in full: who it is from, and a button that makes the two of them friends. */
function TypedCode({ code, onDone }: { code: string; onDone: () => void }) {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const { seen, problem: found } = usePeek(code);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = refused ?? found;

  const add = async () => {
    setBusy(true);
    setRefused(null);
    try {
      const friend = await friends.accept(code);
      account.say(t("friends.added", { name: friend.name }));
      onDone();
    } catch (error) {
      setRefused(describeError(error));
      setBusy(false);
    }
  };

  if (problem) {
    return (
      <p className="tv-lead tv-signin-status is-problem" role="alert" data-testid="tv-friend-code-error">
        {problem}
      </p>
    );
  }
  if (!seen) {
    return (
      <p className="tv-lead" role="status">
        <span className="spinner" /> {t("friends.linkLooking")}
      </p>
    );
  }
  return (
    <div className="tv-friend-found" data-testid="tv-friend-found">
      <Avatar id={seen.from.avatar} className="tv-friend-avatar" />
      <p className="tv-friend-ask">
        <b data-testid="tv-friend-code-name">{seen.from.name}</b>
        <span>{t("friends.addAsk")}</span>
      </p>
      <button className="tv-action tv-action-primary" disabled={busy} onClick={() => void add()} data-nav data-testid="tv-friend-code-add">
        {t("friends.addButton")}
      </button>
    </div>
  );
}

/** Typing the code a friend gave: on a keyboard, or the TV's own. Once all of it is there, who it is from is asked. */
function TypeCode({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const code = linkCodeOf(typed);
  return (
    <Screen key="type" testId="tv-friend-type-page" compact focus onBack={onBack}>
      <h1 className="tv-headline tv-headline-small">{t("friends.typeTitle")}</h1>
      <form className="auth-form auth-tv" onSubmit={(event) => event.preventDefault()} noValidate>
        <label className="auth-field">
          <span>{t("friends.codeLabel")}</span>
          <input
            className="tv-link-input"
            data-testid="tv-friend-code-input"
            data-nav
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={9}
            placeholder="ABCD-2345"
            value={typed}
            onChange={(event) => setTyped(typedLinkCode(event.target.value))}
          />
        </label>
      </form>
      {code && <TypedCode key={code} code={code} onDone={onDone} />}
      <BackButton onClick={onBack} testId="tv-friend-type-back" />
    </Screen>
  );
}

/** Somebody found by their tag: who it is, and the button that asks them to be friends (they have to say yes). */
function TaggedFriend({ text, onDone }: { text: string; onDone: () => void }) {
  const t = useT();
  const { seen, problem, waiting, busy, send } = useTagAsk(text, onDone);
  if (problem) {
    return (
      <p className="tv-lead tv-signin-status is-problem" role="alert" data-testid="tv-friend-tag-error">
        {problem}
      </p>
    );
  }
  if (!seen) {
    return (
      <p className="tv-lead" role="status">
        <span className="spinner" /> {t("friends.linkLooking")}
      </p>
    );
  }
  return (
    <div className="tv-friend-found" data-testid="tv-friend-tag-found">
      <Avatar id={seen.avatar} className="tv-friend-avatar" />
      <p className="tv-friend-ask">
        <b data-testid="tv-friend-tag-name">{tagLabel(seen.name, seen.tag)}</b>
        <span>{t("friends.tagAsk")}</span>
      </p>
      <button className="tv-action tv-action-primary" disabled={busy || waiting} onClick={() => void send()} data-nav data-testid="tv-friend-tag-send">
        {waiting ? t("friends.requestPending") : t("friends.requestButton")}
      </button>
    </div>
  );
}

/** Typing the tag of a friend ("Sam#2"), on a keyboard or the TV's own. It is looked for when asked to (a tag is complete only when its owner says so). */
function TypeTag({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [looked, setLooked] = useState("");
  const wanted = parseTag(typed);
  const find = () => wanted && setLooked(typed.trim());
  return (
    <Screen key="tag" testId="tv-friend-tag-page" compact focus onBack={onBack}>
      <h1 className="tv-headline tv-headline-small">{t("friends.tagTitle")}</h1>
      <form
        className="auth-form auth-tv"
        onSubmit={(event) => {
          event.preventDefault();
          find();
        }}
        noValidate
      >
        <label className="auth-field">
          <span>{t("friends.tagLabel")}</span>
          <input
            className="tv-tag-input"
            data-testid="tv-friend-tag-input"
            data-nav
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={30}
            placeholder={t("friends.tagPlaceholder")}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setLooked("");
            }}
          />
        </label>
      </form>
      {looked && <TaggedFriend key={looked} text={looked} onDone={onDone} />}
      <div className="tv-actions">
        <button className="tv-action tv-action-primary" disabled={!wanted} onClick={find} data-nav data-testid="tv-friend-tag-find">
          {t("friends.tagFind")}
        </button>
      </div>
      <BackButton onClick={onBack} testId="tv-friend-tag-back" />
    </Screen>
  );
}

/** The ways of becoming friends: make a code to give, type the one that was given, or find somebody by their tag. */
export function AddFriendTv({ onClose }: { onClose: () => void }) {
  const t = useT();
  const account = useAccount();
  const [mode, setMode] = useState<"choose" | "give" | "type" | "tag">("choose");
  if (mode === "give") return <GiveCode onBack={() => setMode("choose")} onDone={onClose} />;
  if (mode === "type") return <TypeCode onBack={() => setMode("choose")} onDone={onClose} />;
  if (mode === "tag") return <TypeTag onBack={() => setMode("choose")} onDone={onClose} />;
  const mine = account.profile?.tag !== undefined ? tagLabel(account.profile.name, account.profile.tag) : undefined;
  return (
    <Screen key="choose" testId="tv-add-friend" focus onBack={onClose}>
      <h1 className="tv-headline">{t("friends.add")}</h1>
      <div className="tv-party-choices tv-friend-choices">
        <button className="tv-party-choice" onClick={() => setMode("give")} data-nav data-testid="tv-friend-give">
          <UsersIcon />
          <b>{t("friends.makeCode")}</b>
          <small>{t("friends.giveHint")}</small>
        </button>
        <button className="tv-party-choice" onClick={() => setMode("type")} data-nav data-testid="tv-friend-type">
          <UsersIcon />
          <b>{t("friends.typeTitle")}</b>
          <small>{t("friends.typeHint")}</small>
        </button>
        <button className="tv-party-choice" onClick={() => setMode("tag")} data-nav data-testid="tv-friend-tag">
          <SearchIcon />
          <b>{t("friends.tagTitle")}</b>
          <small>{t("friends.tagHint")}</small>
        </button>
      </div>
      {mine && (
        <p className="tv-hint" data-testid="tv-your-tag">
          {t("friends.yourTag")}: <b>{mine}</b>
        </p>
      )}
      <BackButton onClick={onClose} testId="tv-friend-add-back" />
    </Screen>
  );
}

/* ------------------------------ a request to be friends ------------------------------ */

/** Somebody asked to be friends (a tile of the friends page): who, and the buttons that say yes or no. Back keeps it waiting. */
export function FriendRequestTv({ person, onClose }: { person: Person; onClose: () => void }) {
  const t = useT();
  const answer = useAnswerRequests();
  const [busy, setBusy] = useState(false);
  const respond = async (work: Promise<void>) => {
    setBusy(true);
    await work;
    onClose();
  };
  return (
    <Screen testId="tv-friend-request" compact focus onBack={onClose}>
      <div className="tv-friend-found">
        <Avatar id={person.avatar} className="tv-friend-avatar" />
        <p className="tv-friend-ask">
          <b data-testid="tv-friend-request-name">{tagLabel(person.name, person.tag)}</b>
          <span>{t("friends.requestWants")}</span>
        </p>
      </div>
      <div className="tv-actions">
        <button className="tv-action tv-action-primary" disabled={busy} onClick={() => void respond(answer.accept(person))} data-nav data-autofocus data-testid="tv-friend-request-accept">
          {t("friends.accept")}
        </button>
        <button className="tv-action" disabled={busy} onClick={() => void respond(answer.decline(person))} data-nav data-testid="tv-friend-request-decline">
          {t("friends.decline")}
        </button>
      </div>
      <BackButton onClick={onClose} testId="tv-friend-request-back" />
    </Screen>
  );
}

/* ------------------------------ the bell ------------------------------ */

/** A line of the bell's list: pressing it does what pressing the same tile of the friends page does. */
function BellLine({ row, onPress }: { row: BellRow; onPress: (entry: Entry) => void }) {
  const { entry } = row;
  return (
    <li>
      <button className="tv-bell-line" onClick={() => onPress(entry)} data-nav data-testid="tv-bell-item" data-entry={entry.id}>
        <span className="tv-bell-icon">{row.avatar ? <Avatar id={row.avatar} className="tv-bell-avatar" /> : entry.party || entry.wants || entry.ask ? <UsersIcon /> : <PlayIcon />}</span>
        <span className="tv-bell-text">
          <b>{row.heading}</b>
          {row.detail && <small>{row.detail}</small>}
        </span>
      </button>
    </li>
  );
}

/**
 * What the bell opens on a TV: what waits for an answer, then what friends watch lately, a few of each, and a way on to the Friends page for the
 * rest. Pressing a line does what the same tile of the Friends page does (`onPress` is that); Back shuts the list. Opening it is looking.
 */
export function NotificationsTv({ onPress, onFriends, onClose }: { onPress: (entry: Entry) => void; onFriends: () => void; onClose: () => void }) {
  const t = useT();
  const friends = useFriends();
  const { markSeen } = useBell();
  const { waiting, lately, more } = bellRows(friends.state, Date.now());

  useEffect(() => {
    void friends.refresh();
    markSeen();
  }, []);
  useEffect(() => {
    if (friends.unread > 0) void friends.markRead().catch(() => undefined);
  }, [friends.unread]);

  return (
    <Screen testId="tv-bell-page" compact focus onBack={onClose}>
      <h1 className="tv-headline tv-headline-small">{t("bell.title")}</h1>
      {!friends.state ? (
        <p className="tv-lead" role="status">
          <span className="spinner" /> {friends.status === "offline" ? t("friends.offline") : t("common.loading")}
        </p>
      ) : waiting.length === 0 && lately.length === 0 ? (
        <p className="tv-lead" data-testid="tv-bell-empty">
          {t("bell.empty")}
        </p>
      ) : (
        <div className="tv-bell-lists">
          {waiting.length > 0 && (
            <section>
              <h2 className="tv-bell-heading">{t("bell.waiting")}</h2>
              <ul className="tv-bell-list" data-testid="tv-bell-waiting">
                {waiting.map((row) => (
                  <BellLine key={row.entry.id} row={row} onPress={onPress} />
                ))}
              </ul>
              {more > 0 && (
                <p className="tv-hint" data-testid="tv-bell-more">
                  {t("bell.more", { count: more })}
                </p>
              )}
            </section>
          )}
          {lately.length > 0 && (
            <section>
              <h2 className="tv-bell-heading">{t("friends.activity")}</h2>
              <ul className="tv-bell-list" data-testid="tv-bell-lately">
                {lately.map((row) => (
                  <BellLine key={row.entry.id} row={row} onPress={onPress} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      <div className="tv-actions">
        <button className="tv-action tv-action-primary" onClick={onFriends} data-nav data-testid="tv-bell-friends">
          {t("bell.openFriends")}
        </button>
      </div>
      <BackButton onClick={onClose} testId="tv-bell-back" />
    </Screen>
  );
}

/* ------------------------------ taking a friend off ------------------------------ */

/** The question before a friend is taken off the friends. Cancel is where the remote starts, so an OK pressed by mistake keeps them. */
export function UnfriendTv({ id, name, onCancel, onGone }: { id: string; name: string; onCancel: () => void; onGone: () => void }) {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await friends.remove(id);
      account.say(t("friends.removed", { name }));
      onGone();
    } catch (error) {
      setProblem(describeError(error));
      setBusy(false);
    }
  };

  return (
    <Screen testId="tv-friend-unfriend" compact focus onBack={onCancel}>
      <h1 className="tv-headline tv-headline-small">{t("friends.removeTitle", { name })}</h1>
      <p className="tv-lead tv-friend-help">{t("friends.removeHelp")}</p>
      {problem && (
        <p className="tv-lead tv-signin-status is-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="tv-actions">
        <button className="tv-action tv-action-primary" onClick={onCancel} data-nav data-autofocus data-testid="tv-friend-unfriend-cancel">
          {t("common.cancel")}
        </button>
        <button className="tv-action tv-action-danger" disabled={busy} onClick={() => void remove()} data-nav data-testid="tv-friend-unfriend-yes">
          {t("friends.removeYes")}
        </button>
      </div>
    </Screen>
  );
}

/* ------------------------------ what is shared ------------------------------ */

/** What a friend may do while friends are on, each its own switch (the one that turns friends on or off is in the settings). */
const SWITCHES: ReadonlyArray<{ key: FriendSetting; label: Key; testId: string }> = [
  { key: "friendsLists", label: "friends.switchLists", testId: "tv-friends-lists" },
  { key: "friendsRatings", label: "friends.switchRatings", testId: "tv-friends-ratings" },
  { key: "friendsGive", label: "friends.switchGive", testId: "tv-friends-give" },
  { key: "friendsGet", label: "friends.switchGet", testId: "tv-friends-get" },
  { key: "friendsInbox", label: "friends.switchInbox", testId: "tv-friends-inbox" },
  { key: "friendsPresence", label: "friends.switchPresence", testId: "tv-friends-presence" },
];

/** Choosing what friends may see and send, and whether what each watches is told. Each change reaches the server at once: it is what decides what a friend is shown. */
export function FriendSettingsTv({ onClose }: { onClose: () => void }) {
  const t = useT();
  const account = useAccount();
  const { settings, set } = useSettings();
  const choices = friendChoices(settings);
  return (
    <Screen testId="tv-friend-settings" compact focus onBack={onClose}>
      <h1 className="tv-headline tv-headline-small">{t("friends.settings")}</h1>
      <p className="tv-hint tv-friend-help">{t("friends.settingsHelp")}</p>
      <div className="tv-friend-switches">
        {SWITCHES.filter(({ key }) => key !== "friendsRatings" || settings.ratings !== false).map(({ key, label, testId }) => (
          <button
            key={key}
            className="tv-switch-row"
            role="switch"
            aria-checked={choices[key]}
            onClick={() => {
              set(key, !choices[key]);
              account.syncNow();
            }}
            data-nav
            data-testid={testId}
          >
            <span>{t(label)}</span>
            <span className="tv-switch" aria-hidden="true" />
          </button>
        ))}
        {/* (What this screen does with friends' news, not what a friend may do: it stays on this side and is not sent to the server.) */}
        <button
          className="tv-switch-row"
          role="switch"
          aria-checked={settings.newsPopups !== false}
          onClick={() => set("newsPopups", settings.newsPopups === false ? undefined : false)}
          data-nav
          data-testid="tv-friends-popups"
        >
          <span>{t("friends.popups")}</span>
          <span className="tv-switch" aria-hidden="true" />
        </button>
      </div>
      <div className="tv-actions">
        <button className="tv-action tv-action-primary" onClick={onClose} data-nav data-testid="tv-friend-settings-done">
          {t("common.done")}
        </button>
      </div>
    </Screen>
  );
}
