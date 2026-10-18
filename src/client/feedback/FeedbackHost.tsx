import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { feedbackTitle, type FeedbackArea, type FeedbackKind } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { useT, type Key } from "../i18n";
import { roleOfThisPage, thisIsHandHeld } from "../role";
import { useBackToClose } from "../shared/backButton";
import { ChevronIcon, CloseIcon } from "../shared/icons";
import { moveFocus, navItems, type Direction } from "../tv/dpad";
import { actionForKey, isEditable } from "../tv/keys";
import { keepReceipt, refreshUnread, sendReport, type Who } from "./api";
import { Annotator } from "./Annotator";
import { captureScreen } from "./capture";
import { CaptureBar, Shutter } from "./CaptureBar";
import { collectContext, guessArea } from "./diagnostics";
import "./feedback.css";
import { FormScreen, type SendState } from "./Form";
import { buildPayload, fromDraft, hasWords, newForm, toDraft, writtenByThePerson, type FormState } from "./formState";
import { pieceFromFile, pieceFromFitted, release, toAttachments, withMarks, type Piece } from "./images";
import { MineScreen, ThreadScreen } from "./Mine";
import type { AddRole } from "./Pictures";
import { clearDraft, newKey, readDraft, readReceipts, saveDraft } from "./receipts";
import { SentScreen } from "./Sent";
import { StartScreen } from "./Start";
import type { FeedbackOptions } from "./store";
import { WhereScreen } from "./Where";

type Screen =
  | { name: "start" }
  | { name: "form" }
  | { name: "where" }
  | { name: "annotate"; id: string }
  | { name: "sent"; answerable: boolean; rejected: number; dropped: number }
  | { name: "mine" }
  | { name: "thread"; who: Who };

const initialScreen = (options: FeedbackOptions): Screen => (options.screen === "mine" ? { name: "mine" } : options.kind ? { name: "form" } : { name: "start" });

/** Where the trouble most likely is: what the caller knows, else what the page saw the person on, else the remote or nothing. */
const guess = (options: FeedbackOptions, remote: boolean): { area: FeedbackArea; chosen: boolean } =>
  options.area ? { area: options.area, chosen: true } : { area: guessArea() ?? (remote ? "remote" : "unsure"), chosen: false };

/** Waits for the page to be drawn twice, which is when what was just changed on it is on the screen. */
const drawn = () =>
  Promise.race([
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    new Promise<void>((resolve) => setTimeout(resolve, 300)), // (a page in the background draws nothing and calls nothing)
  ]);

const COUNTDOWN = 5;
const DRAFT_SAVE_MS = 600;

