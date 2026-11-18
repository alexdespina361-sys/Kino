export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
  }
  return copyFromField(text);
}

export const canPaste = (): boolean => typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";

export async function pasteText(): Promise<string | null> {
  try {
    return canPaste() ? await navigator.clipboard.readText() : null;
  } catch {
    return null;
  }
}

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
  }
  field.remove();
  before?.focus?.({ preventScroll: true });
  return copied;
}
