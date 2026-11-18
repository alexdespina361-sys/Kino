import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_POLL_MS, type ChatReaction, type ChatReportPreview, type ChatThread } from "../../shared";
import { chatApi } from "./api";
import { applyThread, endsChat, FRESH_CHAT, problemOf, type ChatProblem, type ChatState } from "./state";

export interface ChatSession {
  profileId: string;
  friendId: string;
  state: ChatState;
  loaded: boolean;
  ended: ChatProblem | null;
  problem: ChatProblem | null;
  sending: boolean;
  send: (text: string) => Promise<boolean>;
  sendSticker: (id: string) => Promise<boolean>;
  replyTo: number | null;
  setReplyTo: (id: number | null) => void;
  takeBack: (id: number) => Promise<void>;
  react: (id: number, reaction: ChatReaction | null) => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  settle: () => void;
}

type Reading = "ok" | "failed" | "ended";

export function useChat(profileId: string, friendId: string, options: { active?: boolean; interval?: number } = {}): ChatSession {
  const { active = true, interval = CHAT_POLL_MS } = options;
  const [state, setState] = useState<ChatState>(FRESH_CHAT);
  const [loaded, setLoaded] = useState(false);
  const [ended, setEnded] = useState<ChatProblem | null>(null);
  const [offline, setOffline] = useState(false);
  const [failure, setFailure] = useState<ChatProblem | null>(null);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyState] = useState<number | null>(null);
  const replying = useRef<number | null>(null);
  const setReplyTo = useCallback((id: number | null) => {
    replying.current = id;
    setReplyState(id);
  }, []);

  const seen = useRef(state);
  seen.current = state;
  const clock = useRef({ tick: 0, muted: 0, taken: 0 });
  const writing = useRef(false);

  const take = useCallback((answer: ChatThread, started: number) => {
    setState((before) => {
      const after = applyThread(before, answer, started < clock.current.muted, started < clock.current.taken);
      if (after !== before) clock.current.taken = Math.max(clock.current.taken, started);
      return after;
    });
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

  const write = useCallback(
    async (call: (replyTo: number | undefined) => Promise<ChatThread>): Promise<boolean> => {
      if (writing.current) return false;
      writing.current = true;
      setSending(true);
      setFailure(null);
      const started = ++clock.current.tick;
      const answers = replying.current;
      try {
        take(await call(answers ?? undefined), started);
        setOffline(false);
        if (answers !== null && replying.current === answers) setReplyTo(null);
        return true;
      } catch (error) {
        if (fail(error) === "chat_off") {
          clock.current.taken = Math.max(clock.current.taken, started);
          setState((before) => ({ ...before, open: false }));
          setFailure(null);
        }
        return false;
      } finally {
        writing.current = false;
        setSending(false);
      }
    },
    [take, fail, setReplyTo],
  );
  const send = useCallback((text: string) => write((answers) => chatApi.send(profileId, friendId, text, answers)), [write, profileId, friendId]);
  const sendSticker = useCallback((id: string) => write((answers) => chatApi.sendSticker(profileId, friendId, id, answers)), [write, profileId, friendId]);

  const answerable = replyTo === null || state.lines.some((line) => line.id === replyTo);
  useEffect(() => {
    if (!answerable && loaded) setReplyTo(null);
  }, [answerable, loaded, setReplyTo]);

  const takeBack = useCallback(
    async (id: number): Promise<void> => {
      setFailure(null);
      const started = ++clock.current.tick;
      try {
        take(await chatApi.takeBack(profileId, friendId, id), started);
        setOffline(false);
      } catch (error) {
        if (fail(error) === "gone") void read();
      }
    },
    [profileId, friendId, take, fail, read],
  );

  const react = useCallback(
    async (id: number, reaction: ChatReaction | null): Promise<void> => {
      setFailure(null);
      const started = ++clock.current.tick;
      try {
        take(await chatApi.react(profileId, friendId, id, reaction), started);
        setOffline(false);
      } catch (error) {
        if (problemOf(error) === "gone") void read();
        else fail(error);
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

  return {
    profileId,
    friendId,
    state,
    loaded,
    ended,
    problem: failure ?? (offline ? "offline" : null),
    sending,
    send,
    sendSticker,
    replyTo: answerable ? replyTo : null,
    setReplyTo,
    takeBack,
    react,
    setMuted,
    settle,
  };
}

export interface ChatReportState {
  stage: "closed" | "loading" | "preview" | "sending" | "sent";
  preview: ChatReportPreview | null;
  problem: ChatProblem | null;
}

export interface ChatReport extends ChatReportState {
  start: () => void;
  confirm: () => void;
  cancel: () => void;
}

const CLOSED: ChatReportState = { stage: "closed", preview: null, problem: null };

export function useChatReport(profileId: string, friendId: string): ChatReport {
  const [state, setState] = useState<ChatReportState>(CLOSED);
  const latest = useRef(state);
  latest.current = state;
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
