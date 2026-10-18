import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_POLL_MS, type ChatReportPreview, type ChatThread } from "../../shared";
import { chatApi } from "./api";
import { applyThread, endsChat, FRESH_CHAT, problemOf, type ChatProblem, type ChatState } from "./state";

export interface ChatSession {
  state: ChatState;
  /** Whether the first answer has come. */
  loaded: boolean;
  /** Why the chat can't go on at all (the friend is no friend any more, friends are off), or null. */
  ended: ChatProblem | null;
  /** The last thing that went wrong, to be said quietly (the server can't be reached, a message was refused), or null. */
  problem: ChatProblem | null;
  /** A message is on its way. */
  sending: boolean;
  /** Write to the friend. True when it went (so that the box can be emptied); when it did not, `problem` says why. */
  send: (text: string) => Promise<boolean>;
  takeBack: (id: number) => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  /** The person is writing again: what was said about the last failure is old news. */
  settle: () => void;
}

type Reading = "ok" | "failed" | "ended";

/**
 * One chat, as a page shows it: the messages, kept up to date while the page is up and in sight (a reading every few seconds, with the
 * revision the page has, so that a chat that has not changed costs a few bytes), and what the person does to it. One session is one chat:
 * the page that shows another friend's makes another (give it a `key`).
 */
export function useChat(profileId: string, friendId: string, options: { active?: boolean; interval?: number } = {}): ChatSession {
  const { active = true, interval = CHAT_POLL_MS } = options;
  const [state, setState] = useState<ChatState>(FRESH_CHAT);
  const [loaded, setLoaded] = useState(false);
  const [ended, setEnded] = useState<ChatProblem | null>(null);
  const [offline, setOffline] = useState(false);
  const [failure, setFailure] = useState<ChatProblem | null>(null);
  const [sending, setSending] = useState(false);

  const seen = useRef(state);
  seen.current = state;
  /** `tick` numbers every call; `muted` is the number of the last mute that was answered: a reading that started before it knows nothing of it. */
  const clock = useRef({ tick: 0, muted: 0 });
  const writing = useRef(false);

  const take = useCallback((answer: ChatThread, started: number) => {
    setState((before) => applyThread(before, answer, started < clock.current.muted));
    setLoaded(true);
  }, []);

  const fail = useCallback((error: unknown): ChatProblem => {
    const problem = problemOf(error);
    if (endsChat(problem)) setEnded(problem);
    else setFailure(problem);
    return problem;
  }, []);

  const read = useCallback(async (): Promise<Reading> => {
    const started = ++clock.current.tick;
    try {
      take(await chatApi.read(profileId, friendId, seen.current.rev ?? undefined), started);
      setOffline(false);
      return "ok";
    } catch (error) {
      const problem = problemOf(error);
      if (endsChat(problem)) {
        setEnded(problem);
        return "ended";
      }
      setOffline(true);
      return "failed";
    }
  }, [profileId, friendId, take]);

  useEffect(() => {
    if (!active || ended) return;
    let stopped = false;
    let busy = false;
    let timer: number | undefined;
    const run = async () => {
      window.clearTimeout(timer);
      if (stopped || busy) return;
      busy = true;
      let reading: Reading = "ok";
      try {
        // (A page that is out of sight asks for nothing; it asks at once when it comes back.)
        if (document.visibilityState !== "hidden") reading = await read();
      } finally {
        busy = false;
      }
      if (stopped || reading === "ended") return;
      timer = window.setTimeout(() => void run(), reading === "failed" ? interval * 3 : interval);
    };
    void run();
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, ended, interval, read]);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      if (writing.current) return false;
      writing.current = true;
      setSending(true);
      setFailure(null);
      const started = ++clock.current.tick;
      try {
        take(await chatApi.send(profileId, friendId, text), started);
        setOffline(false);
        return true;
      } catch (error) {
        // (A friend who stopped taking messages while the page was open: the box gives way to the line that says so.)
        if (fail(error) === "chat_off") setState((before) => ({ ...before, open: false }));
        return false;
      } finally {
        writing.current = false;
        setSending(false);
      }
    },
    [profileId, friendId, take, fail],
  );

  const takeBack = useCallback(
    async (id: number): Promise<void> => {
      setFailure(null);
      const started = ++clock.current.tick;
      try {
        take(await chatApi.takeBack(profileId, friendId, id), started);
        setOffline(false);
      } catch (error) {
        // (Gone already, say from the other phone: what the page shows is made right.)
        if (fail(error) === "gone") void read();
      }
    },
    [profileId, friendId, take, fail, read],
  );

  const setMuted = useCallback(
    async (muted: boolean): Promise<void> => {
      setFailure(null);
      try {
        const answer = await chatApi.mute(profileId, friendId, muted);
        clock.current.muted = ++clock.current.tick;
        setState((before) => ({ ...before, muted: answer.muted }));
        setOffline(false);
      } catch (error) {
        fail(error);
      }
    },
    [profileId, friendId, fail],
  );

  const settle = useCallback(() => setFailure(null), []);

  return { state, loaded, ended, problem: failure ?? (offline ? "offline" : null), sending, send, takeBack, setMuted, settle };
}

/** Where a report of the chat is: closed, being fetched, shown (and waiting for a yes), on its way, or sent. */
export interface ChatReportState {
  stage: "closed" | "loading" | "preview" | "sending" | "sent";
  /** What would be sent (null while it is fetched, or when it could not be). */
  preview: ChatReportPreview | null;
  problem: ChatProblem | null;
}

export interface ChatReport extends ChatReportState {
  /** Show what would be sent. */
  start: () => void;
  /** Send it: only what was shown, only after this. */
  confirm: () => void;
  /** Leave it (also what closes it once it was sent). */
  cancel: () => void;
}

const CLOSED: ChatReportState = { stage: "closed", preview: null, problem: null };

/** Telling the team about a chat: it shows the last messages first, and sends exactly those when the person says yes. */
export function useChatReport(profileId: string, friendId: string): ChatReport {
  const [state, setState] = useState<ChatReportState>(CLOSED);
  const latest = useRef(state);
  latest.current = state;
  /** Numbers the steps: an answer that comes after the report was left, or after another step, is dropped. */
  const step = useRef(0);

  const show = useCallback(
    async (said: ChatProblem | null) => {
      const mine = ++step.current;
      setState({ stage: "loading", preview: null, problem: said });
      try {
        const preview = await chatApi.reportPreview(profileId, friendId);
        if (step.current === mine) setState({ stage: "preview", preview, problem: said });
      } catch (error) {
        if (step.current === mine) setState({ stage: "preview", preview: null, problem: problemOf(error) });
      }
    },
    [profileId, friendId],
  );

  const start = useCallback(() => void show(null), [show]);

  const confirm = useCallback(async () => {
    const { stage, preview } = latest.current;
    if (stage !== "preview" || !preview || preview.lines.length === 0) return;
    const mine = ++step.current;
    setState({ stage: "sending", preview, problem: null });
    try {
      await chatApi.report(profileId, friendId, preview.rev);
      if (step.current === mine) setState({ stage: "sent", preview, problem: null });
    } catch (error) {
      if (step.current !== mine) return;
      const problem = problemOf(error);
      // A chat that changed while it was looked at is shown again: what is sent is what was seen.
      if (problem === "changed") void show("changed");
      else setState({ stage: "preview", preview, problem });
    }
  }, [profileId, friendId, show]);

  const cancel = useCallback(() => {
    step.current++;
    setState(CLOSED);
  }, []);

  return { ...state, start, confirm: () => void confirm(), cancel };
}
