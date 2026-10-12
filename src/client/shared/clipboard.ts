/**
 * Puts `text` on the clipboard. False when the browser would not: a page that is not secure has no clipboard to write to, and some
 * refuse it without a press. (Called from a press, as every browser wants.)
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* refused: the old way below may still be let through */
  }
  return copyFromField(text);
}

/** The old way, for a page with no clipboard of its own to write to (a TV's browser, a page that is not secure): select a hidden field and copy from it. */
function copyFromField(text: string): boolean {
  if (typeof document === "undefined") return false;
  const before = document.activeElement as HTMLElement | null;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    /* not allowed here either */
  }
  field.remove();
  // (Selecting the field took the focus off the button the remote was on, and a page with the focus nowhere does not answer its arrow keys.)
  before?.focus?.({ preventScroll: true });
  return copied;
}
