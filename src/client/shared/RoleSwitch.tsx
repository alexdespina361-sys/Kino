import { useT } from "../i18n";
import { isTvAgent, switchRole, type Role } from "../role";

export function RoleSwitch({ to }: { to: Role }) {
  const t = useT();
  if (to === "remote" && typeof navigator !== "undefined" && isTvAgent(navigator.userAgent)) return null;
  return (
    <button type="button" className="role-switch" data-nav data-testid={`switch-to-${to}`} onClick={() => switchRole(to)}>
      {to === "tv" ? t("role.asTv") : t("role.asRemote")}
    </button>
  );
}
