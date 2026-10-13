import { useEffect, useRef, useState } from "react";
import { canAskTogether, FRIEND_NOTE_MAX, friendLink, partyOpen, reachable, type Friend, type FriendLists, type FriendProgress, type FriendRatings, type InboxItem, type Message, type OpenInvite } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { Avatar } from "../account/Avatar";
import { describeError } from "../account/errors";
import { useScores } from "../account/ratings";
import { factLines, scoreOf, scoreWord, sortRatings, storedFacts } from "../account/ratingText";
import { useSettings } from "../account/settings";
import { ago, formatDay } from "../account/time";
import { entriesOfList, entryOfActivity, entryOfRecommendation, friendLine, listsOf, nameOf, progressFor, progressNote, ratedBy, recommendationOf, withProgress, type PartyInvitation, type Recommendation, type TogetherRequest } from "../friends/entries";
import { useFriends } from "../friends/FriendsProvider";
import { usePeek } from "../friends/usePeek";
import { askLists, askRatings, useShared } from "../friends/useShared";
import { useLanguage, useT } from "../i18n";
import { CopyCode, CopyLink } from "../shared/CopyLink";
import { formatCode } from "../shared/format";
import { ChevronIcon, CloseIcon, PlusIcon, StarIcon, UsersIcon } from "../shared/icons";
import { linkCodeOf, partyLink, typedLinkCode } from "../shared/launch";
import { Poster } from "../shared/Poster";
import { QrCode } from "../shared/QrCode";
import { entryOfRating, type Entry } from "../tv/pages";
import { listName } from "../account/cards";
import { Group } from "./AccountPages";
import { Sheet } from "./Sheet";
import { Card, CardRow } from "./Rows";
import "./friends.css";

/** What a screen does with a title somebody opened (nothing, on a phone that has no TV to play it on). */
type OpenTitle = ((entry: Entry) => void) | undefined;

/* ------------------------------ a code, looked up ------------------------------ */

/** A friend's code, looked up: who it is from, and the button that makes the two of them friends. */
function CodeCard({ code, onDone }: { code: string; onDone: () => void }) {
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
      <p className="auth-error" role="alert" data-testid="friend-code-error">
        {problem}
      </p>
    );
  }
  if (!seen) {
    return (
      <p className="muted" role="status">
        <span className="spinner" /> {t("friends.linkLooking")}
      </p>
    );
  }
  return (
    <div className="friend-code-card" data-testid="friend-code-card">
      <Avatar id={seen.from.avatar} className="friend-avatar" />
      <span className="friend-text">
        <b data-testid="friend-code-name">{seen.from.name}</b>
        <small>{t("friends.addAsk")}</small>
      </span>
      <button className="btn btn-red" disabled={busy} onClick={() => void add()} data-testid="friend-code-add">
        {t("friends.addButton")}
      </button>
    </div>
  );
}

/** The sheet a friend's link opens (`/?friend=ABCD2345`): sign in if need be, turn friends on if need be, then who it is from and a button to add them. */
export function FriendInvite({ code, onClose, onSignIn }: { code: string; onClose: () => void; onSignIn: () => void }) {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const { set } = useSettings();
  const signedIn = account.me !== null && account.profile !== null;

  return (
    <Sheet title={t("friends.linkTitle")} onClose={onClose} testId="friend-link-sheet">
      {!signedIn ? (
        <>
          <p className="muted">{t("friends.linkSignIn")}</p>
          <button className="btn btn-red btn-block" onClick={onSignIn} data-testid="friend-link-signin">
            {t("account.signInPrompt")}
          </button>
        </>
      ) : !friends.on ? (
        <>
          <p className="muted">{t("friends.linkTurnOn")}</p>
          <button
            className="btn btn-red btn-block"
            onClick={() => {
              set("friends", true);
              account.syncNow();
            }}
            data-testid="friend-link-turn-on"
          >
            {t("friends.linkTurnOnButton")}
          </button>
        </>
      ) : friends.status === "ready" ? (
        <CodeCard code={code} onDone={onClose} />
      ) : friends.status === "offline" ? (
        <p className="auth-error" role="alert">
          {t("friends.offline")}
        </p>
      ) : (
        <p className="muted" role="status">
          <span className="spinner" /> {t("friends.linkLooking")}
        </p>
      )}
      <button className="btn btn-block" onClick={onClose} data-testid="friend-link-later">
        {t("friends.linkNotNow")}
      </button>
    </Sheet>
  );
}

