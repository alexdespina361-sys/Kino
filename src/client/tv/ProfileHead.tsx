import type { AvatarId } from "../../shared";
import { Avatar } from "../account/Avatar";
import { useT } from "../i18n";
import { GearIcon, UserIcon } from "../shared/icons";

interface ProfileHeadProps {
  /** Whoever is watching: the profile in use, or a guest (no account on this TV). */
  name: string;
  avatar: AvatarId | undefined;
  /** The line under the name: the account, or for a guest what signing in is for. */
  line: string;
  signedIn: boolean;
  /** There is somewhere to sign in (not on a server that has no accounts): the button, and the line about what signing in is for, are there only then. */
  canSignIn: boolean;
  onSignIn: () => void;
  onSettings: () => void;
  /** The remote came to the button at this place of the banner's row (the library keeps it, to come back to it from Settings). */
  onArrive: (col: number) => void;
}

/**
 * The top of the profile's page, where the other pages have a banner: who is watching, Settings in the corner (the button for the remote,
 * the keyboard and the mouse alike), and for a guest the way to sign in, which is what the guest has come to this page for.
 */
export function ProfileHead({ name, avatar, line, signedIn, canSignIn, onSignIn, onSettings, onArrive }: ProfileHeadProps) {
  const t = useT();
  const at = (col: number) => ({ "data-zone": "hero", "data-row": 0, "data-col": col, onFocus: () => onArrive(col) });
  return (
    <div className="tv-profile-head">
      {signedIn && avatar ? (
        <Avatar id={avatar} className="tv-profile-avatar" />
      ) : (
        <span className="tv-profile-guest" aria-hidden="true">
          <UserIcon />
        </span>
      )}
      <div className="tv-profile-who">
        <h1 className="tv-profile-name" data-testid="tv-profile-name">
          {name}
        </h1>
        {line && <p className="tv-profile-line">{line}</p>}
        {!signedIn && canSignIn && (
          <button className="tv-hero-button is-primary tv-profile-signin" onClick={onSignIn} data-testid="tv-profile-signin" {...at(0)}>
            <UserIcon /> {t("auth.signIn")}
          </button>
        )}
      </div>
      <button className="tv-hero-button tv-profile-settings" onClick={onSettings} data-testid="tv-profile-settings" {...at(signedIn || !canSignIn ? 0 : 1)}>
        <GearIcon /> {t("tv.settings")}
      </button>
    </div>
  );
}
