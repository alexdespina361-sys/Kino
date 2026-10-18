import type { CSSProperties } from "react";
import { useT } from "../i18n";
import { useHint } from "./backButton";
import "./exitHint.css";

/**
 * The line at the bottom of the screen that asks for a Back to be pressed again (see backButton.ts): it says what the second one does, and a
 * thin line runs down the time there is to press it. It sits over everything and takes no press.
 */
export function ExitHint() {
  const t = useT();
  const hint = useHint();
  if (!hint) return null;
  return (
    <p className={hint.lifted ? "exit-hint lifted" : "exit-hint"} key={hint.id} role="status" data-testid="exit-hint" style={{ "--ask-ms": `${hint.ms}ms` } as CSSProperties}>
      {t(hint.text)}
    </p>
  );
}