/* ------------------------------ adding a friend ------------------------------ */

/** A code made for a friend: the code, a QR code and a link to send, and a way to take it back. */
function InviteCard({ invite }: { invite: OpenInvite }) {
  const t = useT();
  const language = useLanguage();
  const friends = useFriends();
  const link = friendLink(invite.code, location.origin);
  const code = typedLinkCode(invite.code);
  const codeText = useRef<HTMLSpanElement>(null);
  const canShare = typeof navigator.share === "function";
  const share = () => navigator.share({ title: t("friends.shareTitle"), url: link }).catch(() => undefined); // (a share sheet that was closed is no error)

  return (
    <div className="code-card" data-testid="friend-invite">
      <div className="code-card-top">
        <div className="friend-code-side">
          <span className="code-card-code friend-code copy-code-text" ref={codeText} data-testid="friend-invite-code">
            {code}
          </span>
          <CopyCode code={code} shown={codeText} testId="friend-invite-code-copy" buttonClass="btn" />
        </div>
        <QrCode value={link} label={t("friends.qrLabel")} />
      </div>
      <p className="muted small">{t("friends.codeHelp", { day: formatDay(invite.expiresAt, language) })}</p>
      <CopyLink link={link} testId="friend-link" buttonClass={canShare ? "btn" : "btn btn-red"} />
      {canShare && (
        <button className="btn btn-red btn-block" onClick={() => void share()} data-testid="friend-share">
          {t("party.share")}
        </button>
      )}
      <button className="btn btn-block" onClick={() => void friends.revoke(invite.code).catch(() => undefined)} data-testid="friend-invite-revoke">
        {t("friends.takeBack")}
      </button>
    </div>
  );
}

/** Both ways of becoming friends: make a code to give, or type the one you were given. */
function AddFriend() {
  const t = useT();
  const friends = useFriends();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const code = linkCodeOf(typed);

  const make = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await friends.invite();
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title={t("friends.add")}>
      {(friends.state?.invites ?? []).map((invite) => (
        <InviteCard key={invite.code} invite={invite} />
      ))}
      <button className="btn btn-block" disabled={busy} onClick={() => void make()} data-testid="friend-make-code">
        <PlusIcon /> {t("friends.makeCode")}
      </button>
      {problem && (
        <p className="auth-error" role="alert" data-testid="friend-invite-error">
          {problem}
        </p>
      )}
      <label className="auth-field">
        <span>{t("friends.enterCode")}</span>
        <input
          className="code-input link-code-input"
          data-testid="friend-code-input"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={9}
          placeholder="ABCD-2345"
          aria-label={t("friends.codeLabel")}
          value={typed}
          onChange={(event) => setTyped(typedLinkCode(event.target.value))}
        />
      </label>
      {code && <CodeCard key={code} code={code} onDone={() => setTyped("")} />}
    </Group>
  );
}

/* ------------------------------ the page of friends ------------------------------ */

/** A friend's picture, with a small green dot on it while they are online. */
function FriendPic({ friend, size }: { friend: Friend; size?: "big" }) {
  return (
    <span className={size ? `friend-pic ${size}` : "friend-pic"} data-online={friend.on && friend.online === true}>
      <Avatar id={friend.avatar} />
    </span>
  );
}

/**
 * Asks a friend to watch together: they get a request with a button that starts a party and invites this profile to it. `ended` is the
 * invitation to a party that is over, if that is where this was pressed: once the friend is asked it is of no more use.
 */
function useAskTogether(): (friendId: string, ended?: string) => Promise<void> {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  return async (friendId, ended) => {
    const name = nameOf(friends.state?.friends ?? [], friendId);
    try {
      const answer = await friends.send([friendId], { kind: "together" });
      account.say(answer.sent.length > 0 ? t("friends.askSent", { name }) : t("friends.declined", { names: name }));
      if (answer.sent.length > 0 && ended) await friends.dismiss(ended);
    } catch (error) {
      account.say(describeError(error));
    }
  };
}

