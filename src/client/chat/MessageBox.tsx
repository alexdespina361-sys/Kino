import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type ClipboardEvent, type DragEvent, type FocusEvent, type KeyboardEvent } from "react";

const PLAIN = (() => {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("div");
  try {
    probe.contentEditable = "plaintext-only";
  } catch {
    return false;
  }
  return probe.contentEditable === "plaintext-only";
})();

const useSync = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function boxText(raw: string): string {
  return raw.replace(/\r\n?|\n/g, " ").replace(/ /g, " ");
}

export function cutTo(text: string, max: number): string {
  if (text.length <= max) return text;
  const near = text.slice(0, max + 32);
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    let end = 0;
    for (const { index, segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(near)) {
      if (index + segment.length > max) break;
      end = index + segment.length;
    }
    return text.slice(0, end);
  }
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

export function afterSent(now: string, sent: string): string {
  if (now === sent) return "";
  if (now.startsWith(sent)) return now.slice(sent.length).trim();
  return now;
}

function textOf(element: HTMLElement): string {
  return boxText(element.innerText ?? element.textContent ?? "");
}

function caretToEnd(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export interface MessageBoxProps {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  maxLength: number;
  placeholder: string;
  label: string;
  className: string;
  testId: string;
  extra?: Record<string, string | boolean>;
  onFocused?: () => void;
}

export const MessageBox = forwardRef<HTMLDivElement | null, MessageBoxProps>(function MessageBox({ value, onChange, onSend, maxLength, placeholder, label, className, testId, extra = {}, onFocused }, ref) {
  const box = useRef<HTMLDivElement>(null);
  useImperativeHandle<HTMLDivElement | null, HTMLDivElement | null>(ref, () => box.current, []);
  const sentAt = useRef(0);
  const send = () => {
    const at = Date.now();
    if (at - sentAt.current < 250) return;
    sentAt.current = at;
    onSend();
  };

  useSync(() => {
    const element = box.current;
    if (!element || textOf(element) === value) return;
    element.textContent = value;
    if (document.activeElement === element) caretToEnd(element);
  }, [value]);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const before = (event: InputEvent) => {
      const breaks = event.inputType === "insertParagraph" || event.inputType === "insertLineBreak" || (event.inputType === "insertText" && event.data === "\n");
      if (!breaks) return;
      event.preventDefault();
      if (!event.isComposing) send();
    };
    element.addEventListener("beforeinput", before);
    return () => element.removeEventListener("beforeinput", before);
  });

  const input = (composing = false) => {
    const element = box.current;
    if (!element) return;
    if (element.textContent === "") {
      if (element.childNodes.length > 0) element.replaceChildren();
      onChange("");
      return;
    }
    const text = textOf(element);
    if (text.length > maxLength) {
      if (composing) return;
      const cut = cutTo(text, maxLength);
      element.textContent = cut;
      caretToEnd(element);
      onChange(cut);
      return;
    }
    onChange(text);
  };

  const insertPlain = (raw: string) => {
    const text = cutTo(boxText(raw).replace(/ {2,}/g, " "), maxLength);
    if (!text) return;
    if (!document.execCommand?.("insertText", false, text)) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      input();
    }
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    send();
  };

  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    insertPlain(event.clipboardData.getData("text/plain"));
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    if (PLAIN) return;
    event.preventDefault();
    const text = event.dataTransfer.getData("text/plain");
    if (!text) return;
    const element = event.currentTarget;
    element.focus();
    const at = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const selection = window.getSelection();
    if (at && selection && element.contains(at.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(at);
    }
    insertPlain(text);
  };

  const compositionEnd = () => input();

  const focus = (event: FocusEvent<HTMLDivElement>) => {
    onFocused?.();
    const element = event.currentTarget;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && element.contains(selection.anchorNode) && selection.anchorNode !== element) return;
    if (element.textContent) caretToEnd(element);
  };

  return (
    <div
      ref={box}
      className={className}
      contentEditable={PLAIN ? "plaintext-only" : true}
      role="textbox"
      aria-label={label}
      aria-placeholder={placeholder}
      aria-multiline="false"
      data-placeholder={placeholder}
      data-max-length={maxLength}
      enterKeyHint="send"
      inputMode="text"
      autoCapitalize="sentences"
      autoCorrect="on"
      spellCheck
      onInput={(event) => input((event.nativeEvent as InputEvent).isComposing === true)}
      onKeyDown={keyDown}
      onPaste={paste}
      onDrop={drop}
      onCompositionEnd={compositionEnd}
      onFocus={focus}
      {...extra}
      data-testid={testId}
    />
  );
});

export function keepTheBox(event: { preventDefault: () => void; button?: number }) {
  if ((event.button ?? 0) === 0) event.preventDefault();
}
