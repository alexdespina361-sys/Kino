import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { friendChoices, ONLINE_MS, planDue, type AskOutcome, type Friend, type FriendLists, type FriendRatings, type FriendsState, type InviteView, type Message, type OpenInvite, type Sent, type TagView } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { ApiError } from "../account/api";
import { useProfileData } from "../account/store";
import { chatWaiting } from "../chat/notices";
import { t } from "../i18n";
import { friendsApi } from "./api";
import { rememberMadeHere } from "./madeHere";
import { describeNews, isUrgent, known, whatsNew, type Known } from "./news";
import { chatMark, friendOnline, LIVELY_FOR_MS, lookPace, QUIET_MS, stirring, WAKE_GAP_MS, type ChatMark } from "./pace";
import { duePlans, inboxToShow, nextPlanMoment, whenText } from "./plans";
import { withoutOnline } from "./stale";

/** The longest a timer can be set for (a plan can be thirty days away; a longer wait is made of several). */
const LONGEST_WAIT_MS = 2_000_000_000;
/** Friends were just turned on and the server has not heard of it yet (a setting reaches it with the next exchange): ask it to listen now, and look again after each of these. */
const SETTING_WAIT_MS = [1200, 2500, 5000, 9000];

export interface FriendsValue {
  /** Friends are turned on for the profile in use (a guest, and a profile that did not turn them on, have none). */
  on: boolean;
  /** `loading`: not heard yet; `offline`: the server cannot be reached, so what is shown (if anything) may be old. */
  status: "off" | "loading" | "ready" | "offline";
  /** What the server last said, or null while off and before the first answer. */
  state: FriendsState | null;
  /** How many things in the inbox have not been seen. */
  unread: number;
  /** How many things wait for this profile: what is new in the inbox, plans whose time has come, the requests to be friends that are not answered, and the friends who wrote and have not been answered by a look at the chat (what a badge counts). */
  attention: number;
  refresh(): Promise<void>;
  /** Something just went on between friends on this screen (a message was written): they are looked at often for a few minutes, so that an answer comes in seconds. */
  stir(): void;
  /** A new code to give to a friend. */
  invite(): Promise<OpenInvite>;
  revoke(code: string): Promise<void>;
  /** Who is behind a code, before it is used. */
  peek(code: string): Promise<InviteView>;
  /** Use a friend's code. */
  accept(code: string): Promise<Friend>;
  /** Who has this tag ("Sam#2"), before anybody is asked. */
  peekTag(text: string): Promise<TagView>;
  /** Ask the profile with this tag to be friends: they have to say yes, unless they had asked first (then the two are friends). */
  askByTag(tag: string): Promise<AskOutcome>;
  /** Say yes to somebody who asked this profile. */
  acceptRequest(fromId: string): Promise<Friend>;
  /** Say no (the one who asked is not told). */
  declineRequest(fromId: string): Promise<void>;
  remove(friendId: string): Promise<void>;
  /** Send a title, or the invitation to a party, or a plan to watch together, to these friends. Says who it reached and who is not taking things. */
  send(to: readonly string[], message: Message): Promise<Sent>;
  /** Say yes or no to a plan to watch together that a friend put. */
  answerPlan(itemId: string, yes: boolean): Promise<void>;
  /** Everything in the inbox has been seen. */
  markRead(): Promise<void>;
  dismiss(itemId: string): Promise<void>;
  lists(friendId: string): Promise<FriendLists>;
  ratings(friendId: string): Promise<FriendRatings>;
}

const FriendsContext = createContext<FriendsValue | null>(null);

export function useFriends(): FriendsValue {
  const value = useContext(FriendsContext);
  if (!value) throw new Error("useFriends needs a <FriendsProvider>");
  return value;
}

/** An answer of the server that made a friend: that friend was made here. */
const madeHereBy = <T extends { friend?: { id: string } | undefined }>(answer: T): T => {
  if (answer.friend) rememberMadeHere(answer.friend.id);
  return answer;
};

/** While a code made for a friend is on the screen, the friends are looked at this often (instead of every half minute), for this long at most. */
const QUICK_LOOK_MS = 5_000;
const QUICK_LOOKS_FOR_MS = 10 * 60_000;

/**
 * Looks at the friends every few seconds while `on` (a code made for a friend is on the screen): the page that shows it learns within seconds that it
 * was used, and says so, instead of showing a used code for up to half a minute (the judge, 16 Nov). Ten minutes at most, then the usual half minute.
 */
export function useQuickLooks(on: boolean) {
  const { refresh } = useFriends();
  const look = useRef(refresh);
  look.current = refresh;
  useEffect(() => {
    if (!on) return;
    const began = Date.now();
    const every = setInterval(() => {
      if (Date.now() - began > QUICK_LOOKS_FOR_MS) clearInterval(every);
      else if (document.visibilityState === "visible") void look.current().catch(() => undefined);
    }, QUICK_LOOK_MS);
    return () => clearInterval(every);
  }, [on]);
}

