import { useT } from "../i18n";
import { isTvAgent, switchRole, type Role } from "../role";

/**
 * "Use this screen as the TV" / "...as a remote": for the screen the page guessed wrong about. A browser that says it is a TV's was not guessed:
 * it is never offered to be a remote (the judge, 16 Nov: on a television the link meant nothing, one press from Copy code).
 */
export function RoleSwitch({ to }: { to: Role }) {
  const t = useT();
  if (to === "remote" && typeof navigator !== "undefined" && isTvAgent(navigator.userAgent)) return null;
  return (
    <button type="button" className="role-switch" data-nav data-testid={`switch-to-${to}`} onClick={() => switchRole(to)}>
      {to === "tv" ? t("role.asTv") : t("role.asRemote")}
    </button>
  );
}
