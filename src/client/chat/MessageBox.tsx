import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type ClipboardEvent, type DragEvent, type FocusEvent, type KeyboardEvent } from "react";

/**
 * Whether the browser knows `contenteditable="plaintext-only"` (Chrome and Safari for years, Firefox since 136): what is pasted or dropped in is
 * then text, never pictures or links. Else the box is "true", and a paste is made plain here.
 */
const PLAIN = (() => {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("div");
  try {
    probe.contentEditable = "plaintext-only";
  } catch {
    return false; // (a browser that does not know it says so by throwing)
  }
  return probe.contentEditable === "plaintext-only";
})();

/** Before the screen is drawn in a browser (no flash of the old words); on the server, where nothing is drawn, the plain one (which says nothing there). */
const useSync = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The text of the box as a message: one line (a line break that got in is a space, as a one-line box would have it), the spaces the browser keeps as `&nbsp;` plain. */
export function boxText(raw: string): string {
  return raw.replace(/\r\n?|\n/g, " ").replace(/ /g, " ");
}

/**
 * `text` cut to at most `max` characters (as the server counts them: UTF-16 units) without cutting a letter in two: an emoji is two units, a flag or a family
 * several letters joined, and half of one is a "?" box. Where the browser cannot say where letters end, a pair of units is still kept whole.
 */
export function cutTo(text: string, max: number): string {
  if (text.length <= max) return text;
  const near = text.slice(0, max + 32); // (where the cut falls is all that is looked at, never a pasted book)
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

/**
 * What is left in a box after `sent` was sent from it, when it holds `now`: nothing if it is still what was sent, what was typed after it if it was only
 * added to, and otherwise all of it (it was changed while the message was on its way: that is the next message, and none of it is taken away).
 */
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
  /** What is in the box now, already cut to `maxLength`. */
  onChange: (text: string) => void;
  /** Enter, or the keyboard's Send key. */
  onSend: () => void;
  maxLength: number;
  placeholder: string;
  label: string;
  className: string;
  testId: string;
  /** Any further attributes the box should carry (`data-nav`, `data-autofocus`). */
  extra?: Record<string, string | boolean>;
}

/**
 * The box a message is typed in on a phone: an editable area, not a form field (the owner, 16 Nov: Chrome on Android put the strip of its form filler,
 * the key, the card and the pin, over the box, between the box and the keyboard, and the page cannot know how tall that strip is; it comes only for
 * form fields, and web messengers type in an area like this one for that reason, among others). It acts as a one-line box: Enter or the keyboard's
 * Send key sends, a paste is plain text on one line, what is typed stops at `maxLength`, and the words in it are the `value` the page holds. It grows
 * a few lines with a long message, then scrolls. A computer keeps the plain box (ChatTv.tsx): it has no strip.
 */
export const MessageBox = forwardRef<HTMLDivElement | null, MessageBoxProps>(function MessageBox({ value, onChange, onSend, maxLength, placeholder, label, className, testId, extra = {} }, ref) {
  const box = useRef<HTMLDivElement>(null);
  useImperativeHandle<HTMLDivElement | null, HTMLDivElement | null>(ref, () => box.current, []);
  // (Sending is the parent's; this only keeps one press of Enter from sending twice, by the key and by what the browser would type for it.)
  const sentAt = useRef(0);
  const send = () => {
    const at = Date.now();
    if (at - sentAt.current < 250) return;
    sentAt.current = at;
    onSend();
  };

  // The words the page holds and what the box shows are the same: when the page changes them (the box emptied after a send, a draft brought back,
  // a paste cut to the limit) the box is written anew and the caret put at its end. While they agree it is left alone, so that the keyboard's own
  // word in the making (Android types each word as one) is never written over.
  useSync(() => {
    const element = box.current;
    if (!element || textOf(element) === value) return;
    element.textContent = value;
    if (document.activeElement === element) caretToEnd(element);
  }, [value]);

  // The browser's own wish to break the line (Enter on a keyboard that does not say which key it was, as Android's can) sends instead; never a line break.
  // While a word is still being made (a keyboard's composition: Japanese, a Gboard suggestion) the Enter is the keyboard's, to choose the word with: it
  // does not send.
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
      // (Emptied by hand, a browser can leave a line break behind, which would hide the placeholder.)
      if (element.childNodes.length > 0) element.replaceChildren();
      onChange("");
      return;
    }
    const text = textOf(element);
    if (text.length > maxLength) {
      // (A word still being made is not written over: the keyboard would lose it. It is cut when it is made, see `compositionEnd`.)
      if (composing) return;
      // (Cut here, in the box itself: one letter past the limit leaves the page's words as they were, so nothing would draw the box again and it would
      // show more than is sent.)
      const cut = cutTo(text, maxLength);
      element.textContent = cut;
      caretToEnd(element);
      onChange(cut);
      return;
    }
    onChange(text);
  };

  /** Puts plain `text` in the box where the caret is, as the browser's own typing where it can (so that its undo knows it), cut so the box can hold it. */
  const insertPlain = (raw: string) => {
    const text = cutTo(boxText(raw).replace(/ {2,}/g, " "), maxLength);
    if (!text) return;
    // (The browser's own typing; deprecated, and still the one way its undo knows. Where it is gone, the text is put in by hand.)
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

  // A paste is plain text on one line, and never more than the box holds (a pasted book is cut before it is put in, not after).
  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    insertPlain(event.clipboardData.getData("text/plain"));
  };

  // (Where the box is not plain, what is dropped in could be a picture or a link: the drop is made here, as its text, where it was let go.)
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

  // A word that was being made over the limit is cut once it is made.
  const compositionEnd = () => input();

  // A box given the keyboard by the page (as after a send) puts the caret at the end, not before the first word, as a form field would.
  const focus = (event: FocusEvent<HTMLDivElement>) => {
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

/** Keeps the keyboard up while the Send button beside the box is pressed: the press does not take the box's place (a phone would put its keyboard away, then bring it back). */
export function keepTheBox(event: { preventDefault: () => void; button?: number }) {
  if ((event.button ?? 0) === 0) event.preventDefault();
}
