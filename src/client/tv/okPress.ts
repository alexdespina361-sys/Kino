import { actionForKey } from "./keys";

/**
 * OK on a focused button presses it, in every screen of the TV. A browser makes that press when it sees the key as a typed Enter (a
 * "keypress" after the key goes down), and a TV's browser may send the remote's OK as a key down and up only, which leaves every
 * button dead. So when OK went down on a button or link and no keypress came, and the page did not take the key for something else,
 * the press is made when the key comes up. A browser that does press by itself is never pressed twice: its keypress comes first.
 */
export function pressWhatOkPresses(): () => void {
  let down: KeyboardEvent | null = null;
  const onDown = (event: KeyboardEvent) => {
    const target = event.target;
    down = !event.repeat && actionForKey(event) === "select" && target instanceof HTMLElement && target.matches("button, a[href]") ? event : null;
  };
  const onTyped = () => {
    down = null; // the browser makes this press itself
  };
  const onUp = () => {
    const pressed = down;
    down = null;
    const target = pressed?.target;
    if (!pressed || pressed.defaultPrevented || !(target instanceof HTMLElement)) return; // (a key the page took is not a press)
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