/** Tab goes round the form, not out to the page behind it. */
function keepInside(panel: HTMLElement, event: KeyboardEvent): void {
  const items = [...panel.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((item) => !item.hasAttribute("disabled") && item.getClientRects().length > 0);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return void event.preventDefault();
  const at = document.activeElement;
  if (!panel.contains(at) || at === panel || (event.shiftKey ? at === first : at === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

export interface HostProps {
  options: FeedbackOptions;
  onClose: () => void;
}

/**
 * The feedback: a screen over everything, with the kind to choose, the form, the pictures and the marks, and the messages from the team. It is in a
 * chunk of its own (see FeedbackGate.tsx). The page behind it is not touched, and no key reaches it: the remote walks over this and nothing else.
 */
export function FeedbackHost({ options, onClose }: HostProps) {
  const t = useT();
  const account = useAccount();
  const signedIn = account.me !== null;
  const role = useMemo(() => roleOfThisPage(), []);
  const handHeld = useMemo(() => thisIsHandHeld(), []);
  // A screen that only a remote walks (a TV): no pictures can be taken or chosen on it, and the form says where to do that.
  const picturesHere = useMemo(() => !(role === "tv" && !(typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches)), [role]);

  const start = useMemo(() => guess(options, role === "remote"), [options, role]);
  const [screen, setScreen] = useState<Screen>(() => initialScreen(options));
  const [form, setForm] = useState<FormState>(() => newForm(options.kind ?? "bug", start.area, start.chosen, options.text ?? ""));
  const [pieces, setPieces] = useState<Piece[]>([]);
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [send, setSend] = useState<SendState>({ phase: "idle" });
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(() => (options.kind || options.screen ? undefined : readDraft()));
  /** null: the form is showing; "ready": the form is out of the way and the bar waits; a number: the seconds before the picture is taken; "shooting": it is being taken. */
  const [capture, setCapture] = useState<null | "ready" | "shooting" | number>(null);
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const key = useRef(newKey());
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  const sent = screen.name === "sent";
  const sentRef = useRef(sent);
  sentRef.current = sent;
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => {
    document.documentElement.classList.add("fb-open");
    return () => document.documentElement.classList.remove("fb-open");
  }, []);
  // The pictures are let go with the form, and the focus goes back to what opened it.
  useEffect(
    () => () => {
      piecesRef.current.forEach(release);
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    },
    [],
  );
  useEffect(() => {
    if (readReceipts().length > 0 || signedIn) void refreshUnread(signedIn);
  }, [signedIn]);

  /* ------------------------------ going places ------------------------------ */

  const go = useCallback((next: Screen) => {
    setConfirming(false);
    setScreen(next);
  }, []);

  const change = useCallback((patch: Partial<FormState>) => {
    setSend((now) => (now.phase === "failed" ? { phase: "idle" } : now));
    setForm((now) => ({ ...now, ...patch }));
  }, []);

  const needsToAsk = pieces.length > 0 && !sent;
  const close = useCallback(() => {
    if (needsToAsk && !confirming) return setConfirming(true);
    onClose();
  }, [needsToAsk, confirming, onClose]);

  /** What Back does, on the phone's own button as on a remote's or a keyboard's: one step out, and the last step closes. */
  const back = useCallback(() => {
    if (confirming) return setConfirming(false);
    if (captureRef.current !== null) return setCapture(null);
    switch (screen.name) {
      case "annotate":
      case "where":
        return go({ name: "form" });
      case "form":
        return go({ name: "start" });
      case "thread":
        return go({ name: "mine" });
      case "mine":
        return options.screen === "mine" ? close() : go({ name: "start" });
      default:
        return close();
    }
  }, [confirming, screen.name, options.screen, go, close]);
  useBackToClose(back);

  /* ------------------------------ the draft ------------------------------ */

  // (a form that a screen opened for a problem leaves the draft alone until its person has written something: see `writtenByThePerson`)
  const opened = Boolean(options.kind || options.screen);
  const wroteDraft = useRef(false);
  const keepDraft = (now: FormState) => {
    if (opened && !writtenByThePerson(now, options.text ?? "")) return;
    wroteDraft.current = true;
    saveDraft(toDraft(now, Date.now()));
  };
  const keepDraftRef = useRef(keepDraft);
  keepDraftRef.current = keepDraft;
  useEffect(() => {
    if (sent) return;
    const timer = window.setTimeout(() => keepDraftRef.current(form), DRAFT_SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [form, sent]);
  useEffect(
    () => () => {
      // (what is on the form when it closes is kept, unless it was sent)
      if (!sentRef.current) keepDraftRef.current(formRef.current);
    },
    [],
  );

  /* ------------------------------ pictures ------------------------------ */

  const addFiles = useCallback(
    async (files: File[], role: AddRole) => {
      setProblem(null);
      setBusy(true);
      let now = piecesRef.current;
      for (const file of files) {
        const added = await pieceFromFile(file, role, now);
        if (added.ok) {
          now = [...now, added.piece];
          piecesRef.current = now;
          setPieces(now);
        } else {
          setProblem(t(`feedback.pic.${added.reason}` as Key));
          if (added.reason === "full") break;
        }
      }
      setBusy(false);
    },
    [t],
  );

  const shoot = useCallback(async () => {
    setCapture("shooting");
    await drawn();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const result = await captureScreen();
    setCapture(null);
    if (!result.ok) {
      setProblem(t(result.reason === "timeout" ? "feedback.capture.timeout" : "feedback.capture.failed"));
      return;
    }
    const added = pieceFromFitted(result.fitted, `screen-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.${result.fitted.mime === "image/png" ? "png" : "jpg"}`, piecesRef.current);
    if (!added.ok) {
      setProblem(t(`feedback.pic.${added.reason}` as Key));
      return;
    }
    const next = [...piecesRef.current, added.piece];
    piecesRef.current = next;
    setPieces(next);
    go({ name: "annotate", id: added.piece.id }); // (the point of showing the screen is to point at something on it)
  }, [go, t]);

  // The seconds before a picture is taken after a wait.
  useEffect(() => {
    if (typeof capture !== "number") return;
    const timer = window.setTimeout(() => (capture <= 1 ? void shoot() : setCapture(capture - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [capture, shoot]);

  const updatePiece = (id: string, patch: Partial<Piece>) => setPieces((all) => all.map((piece) => (piece.id === id ? { ...piece, ...patch } : piece)));
  const removePiece = (id: string) => {
    const gone = piecesRef.current.find((piece) => piece.id === id);
    if (gone) release(gone);
    setPieces((all) => all.filter((piece) => piece.id !== id));
  };

  /* ------------------------------ sending ------------------------------ */

  const submit = async () => {
    if (send.phase === "sending") return;
    setSend({ phase: "sending", waking: false });
    const { attachments, dropped } = await toAttachments(piecesRef.current);
    const payload = buildPayload(formRef.current, key.current, attachments, collectContext(formRef.current.include, { signedIn }));
    const result = await sendReport(payload, () => setSend((now) => (now.phase === "sending" ? { phase: "sending", waking: true } : now)));
    if (!result.ok) return setSend({ phase: "failed", reason: result.reason, ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}) });
    keepReceipt(payload, result.id, feedbackTitle({ message: payload.message }, t(`feedback.kind.${payload.kind}` as Key)));
    if (!opened || wroteDraft.current) clearDraft(); // (a draft this form never touched is somebody's other words: they stay)
    setDraft(undefined);
    piecesRef.current.forEach(release);
    piecesRef.current = [];
    setPieces([]);
    key.current = newKey();
    setForm(newForm("bug", start.area, false));
    setSend({ phase: "idle" });
    go({ name: "sent", answerable: payload.answer, rejected: result.rejected.length, dropped });
    if (payload.answer) void refreshUnread(signedIn, true);
  };

  /* ------------------------------ keys ------------------------------ */

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (captureRef.current !== null) return; // (the form is out of the way: the page is used as it always is)
    // Nothing that is pressed here is for the page behind (the TV's play and pause, full screen, the letters that stand for things).
    event.stopPropagation();
    if (event.altKey || event.ctrlKey || event.metaKey || !panel.current) return;
    if (event.key === "Tab") return keepInside(panel.current, event.nativeEvent);
    const action = actionForKey(event);
    const target = event.target as HTMLElement;
    if (action === "back") {
      event.preventDefault();
      return back();
    }
    if (action === "up" || action === "down" || action === "left" || action === "right") {
      if (target.tagName === "TEXTAREA" && (action === "up" || action === "down")) {
        // The cursor moves between the lines of the text first; at its first or last line the next press leaves it.
        const area = target as HTMLTextAreaElement;
        const before = [area.selectionStart, area.selectionEnd];
        requestAnimationFrame(() => {
          if (document.activeElement === area && area.selectionStart === before[0] && area.selectionEnd === before[1] && panel.current) moveFocus(panel.current, action as Direction);
        });
        return;
      }
      if (moveFocus(panel.current, action)) event.preventDefault();
    } else if (action === "select" && panel.current) {
      const items = navItems(panel.current);
      if (items.length > 0 && !items.includes(document.activeElement as HTMLElement) && !isEditable(target)) {
        items[0]!.focus();
        event.preventDefault();
      }
    }
  };

  // A key pressed while the focus is somewhere behind the form (a click on the dim edge took it there) is for the form, not for what is behind.
  useEffect(() => {
    const catchStray = (event: KeyboardEvent) => {
      if (captureRef.current !== null || event.altKey || event.ctrlKey || event.metaKey) return;
      const inside = root.current;
      if (!inside || (event.target instanceof Node && inside.contains(event.target)) || actionForKey(event) === null) return;
      event.stopPropagation();
      event.preventDefault();
      if (event.type === "keydown") (panel.current && (navItems(panel.current)[0] ?? panel.current))?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", catchStray, true);
    window.addEventListener("keyup", catchStray, true);
    return () => {
      window.removeEventListener("keydown", catchStray, true);
      window.removeEventListener("keyup", catchStray, true);
    };
  }, []);
  // While the form is out of the way, the page is used as usual: Escape is all that comes back here.
  useEffect(() => {
    if (capture === null) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && capture !== "shooting" && (event.preventDefault(), setCapture(null));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture]);

  // A screen's first thing has the focus when it opens (the first button for a remote; the form itself for a finger, which a keyboard must not jump up for).
  const where = `${screen.name}${screen.name === "annotate" ? screen.id : ""}${confirming}${capture === null}`;
  useEffect(() => {
    const inside = panel.current;
    if (!inside || capture !== null) return;
    (inside.querySelector<HTMLElement>(".fb-body") ?? inside).scrollTo?.(0, 0);
    const wanted = inside.querySelector<HTMLElement>("[data-autofocus]") ?? navItems(inside)[0];
    const typed = wanted && (wanted.tagName === "TEXTAREA" || wanted.tagName === "INPUT");
    (wanted && !(typed && handHeld) ? wanted : inside).focus({ preventScroll: true });
  }, [where]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------ what is drawn ------------------------------ */

  const marking = screen.name === "annotate" ? pieces.find((piece) => piece.id === screen.id) : undefined;
  const title =
    screen.name === "form"
      ? t(`feedback.kind.${form.kind}` as Key)
      : screen.name === "where"
        ? t("feedback.where")
        : screen.name === "mine" || screen.name === "thread"
          ? t("feedback.mine")
          : screen.name === "sent"
            ? t("feedback.sent.heading")
            : t("feedback.title");
  const hasBack = screen.name !== "start" && screen.name !== "sent";

  const pick = (kind: FeedbackKind) => {
    change({ kind });
    go({ name: "form" });
  };

  return (
    <div
      ref={root}
      className={`fb-root${role === "tv" ? " is-tv" : ""}${capture !== null ? " is-capturing" : ""}`}
      data-feedback-skip
      data-testid="feedback"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fb-title"
      onKeyDown={onKeyDown}
      onPaste={(event) => {
        const files = [...event.clipboardData.files];
        if (files.length === 0 || !picturesHere || screen.name !== "form") return; // (text is pasted as it always is)
        event.preventDefault();
        void addFiles(files, "screenshot");
      }}
      onDragOver={(event) => picturesHere && screen.name === "form" && event.dataTransfer.types.includes("Files") && event.preventDefault()}
      onDrop={(event) => {
        if (!picturesHere || screen.name !== "form") return;
        event.preventDefault();
        void addFiles([...event.dataTransfer.files], "screenshot");
      }}
    >
      <div className="fb-scrim" onClick={close} aria-hidden="true" />
      <div className={`fb-panel${screen.name === "annotate" ? " is-marking" : ""}`} ref={panel} tabIndex={-1}>
        {marking ? (
          <Annotator
            piece={marking}
            onCancel={() => go({ name: "form" })}
            onDone={(shapes) => {
              setBusy(true);
              go({ name: "form" });
              void withMarks(marking, shapes).then((next) => {
                updatePiece(marking.id, next);
                setBusy(false);
              });
            }}
          />
        ) : (
          <>
            <header className="fb-head">
              {hasBack ? (
                <button type="button" className="fb-icon-button" data-nav data-testid="fb-back" aria-label={t("common.back")} onClick={back}>
                  <ChevronIcon className="fb-flip" />
                </button>
              ) : (
                <span className="fb-head-space" />
              )}
              <h2 id="fb-title">{title}</h2>
              <button type="button" className="fb-icon-button" data-nav data-testid="fb-close" aria-label={t("common.close")} onClick={close}>
                <CloseIcon />
              </button>
            </header>
            {screen.name === "start" ? (
              <StartScreen
                onKind={pick}
                draft={draft}
                onContinue={() => {
                  if (draft) setForm(fromDraft(draft));
                  setDraft(undefined);
                  go({ name: "form" });
                }}
                onDiscard={() => {
                  clearDraft();
                  setDraft(undefined);
                }}
                hasMessages={signedIn || readReceipts().length > 0}
                onMine={() => go({ name: "mine" })}
              />
            ) : null}
            {screen.name === "form" ? (
              <FormScreen
                form={form}
                onChange={change}
                pieces={pieces}
                pictures={{
                  available: picturesHere,
                  camera: handHeld,
                  paste: !handHeld,
                  busy,
                  problem,
                  onCapture: () => {
                    setProblem(null);
                    setCapture("ready");
                  },
                  onFiles: (files, how) => void addFiles(files, how),
                  onMark: (id) => go({ name: "annotate", id }),
                  onRemove: removePiece,
                  onNote: (id, note) => updatePiece(id, { note }),
                }}
                send={send}
                onSend={() => void submit()}
                onWhere={() => go({ name: "where" })}
                signedIn={signedIn}
              />
            ) : null}
            {screen.name === "where" ? (
              <WhereScreen
                value={form.area}
                guessed={!form.areaChosen}
                onPick={(area) => {
                  change({ area, areaChosen: true });
                  go({ name: "form" });
                }}
              />
            ) : null}
            {screen.name === "sent" ? (
              <SentScreen answerable={screen.answerable} rejected={screen.rejected} dropped={screen.dropped} onMine={() => go({ name: "mine" })} onAnother={() => go({ name: "start" })} onClose={onClose} />
            ) : null}
            {screen.name === "mine" ? <MineScreen signedIn={signedIn} onOpen={(who) => go({ name: "thread", who })} onNew={() => go({ name: "start" })} /> : null}
            {screen.name === "thread" ? <ThreadScreen who={screen.who} signedIn={signedIn} /> : null}
            {confirming ? (
              <div className="fb-confirm" role="alertdialog" aria-modal="true" aria-labelledby="fb-confirm-title" data-testid="fb-confirm">
                <div className="fb-confirm-box">
                  <h3 id="fb-confirm-title">{t("feedback.leave.title")}</h3>
                  <p>{t("feedback.leave.text", { count: pieces.length })}</p>
                  <div className="fb-confirm-actions">
                    <button type="button" className="fb-primary" data-nav data-autofocus data-testid="fb-leave-stay" onClick={() => setConfirming(false)}>
                      {t("feedback.leave.stay")}
                    </button>
                    <button type="button" className="fb-secondary" data-nav data-testid="fb-leave-go" onClick={onClose}>
                      {t("feedback.leave.go")}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
      {capture !== null && capture !== "shooting" ? (
        <CaptureBar counting={typeof capture === "number" ? capture : null} onNow={() => void shoot()} onLater={() => setCapture(COUNTDOWN)} onCancel={() => setCapture(null)} />
      ) : null}
      {capture === "shooting" ? <Shutter /> : null}
    </div>
  );
}
