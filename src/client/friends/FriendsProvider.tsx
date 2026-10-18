import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ONLINE_MS, planDue, type AskOutcome, type Friend, type FriendLists, type FriendRatings, type FriendsState, type InviteView, type Message, type OpenInvite, type Sent, type TagView } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { ApiError } from "../account/api";
import { useProfileData } from "../account/store";
import { t } from "../i18n";
import { friendsApi } from "./api";
import { describeNews, isUrgent, known, whatsNew, type Known } from "./news";
import { duePlans, inboxToShow, nextPlanMoment, whenText } from "./plans";
import { withoutOnline } from "./stale";

/** A screen looks at its friends this often while it is on screen. */
const POLL_MS = 30_000;
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
  /** How many things wait for this profile: what is new in the inbox, plans whose time has come, and the requests to be friends that are not answered (what a badge counts). */
  attention: number;
  refresh(): Promise<void>;
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

/**
 * The friends of the profile in use, when it has turned them on: looked at every half minute while the screen is open (and when it
 * comes back, or the network does), with a line from the account's message when something is new. Nothing is asked of the server
 * while friends are off.
 */
export function FriendsProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { settings } = useProfileData();
  const profileId = account.me && account.profile ? account.profile.id : undefined;
  const on = profileId !== undefined && settings.friends === true;

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

  useEffect(() => {
    seen.current = null;
    announcedDue.current = new Set();
    setState(null);
    if (!on || !profileId) {
      setStatus("off");
      lookRef.current = async () => {};
      return;
    }
    const id = profileId;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    /** Looks that were started, and the newest one whose answer was taken: a slow answer to an older look must not replace a newer one. */
    let asked = 0;
    let taken = 0;
    /** When the server last answered: what is kept of it is only as good as that. */
    let lastAnswer = Date.now();
    setStatus("loading");

    const look = async (attempt = 0): Promise<void> => {
      const mine = ++asked;
      try {
        const next = await friendsApi.state(id);
        if (stopped || mine < taken) return;
        taken = mine;
        lastAnswer = Date.now();
        const news = whatsNew(seen.current, next, Date.now());
        const line = describeNews(news, t, (at) => whenText(at, Date.now()));
        seen.current = known(next);
        setState(next);
        setStatus("ready");
        if (line) accountRef.current.say(line, isUrgent(news) ? "urgent" : "info");
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
      }
    };
    lookRef.current = () => look();
    void look();

    const every = setInterval(() => document.visibilityState === "visible" && void look(), POLL_MS);
    const wake = () => document.visibilityState === "visible" && void look();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      stopped = true;
      lookRef.current = async () => {};
      clearTimeout(retry);
      clearInterval(every);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
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
    return {
      on,
      status,
      state,
      unread,
      attention: waiting + (state?.requests.length ?? 0),
      refresh: () => lookRef.current(),
      invite: () => then(friendsApi.invite(id())),
      revoke: (code) => then(friendsApi.revoke(id(), code)),
      peek: (code) => friendsApi.peek(id(), code),
      accept: async (code) => (await then(friendsApi.accept(id(), code))).friend,
      peekTag: (text) => friendsApi.tag(id(), text),
      askByTag: (tag) => then(friendsApi.askFriend(id(), tag)),
      acceptRequest: async (fromId) => (await then(friendsApi.acceptRequest(id(), fromId))).friend,
      declineRequest: (fromId) => then(friendsApi.declineRequest(id(), fromId)),
      remove: (friendId) => then(friendsApi.remove(id(), friendId)),
      send: (to, message) => friendsApi.send(id(), { ...message, to: [...to] }),
      answerPlan: (itemId, yes) => then(friendsApi.answerPlan(id(), itemId, yes)),
      markRead: () => then(friendsApi.read(id())),
      dismiss: (itemId) => then(friendsApi.dismiss(id(), itemId)),
      lists: (friendId) => friendsApi.lists(id(), friendId),
      ratings: (friendId) => friendsApi.ratings(id(), friendId),
    };
  }, [on, status, state, profileId, moment]);

  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>;
}
