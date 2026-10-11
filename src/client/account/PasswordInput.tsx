import { useState, type InputHTMLAttributes } from "react";
import { useT } from "../i18n";
import { EyeIcon, EyeOffIcon } from "../shared/icons";

/** A password field with a little eye in it to see what was typed: on a phone one wrong letter is easy, and nobody is looking over a shoulder. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <span className="secret">
      <input {...props} type={shown ? "text" : "password"} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <button type="button" className="secret-eye" onClick={() => setShown(!shown)} aria-pressed={shown} aria-label={t(shown ? "auth.hidePassword" : "auth.showPassword")} data-testid="password-eye">
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
  );
}
