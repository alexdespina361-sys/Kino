import { switchRole, type Role } from "../role";

/** "Use this screen as the TV" / "...as a remote": for the screen the page guessed wrong about. */
export function RoleSwitch({ to }: { to: Role }) {
  return (
    <button type="button" className="role-switch" data-testid={`switch-to-${to}`} onClick={() => switchRole(to)}>
      {to === "tv" ? "Use this screen as the TV" : "Use this screen as a remote"}
    </button>
  );
}
