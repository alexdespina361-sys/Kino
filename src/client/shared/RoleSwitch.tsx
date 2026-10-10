import { useT } from "../i18n";
import { switchRole, type Role } from "../role";

/** "Use this screen as the TV" / "...as a remote": for the screen the page guessed wrong about. */
export function RoleSwitch({ to }: { to: Role }) {
  const t = useT();
  return (
    <button type="button" className="role-switch" data-nav data-testid={`switch-to-${to}`} onClick={() => switchRole(to)}>
      {to === "tv" ? t("role.asTv") : t("role.asRemote")}
    </button>
  );
}
