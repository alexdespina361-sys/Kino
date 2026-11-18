import type { CSSProperties } from "react";
import { useT } from "../i18n";
import { useHint } from "./backButton";
import "./exitHint.css";

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
