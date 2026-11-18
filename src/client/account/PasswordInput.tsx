import { useState, type InputHTMLAttributes } from "react";
import { useT } from "../i18n";
import { EyeIcon, EyeOffIcon } from "../shared/icons";

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