function InboxRow({ item, friend, onOpenTitle, onStartParty, onDismiss }: { item: InboxItem; friend: Friend | undefined; onOpenTitle: OpenTitle; onStartParty: ((friendId: string) => void) | undefined; onDismiss: () => void }) {
  const t = useT();
  const language = useLanguage();
  const ask = useAskTogether();
  const now = Date.now();
  const from = friend?.name ?? "";
  const dismiss = (
    <button className="mini" onClick={onDismiss} aria-label={t("friends.dismiss")} data-testid="inbox-dismiss">
      <CloseIcon />
    </button>
  );

  if (item.kind === "party") {
    const live = partyOpen(item, now);
    return (
      <li className="inbox-item" data-testid="inbox-party">
        <span className="inbox-text">
          <b>{t("friends.partyInvite", { name: from })}</b>
          <small>{live ? `${formatCode(item.code)} · ${ago(item.at, now, language)}` : t("friends.partyOver")}</small>
        </span>
        {live && (
          <a className="btn btn-red" href={partyLink(item.code)} data-testid="inbox-join">
            {t("friends.join")}
          </a>
        )}
        {/* (A party that is over becomes a question: can they start another, for the two of them?) */}
        {!live && friend && canAskTogether(friend) && (
          <button className="btn btn-red" onClick={() => void ask(friend.id, item.id)} data-testid="inbox-ask">
            {t("friends.askTogether")}
          </button>
        )}
        {dismiss}
      </li>
    );
  }
  if (item.kind === "together") {
    return (
      <li className="inbox-item" data-testid="inbox-together">
        <span className="inbox-text">
          <b>{t("friends.togetherOf", { name: from })}</b>
          <small>{ago(item.at, now, language)}</small>
        </span>
        {onStartParty && (
          <button className="btn btn-red" onClick={() => onStartParty(item.from)} data-testid="inbox-start">
            {t("friends.startParty")}
          </button>
        )}
        {dismiss}
      </li>
    );
  }
  const entry = entryOfRecommendation(item, from);
  return (
    <li className="inbox-item" data-testid="inbox-recommendation">
      <button className="rating-item inbox-open" onClick={() => onOpenTitle?.(entry)} aria-label={`${t("rows.open")} ${item.title}`} data-testid="inbox-open">
        <Poster className="lib-result-art" title={item.title} image={item.backdrop ?? item.image} />
        <span className="rating-text">
          <span className="rating-name">{item.title}</span>
          <span className="muted small">{`${t("friends.from", { name: from })} · ${ago(item.at, now, language)}`}</span>
          {item.note && <span className="rating-quote">{item.note}</span>}
        </span>
      </button>
      {dismiss}
    </li>
  );
}

