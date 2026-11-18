import { actionForKey } from "./keys";

export function pressWhatOkPresses(): () => void {
  let down: KeyboardEvent | null = null;
  const onDown = (event: KeyboardEvent) => {
    const target = event.target;
    down = !event.repeat && actionForKey(event) === "select" && target instanceof HTMLElement && target.matches("button, a[href]") ? event : null;
  };
  const onTyped = () => {
    down = null;
  };
  const onUp = () => {
    const pressed = down;
    down = null;
    const target = pressed?.target;
    if (!pressed || pressed.defaultPrevented || !(target instanceof HTMLElement)) return;
    if (target.isConnected && document.activeElement === target) target.click();
  };
  window.addEventListener("keydown", onDown, true);
  window.addEventListener("keypress", onTyped, true);
  window.addEventListener("keyup", onUp, true);
  return () => {
    window.removeEventListener("keydown", onDown, true);
    window.removeEventListener("keypress", onTyped, true);
    window.removeEventListener("keyup", onUp, true);
  };
}
