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
import { useTitleNoticeLooks } from "../titleNotices/notices";

const LONGEST_WAIT_MS = 2_000_000_000;
const SETTING_WAIT_MS = [1200, 2500, 5000, 9000];

export interface FriendsValue {
  on: boolean;
  status: "off" | "loading" | "ready" | "offline";
  state: FriendsState | null;
  unread: number;
  attention: number;
  refresh(): Promise<void>;
  stir(): void;
  invite(): Promise<OpenInvite>;
  revoke(code: string): Promise<void>;
  peek(code: string): Promise<InviteView>;
  accept(code: string): Promise<Friend>;
  peekTag(text: string): Promise<TagView>;
  askByTag(tag: string): Promise<AskOutcome>;
  acceptRequest(fromId: string): Promise<Friend>;
  declineRequest(fromId: string): Promise<void>;
  remove(friendId: string): Promise<void>;
  send(to: readonly string[], message: Message): Promise<Sent>;
  answerPlan(itemId: string, yes: boolean): Promise<void>;
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

const madeHereBy = <T extends { friend?: { id: string } | undefined }>(answer: T): T => {
  if (answer.friend) rememberMadeHere(answer.friend.id);
  return answer;
};

const QUICK_LOOK_MS = 5_000;
const QUICK_LOOKS_FOR_MS = 10 * 60_000;

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

export function FriendsProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { settings } = useProfileData();
  const profileId = account.me && account.profile ? account.profile.id : undefined;
  const on = profileId !== undefined && friendChoices(settings).friends;
  useTitleNoticeLooks();

  const [state, setState] = useState<FriendsState | null>(null);
  const [status, setStatus] = useState<FriendsValue["status"]>("off");
  const seen = useRef<Known | null>(null);
  const announcedDue = useRef<Set<string>>(new Set());
  const [moment, setMoment] = useState(0);
  const accountRef = useRef(account);
  accountRef.current = account;
  const lookRef = useRef<() => Promise<void>>(async () => {});
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
    let asked = 0;
    let taken = 0;
    let lastAnswer = Date.now();
    let lastStart = 0;
    let anyoneOn = false;
    let unreachable = false;
    let chatSeen: ChatMark = { newest: 0, count: 0 };
    setStatus("loading");

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
        if (Date.now() - lastAnswer >= ONLINE_MS) {
          setStatus("offline");
          setState((kept) => (kept ? withoutOnline(kept) : kept));
        } else setStatus((now) => (now === "ready" ? now : "offline"));
        unreachable = true;
        plan();
      }
    };
    lookRef.current = () => look();
    planRef.current = plan;
    void look();

    const wake = () => document.visibilityState === "visible" && void look();
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

  useEffect(() => {
    if (!state) return;
    const next = nextPlanMoment(state.inbox, Date.now());
    if (next === undefined) return;
    const timer = setTimeout(() => setMoment((n) => n + 1), Math.min(next - Date.now(), LONGEST_WAIT_MS) + 250);
    return () => clearTimeout(timer);
  }, [state, moment]);
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
    const waiting = state ? inboxToShow(state.inbox, now).filter((item) => !item.read || (item.kind === "plan" && planDue(item, now))).length : 0;
    const id = (): string => {
      if (!profileId) throw new ApiError(0, "signed_out");
      return profileId;
    };
    const then = async <T,>(work: Promise<T>): Promise<T> => {
      const result = await work;
      await lookRef.current();
      return result;
    };
    const stir = () => {
      livelyUntil.current = Date.now() + LIVELY_FOR_MS;
      planRef.current();
    };
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