/** Everything friends: what they sent, who they are, what they are watching, and how to add another. */
export function FriendsPage({ onOpenFriend, onOpenTitle, onStartParty }: { onOpenFriend: (id: string) => void; onOpenTitle: OpenTitle; onStartParty?: (friendId: string) => void }) {
  const t = useT();
  const friends = useFriends();
  const { state } = friends;

  // Opening the page is seeing what is in the inbox, and how things stand now (a switch just turned on changes what is told).
  useEffect(() => {
    void friends.refresh();
  }, []);
  useEffect(() => {
    if (friends.unread > 0) void friends.markRead().catch(() => undefined);
  }, [friends.unread]);

  if (!friends.on) {
    return (
      <p className="muted" data-testid="friends-off">
        {t("friends.off")}
      </p>
    );
  }
  if (!state) {
    return friends.status === "offline" ? (
      <p className="auth-error" role="alert">
        {t("friends.offline")}
      </p>
    ) : (
      <p className="muted" role="status">
        <span className="spinner" /> {t("common.loading")}
      </p>
    );
  }

  const now = Date.now();
  const open: (entry: Entry) => void = onOpenTitle ?? (() => undefined);
  return (
    <div className="page-stack" data-testid="friends-page">
      {friends.status === "offline" && <p className="muted small">{t("friends.offline")}</p>}
      {state.inbox.length > 0 && (
        <Group title={t("friends.inbox")}>
          <ul className="inbox-list" data-testid="friends-inbox">
            {state.inbox.map((item) => (
              <InboxRow key={item.id} item={item} friend={state.friends.find((each) => each.id === item.from)} onOpenTitle={onOpenTitle} onStartParty={onStartParty} onDismiss={() => void friends.dismiss(item.id).catch(() => undefined)} />
            ))}
          </ul>
        </Group>
      )}
      <Group title={t("friends.yours")}>
        {state.friends.length === 0 ? (
          <p className="muted" data-testid="friends-none">
            {t("friends.none")}
          </p>
        ) : (
          <ul className="friend-list" data-testid="friends-list">
            {state.friends.map((friend) => {
              const line = friendLine(friend, state.activity, now);
              return (
                <li key={friend.id}>
                  <button className="friend-row" onClick={() => onOpenFriend(friend.id)} data-testid="friend-row" data-friend={friend.id}>
                    <FriendPic friend={friend} />
                    <span className="friend-text">
                      <b>{friend.name}</b>
                      {line && <small>{line}</small>}
                    </span>
                    <ChevronIcon />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Group>
      {state.activity.length > 0 && (
        <CardRow title={t("friends.activity")} testId="friends-activity">
          {state.activity.map((item) => {
            const entry = entryOfActivity(item, nameOf(state.friends, item.friend), now);
            return <Card key={entry.id} testId="activity" title={entry.title} image={entry.backdrop ?? entry.image} note={entry.note} progress={entry.progress ?? 0} playLabel={`${t("rows.open")} ${entry.title}`} onPlay={() => open(entry)} />;
          })}
        </CardRow>
      )}
      <AddFriend />
    </div>
  );
}

/* ------------------------------ one friend ------------------------------ */

function SharedLists({ friend, onOpenTitle }: { friend: Friend; onOpenTitle: OpenTitle }) {
  const t = useT();
  const answer = useShared<FriendLists>(friend.id, friend.lists, askLists, friend.activity);
  const open: (entry: Entry) => void = onOpenTitle ?? (() => undefined);
  if (!friend.lists) return <p className="muted" data-testid="friend-not-sharing">{friend.on ? t("friends.notSharingLists", { name: friend.name }) : t("friends.theirsOff", { name: friend.name })}</p>;
  if (!answer) return <p className="muted" role="status"><span className="spinner" /> {t("common.loading")}</p>;
  if (answer.problem || !answer.data) return <p className="auth-error" role="alert">{answer.problem}</p>;
  const lists = listsOf(answer.data);
  const progress = answer.data.progress;
  if (lists.length === 0) return <p className="muted" data-testid="friend-empty">{t("friends.noLists", { name: friend.name })}</p>;
  return (
    <div className="page-stack" data-testid="friend-lists">
      {lists.map((list) => (
        <CardRow key={list.info.id} title={listName(list.info)} testId="friend-list">
          {withProgress(entriesOfList(list), progress).map((entry) => (
            <Card key={entry.id} testId="friend-list-card" title={entry.title} image={entry.backdrop ?? entry.image} note={entry.note ?? (entry.year ? String(entry.year) : undefined)} progress={entry.progress ?? 0} playLabel={`${t("rows.open")} ${entry.title}`} onPlay={() => open(entry)} />
          ))}
        </CardRow>
      ))}
    </div>
  );
}

/** How far a friend got in a title they rated: the episode they are at and how far into it, with a thin bar. */
function HowFar({ progress }: { progress: FriendProgress | undefined }) {
  const how = progress && progressNote(progress);
  if (!progress || !how) return null;
  const fraction = progress.done ? 1 : (progress.percent ?? 0) / 100;
  return (
    <span className="rating-progress" data-testid="friend-rating-progress">
      <span>{how}</span>
      {fraction > 0 && (
        <i aria-hidden="true">
          <b style={{ width: `${Math.round(fraction * 100)}%` }} />
        </i>
      )}
    </span>
  );
}

function SharedRatings({ friend, onOpenTitle }: { friend: Friend; onOpenTitle: OpenTitle }) {
  const t = useT();
  const language = useLanguage();
  const answer = useShared<FriendRatings>(friend.id, friend.ratings, askRatings, friend.activity);
  const open: (entry: Entry) => void = onOpenTitle ?? (() => undefined);
  if (!friend.ratings) return <p className="muted" data-testid="friend-not-sharing">{friend.on ? t("friends.notSharingRatings", { name: friend.name }) : t("friends.theirsOff", { name: friend.name })}</p>;
  if (!answer) return <p className="muted" role="status"><span className="spinner" /> {t("common.loading")}</p>;
  if (answer.problem || !answer.data) return <p className="auth-error" role="alert">{answer.problem}</p>;
  const ratings = sortRatings(ratedBy(answer.data), "new");
  const progress = answer.data.progress;
  if (ratings.length === 0) return <p className="muted" data-testid="friend-empty">{t("friends.noRatings", { name: friend.name })}</p>;
  return (
    <ul className="rating-list" data-testid="friend-ratings">
      {ratings.map((rating) => (
        <li key={rating.key}>
          <button className="rating-item" data-testid="friend-rating" data-score={rating.score} data-season={rating.season} onClick={() => open(entryOfRating(rating))}>
            <Poster className="lib-result-art" title={rating.title} image={rating.backdrop ?? rating.image} />
            <span className="rating-text">
              <span className="rating-name">{rating.season ? `${rating.title} · ${t("player.season", { n: rating.season })}` : rating.title}</span>
              <span className="rating-line">
                <span className="rating-badge">
                  <StarIcon filled /> {rating.score}/10
                </span>
                <span className="muted">{scoreWord(t, rating.score)}</span>
              </span>
              <HowFar progress={progressFor(progress, rating.url)} />
              {rating.note && <span className="rating-quote">{rating.note}</span>}
              <span className="rating-facts">
                {factLines(t, language, rating.ratedAt, storedFacts(rating)).map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A friend's page: their lists and their ratings (as far as they share them), and a way to stop being friends. */
export function FriendPage({ friendId, onOpenTitle, onGone }: { friendId: string; onOpenTitle: OpenTitle; onGone: () => void }) {
  const t = useT();
  const language = useLanguage();
  const account = useAccount();
  const friends = useFriends();
  const friend = friends.state?.friends.find((each) => each.id === friendId);
  const ask = useAskTogether();
  const [tab, setTab] = useState<"lists" | "ratings">("lists");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // A friend who is gone (taken off from the other side, or from another screen), or friends turned off from another screen, leave nothing to show.
  useEffect(() => {
    if (!friends.on || (friends.state && !friend)) onGone();
  }, [friends.on, friends.state, friend, onGone]);

  if (!friend) return null;

  const remove = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await friends.remove(friend.id);
      account.say(t("friends.removed", { name: friend.name }));
      onGone();
    } catch (error) {
      setProblem(describeError(error));
      setBusy(false);
    }
  };

  return (
    <div className="page-stack" data-testid="friend-page" data-friend={friend.id}>
      <section className="account-card">
        <FriendPic friend={friend} size="big" />
        <div className="account-who">
          <h1 data-testid="friend-name">{friend.name}</h1>
          <p className="muted">{[friend.on && friend.online ? t("friends.online") : "", t("friends.since", { day: formatDay(friend.since, language) })].filter(Boolean).join(" · ")}</p>
        </div>
      </section>
      {!friend.on && <p className="banner" data-testid="friend-off">{t("friends.theirsOff", { name: friend.name })}</p>}
      {canAskTogether(friend) && (
        <button className="btn btn-block" onClick={() => void ask(friend.id)} data-testid="friend-together">
          <UsersIcon /> {t("friends.askTogether")}
        </button>
      )}
      <div className="segmented compact" role="radiogroup" aria-label={friend.name}>
        {(["lists", "ratings"] as const).map((value) => (
          <button key={value} role="radio" aria-checked={tab === value} onClick={() => setTab(value)} data-testid={`friend-tab-${value}`}>
            {t(value === "lists" ? "friends.tabLists" : "friends.tabRatings")}
          </button>
        ))}
      </div>
      {tab === "lists" ? <SharedLists friend={friend} onOpenTitle={onOpenTitle} /> : <SharedRatings friend={friend} onOpenTitle={onOpenTitle} />}
      <button className="btn btn-danger btn-block" onClick={() => setAsking(true)} data-testid="friend-remove">
        {t("friends.remove")}
      </button>
      {asking && (
        <Sheet title={t("friends.removeTitle", { name: friend.name })} onClose={() => setAsking(false)} testId="friend-unfriend">
          <p className="muted">{t("friends.removeHelp")}</p>
          <button className="btn btn-danger btn-block" disabled={busy} onClick={() => void remove()} data-testid="friend-unfriend-yes">
            {t("friends.removeYes")}
          </button>
          <button className="btn btn-block" onClick={() => setAsking(false)} data-testid="friend-unfriend-cancel">
            {t("common.cancel")}
          </button>
          {problem && (
            <p className="auth-error" role="alert">
              {problem}
            </p>
          )}
        </Sheet>
      )}
    </div>
  );
}

/* ------------------------------ sending to friends ------------------------------ */

/**
 * Pick the friends a title or an invitation to a watch party goes to, with a few words of why for a title. Only friends who take
 * things are offered; the server has the last word on who gets it (it says who it reached and who is not taking things).
 */
export function FriendPicker({ title, withNote, build, onClose }: { title: string; withNote?: boolean; build: (note: string | undefined) => Message; onClose: () => void }) {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const all = friends.state?.friends ?? [];
  const takers = reachable(all);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(takers.length === 1 ? [takers[0]!.id] : []));
  const [note, setNote] = useState("");
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
      const answer = await friends.send([...picked], build(note.trim() || undefined));
      const names = (ids: readonly string[]) => ids.map((id) => nameOf(all, id)).filter(Boolean).join(", ");
      // (Both are told when some took it and some did not: the ones who did must not be sent it again.)
      const told: string[] = [];
      if (answer.sent.length > 0) told.push(t(withNote ? "friends.sent" : "friends.inviteSent", { names: names(answer.sent) }));
      if (answer.declined.length > 0) told.push(t(answer.declined.length > 1 ? "friends.declinedMany" : "friends.declined", { names: names(answer.declined) }));
      if (told.length > 0) account.say(told.join(". "));
      onClose();
    } catch (error) {
      setProblem(describeError(error));
      setBusy(false);
    }
  };

  return (
    <Sheet title={title} onClose={onClose} testId="friend-picker">
      {takers.length === 0 ? (
        <p className="muted" data-testid="friend-picker-none">
          {all.length === 0 ? t("friends.noFriends") : t("friends.nobody")}
        </p>
      ) : (
        <>
          <div className="choices" role="group" aria-label={t("friends.sendTitle")}>
            {takers.map((friend) => (
              <button key={friend.id} className={`choice${picked.has(friend.id) ? " active" : ""}`} role="checkbox" aria-checked={picked.has(friend.id)} onClick={() => toggle(friend.id)} data-testid="friend-pick" data-friend={friend.id}>
                <span className="choice-label">
                  <Avatar id={friend.avatar} className="friend-avatar small" /> {friend.name}
                </span>
                <span className="choice-dot" aria-hidden="true" />
              </button>
            ))}
          </div>
          {withNote && (
            <label className="auth-field">
              <span>{t("friends.noteLabel")}</span>
              <textarea className="rating-note" rows={2} maxLength={FRIEND_NOTE_MAX} value={note} autoCapitalize="sentences" enterKeyHint="done" onChange={(event) => setNote(event.target.value)} data-testid="friend-note" />
            </label>
          )}
          <button className="btn btn-red btn-block" disabled={busy || picked.size === 0} onClick={() => void send()} data-testid="friend-send">
            {t("friends.send")}
          </button>
          {problem && (
            <p className="auth-error" role="alert">
              {problem}
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}

/** "Recommend to a friend", on a title's page: nothing unless friends are on. */
export function RecommendButton({ entry }: { entry: Entry }) {
  const t = useT();
  const friends = useFriends();
  const [picking, setPicking] = useState(false);
  if (!friends.on || !entry.url) return null;
  return (
    <>
      <button className="btn btn-block" onClick={() => setPicking(true)} data-testid="title-recommend">
        <UsersIcon /> {t("friends.recommend")}
      </button>
      {picking && (
        <FriendPicker
          title={t("friends.sendTitle")}
          withNote
          build={(note) => recommendationOf(entry, note)}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

/** "Invite friends" on the code of a watch party: they get the code in their inbox, and a button that joins. */
export function InviteFriendsButton({ code, endsAt }: { code: string; endsAt: number }) {
  const t = useT();
  const friends = useFriends();
  const [picking, setPicking] = useState(false);
  if (!friends.on) return null;
  return (
    <>
      <button className="btn btn-block" onClick={() => setPicking(true)} data-testid="party-invite-friends">
        <UsersIcon /> {t("friends.inviteFriends")}
      </button>
      {picking && <FriendPicker title={t("friends.inviteFriends")} build={() => ({ kind: "party", code, endsAt })} onClose={() => setPicking(false)} />}
    </>
  );
}

/* ------------------------------ on the home screen ------------------------------ */

/** What friends have sent, where the library is: an invitation to a watch party that is on now, a request for one, and the titles they recommended. */
export function FriendsHome({ onOpenTitle, onStartParty }: { onOpenTitle: OpenTitle; onStartParty: (friendId: string) => void }) {
  const t = useT();
  const friends = useFriends();
  const scores = useScores();
  const now = Date.now();
  if (!friends.on || !friends.state) return null;
  const { state } = friends;
  const parties = state.inbox.filter((item): item is PartyInvitation => item.kind === "party" && partyOpen(item, now));
  const requests = state.inbox.filter((item): item is TogetherRequest => item.kind === "together");
  const recommended = state.inbox.filter((item): item is Recommendation => item.kind === "recommend");
  const open: (entry: Entry) => void = onOpenTitle ?? (() => undefined);
  const dismiss = (id: string) => void friends.dismiss(id).catch(() => undefined);
  return (
    <>
      {parties.map((item) => (
        <div className="banner friend-party" key={item.id} data-testid="friend-party-banner">
          <span>{t("friends.partyInvite", { name: nameOf(state.friends, item.from) })}</span>
          <a className="btn btn-red" href={partyLink(item.code)} data-testid="friend-party-join">
            {t("friends.join")}
          </a>
          <button className="mini" onClick={() => dismiss(item.id)} aria-label={t("friends.dismiss")} data-testid="friend-party-dismiss">
            <CloseIcon />
          </button>
        </div>
      ))}
      {requests.map((item) => (
        <div className="banner friend-party" key={item.id} data-testid="friend-together-banner">
          <span>{t("friends.togetherOf", { name: nameOf(state.friends, item.from) })}</span>
          <button className="btn btn-red" onClick={() => onStartParty(item.from)} data-testid="friend-together-start">
            {t("friends.startParty")}
          </button>
          <button className="mini" onClick={() => dismiss(item.id)} aria-label={t("friends.dismiss")} data-testid="friend-together-dismiss">
            <CloseIcon />
          </button>
        </div>
      ))}
      {recommended.length > 0 && (
        <CardRow title={t("friends.inbox")} testId="friends-row">
          {recommended.map((item) => {
            const entry = entryOfRecommendation(item, nameOf(state.friends, item.from));
            return (
              <Card
                key={item.id}
                testId="friends"
                title={entry.title}
                image={entry.backdrop ?? entry.image}
                note={entry.note}
                score={scoreOf(scores, entry.url)}
                playLabel={`${t("rows.open")} ${entry.title}`}
                removeLabel={`${t("friends.dismiss")}: ${entry.title}`}
                onPlay={() => open(entry)}
                onRemove={() => dismiss(item.id)}
              />
            );
          })}
        </CardRow>
      )}
    </>
  );
}