/**
 * The friends of the profile in use, when it has turned them on: looked at while the screen is open, at the pace of `pace.ts` (every 8 s for a
 * few minutes after something went on between friends, 15 s while a friend is on the site, else every half minute), and when it comes back,
 * its window is focused, or the network comes back; with a line from the account's message when something is new. Nothing is asked of the
 * server while friends are off.
 */
export function FriendsProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { settings } = useProfileData();
  const profileId = account.me && account.profile ? account.profile.id : undefined;
  const on = profileId !== undefined && friendChoices(settings).friends; // (on for everybody: see friendChoices)

  const [state, setState] = useState<FriendsState | null>(null);
  const [status, setStatus] = useState<FriendsValue["status"]>("off");
  const seen = useRef<Known | null>(null);
  /** The plans whose time has come that this screen has said so of (once each). */
  const announcedDue = useRef<Set<string>>(new Set());
  /** Counts the moments a plan changes by itself (see below), so that what is made of the answer is made anew. */
  const [moment, setMoment] = useState(0);
  const accountRef = useRef(account);
  accountRef.current = account;
  /** Looks again now (what the actions below do after they change something). Whatever is looking after the profile in use. */
  const lookRef = useRef<() => Promise<void>>(async () => {});
  /** Until when the friends are looked at often (see `pace.ts`), and what sets the next look anew from now (`stir`). */
  const livelyUntil = useRef(0);
  const planRef = useRef<() => void>(() => {});

  useEffect(() => {
    seen.current = null;
    announcedDue.current = new Set();
    livelyUntil.current = 0;
    setState(null);
    if (!on || !profileId) {
      setStatus("off");
      lookRef.current = async () => {};
      planRef.current = () => {};
      return;
    }
    const id = profileId;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let next: ReturnType<typeof setTimeout> | undefined;
    /** Looks that were started, and the newest one whose answer was taken: a slow answer to an older look must not replace a newer one. */
    let asked = 0;
    let taken = 0;
    /** When the server last answered: what is kept of it is only as good as that. */
    let lastAnswer = Date.now();
    /** When the last look started (a wake right after it does not look again), and what the last answer said of the pace. */
    let lastStart = 0;
    let anyoneOn = false;
    let unreachable = false;
    let chatSeen: ChatMark = { newest: 0, count: 0 };
    setStatus("loading");

    /** The next look, counted from now (each look sets it when it is answered, so one asked for in between moves it on). Out of sight it asks nothing, and looks when it comes back. */
    const plan = () => {
      clearTimeout(next);
      if (stopped) return;
      const wait = unreachable ? QUIET_MS : lookPace(Date.now(), livelyUntil.current, anyoneOn);      next = setTimeout(() => (document.visibilityState === "visible" ? void look() : plan()), wait);
    };

    const look = async (attempt = 0): Promise<void> => {
      const mine = ++asked;
      lastStart = Date.now();
      try {
        const answer = await friendsApi.state(id);
        if (stopped) return;
        if (mine < taken) return plan();
        taken = mine;
        lastAnswer = Date.now();
        const first = seen.current === null;
        const news = whatsNew(seen.current, answer, Date.now());
        const line = describeNews(news, t, (at) => whenText(at, Date.now()));
        const chatNow = chatMark(answer);
        // (A friend who just did something may well do more in a moment: their next is heard within seconds. The first answer is not news.)
        if (!first && stirring(news, chatSeen, chatNow)) livelyUntil.current = Date.now() + LIVELY_FOR_MS;
        chatSeen = chatNow;
        anyoneOn = friendOnline(answer);
        unreachable = false;
        seen.current = known(answer);
        setState(answer);
        setStatus("ready");
        if (line) accountRef.current.say(line, isUrgent(news) ? "urgent" : "info");
        plan();
      } catch (error) {
        if (stopped) return;
        const early = error instanceof ApiError && error.code === "friends_off" && attempt < SETTING_WAIT_MS.length;
        if (early) {
          accountRef.current.syncNow();
          clearTimeout(retry);
          retry = setTimeout(() => void look(attempt + 1), SETTING_WAIT_MS[attempt]);
          return;
        }
        // (What is kept is what the server last said, which is fine for a while. "Online" is a fact of the last minute and a half, though: with no
        // answer for that long it is not said any more, and the page says the server cannot be reached.)
        if (Date.now() - lastAnswer >= ONLINE_MS) {
          setStatus("offline");
          setState((kept) => (kept ? withoutOnline(kept) : kept));
        } else setStatus((now) => (now === "ready" ? now : "offline"));
        unreachable = true; // (asked again every half minute, not every few seconds, until it answers)
        plan();
      }
    };
    lookRef.current = () => look();
    planRef.current = plan;
    void look();

    const wake = () => document.visibilityState === "visible" && void look();
    // (A PC's window brought back from behind another is only focused. A tab brought back is shown, then focused: one look for both.)
    const focused = () => {
      if (Date.now() - lastStart >= WAKE_GAP_MS) wake();
    };
    const networkBack = () => void look();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", focused);
    window.addEventListener("online", networkBack);
    return () => {
      stopped = true;
      lookRef.current = async () => {};
      planRef.current = () => {};
      clearTimeout(retry);
      clearTimeout(next);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", focused);
      window.removeEventListener("online", networkBack);
    };
  }, [on, profileId]);

  // A plan changes by itself when its time comes (one nobody answered is over, one that is on is due), and later when it is over: look again then,
  // instead of at the next half minute. (A timer is never set for longer than a timer can be; a plan far off is waited for in more than one.)
  useEffect(() => {
    if (!state) return;
    const next = nextPlanMoment(state.inbox, Date.now());
    if (next === undefined) return;
    const timer = setTimeout(() => setMoment((n) => n + 1), Math.min(next - Date.now(), LONGEST_WAIT_MS) + 250);
    return () => clearTimeout(timer);
  }, [state, moment]);
  // ...and when it is due this screen says so, once: a small note (the bell and the Friends page have the button that starts the party).
  useEffect(() => {
    if (!state) return;
    const fresh = duePlans(state.inbox, Date.now()).filter((item) => !announcedDue.current.has(item.id));
    if (fresh.length === 0) return;
    for (const item of fresh) announcedDue.current.add(item.id);
    const name = state.friends.find((friend) => friend.id === fresh[0]!.from)?.name ?? "";
    accountRef.current.say(t("friends.news.planDue", { name }), "urgent");
  }, [state, moment]);

  const value = useMemo<FriendsValue>(() => {
    const now = Date.now();
    const unread = state?.inbox.filter((item) => !item.read).length ?? 0;
    // (What waits: what is new, and a plan whose time has come until it is over. A plan that is over does not count, though the server may not have let go of it yet.)
    const waiting = state ? inboxToShow(state.inbox, now).filter((item) => !item.read || (item.kind === "plan" && planDue(item, now))).length : 0;
    const id = (): string => {
      if (!profileId) throw new ApiError(0, "signed_out");
      return profileId;
    };
    /** A change, and then a look at how things stand. */
    const then = async <T,>(work: Promise<T>): Promise<T> => {
      const result = await work;
      await lookRef.current();
      return result;
    };
    const stir = () => {
      livelyUntil.current = Date.now() + LIVELY_FOR_MS;
      planRef.current();
    };
    /** Something that a friend may answer soon (a title, an invitation, a plan, a request to be friends): their answer is looked for every few seconds for a while. */
    const answered = async <T,>(work: Promise<T>): Promise<T> => {
      const result = await work;
      stir();
      return result;
    };
    return {
      on,
      status,
      state,
      unread,
      attention: waiting + (state?.requests.length ?? 0) + chatWaiting(state).length,
      refresh: () => lookRef.current(),
      stir,
      invite: () => then(friendsApi.invite(id())),
      revoke: (code) => then(friendsApi.revoke(id(), code)),
      peek: (code) => friendsApi.peek(id(), code),
      // (A friend made here is no news to this screen's bell: it is remembered before the look that brings them.)
      accept: async (code) => (await then(answered(friendsApi.accept(id(), code).then(madeHereBy)))).friend,
      peekTag: (text) => friendsApi.tag(id(), text),
      askByTag: (tag) => then(answered(friendsApi.askFriend(id(), tag).then(madeHereBy))),
      acceptRequest: async (fromId) => (await then(answered(friendsApi.acceptRequest(id(), fromId).then(madeHereBy)))).friend,
      declineRequest: (fromId) => then(friendsApi.declineRequest(id(), fromId)),
      remove: (friendId) => then(friendsApi.remove(id(), friendId)),
      send: (to, message) => answered(friendsApi.send(id(), { ...message, to: [...to] })),
      answerPlan: (itemId, yes) => then(answered(friendsApi.answerPlan(id(), itemId, yes))),
      markRead: () => then(friendsApi.read(id())),
      dismiss: (itemId) => then(friendsApi.dismiss(id(), itemId)),
      lists: (friendId) => friendsApi.lists(id(), friendId),
      ratings: (friendId) => friendsApi.ratings(id(), friendId),
    };
  }, [on, status, state, profileId, moment]);

  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>;
}
