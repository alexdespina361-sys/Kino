import { useRef, type FocusEvent } from "react";
import type { AvatarId } from "../../shared";
import { Avatar } from "../account/Avatar";
import { GetTheApp, useAppRelease } from "../app/GetTheApp";
import { GoogleMark } from "../account/GoogleButton";
import { useFeedbackEntry } from "../feedback/entry";
import { useT } from "../i18n";
import { useCopy } from "../shared/CopyLink";
import { CheckIcon, CopyIcon, GearIcon, MessageIcon, UserIcon } from "../shared/icons";
import type { RailEntry } from "./Rail";

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
  /** The remote came to the button at this place of the banner's row (the library keeps it, to come back to it from Settings; on a phone, where the head scrolls with the page, it brings the button into view). */
  onArrive: (col: number, button: HTMLElement) => void;
  /** After Feedback, the menu's lines that a phone's bar of four has no room for (the watch party, the phone), as buttons. */
  places: readonly RailEntry[];
  /** Given for an account that has no Google account yet, where Google sign-in is on: the button, last of all, that goes to Google to connect one. */
  onConnectGoogle?: (() => void) | undefined;
  /** The profile's name#tag, where friends are on: what a friend types to find them (people did not know their own). It is shown under the name, and a button after all the others copies it. */
  tag?: string | undefined;
}

/**
 * The top of the profile's page, where the other pages have a banner: who is watching, Settings in the corner (the button for the remote,
 * the keyboard and the mouse alike) with Feedback next to it, and for a guest the way to sign in, which is what the guest has come to this page for.
 * (Feedback comes after Settings, so the remote still starts where it did; connecting Google, and copying the tag, come after all the others, for the same reason.)
 */
export function ProfileHead({ name, avatar, line, signedIn, canSignIn, onSignIn, onSettings, onArrive, places, onConnectGoogle, tag }: ProfileHeadProps) {
  const t = useT();
  const feedback = useFeedbackEntry();
  const tagShown = useRef<HTMLElement>(null);
  const [copying, copyTag] = useCopy(tag ?? "", tagShown);
  /** The Android app, on a phone's browser with Android (app/GetTheApp.tsx): a card under the buttons. Nothing on a TV. */
  const release = useAppRelease();
  const at = (col: number) => ({ "data-zone": "hero", "data-row": 0, "data-col": col, onFocus: (event: FocusEvent<HTMLElement>) => onArrive(col, event.currentTarget) });
  const settingsCol = signedIn || !canSignIn ? 0 : 1; // (a guest's Sign in is the button before it)
  const googleCol = settingsCol + 2 + places.length;
  return (
    <div className={release ? "tv-profile-head with-app" : "tv-profile-head"}>
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
        {tag && (
          <p className="tv-profile-tag" data-testid="tv-profile-tag">
            <span>{t("friends.yourTag")}</span>
            <b className="copy-code-text" ref={tagShown} data-testid="tv-profile-tag-text">
              {tag}
            </b>
          </p>
        )}
        {line && <p className="tv-profile-line">{line}</p>}
        {copying === "failed" && (
          <p className="tv-profile-tag-note" role="status">
            {t("friends.tagCopyFailed")}
          </p>
        )}
        {!signedIn && canSignIn && (
          <button className="tv-hero-button is-primary tv-profile-signin" onClick={onSignIn} data-testid="tv-profile-signin" {...at(0)}>
            <UserIcon /> {t("auth.signIn")}
          </button>
        )}
      </div>
      <div className="tv-profile-actions">
        <button className="tv-hero-button tv-profile-settings" onClick={onSettings} data-testid="tv-profile-settings" {...at(settingsCol)}>
          <GearIcon /> {t("tv.settings")}
        </button>
        <button className="tv-hero-button tv-profile-feedback" onClick={feedback.open} data-testid="tv-profile-feedback" {...at(settingsCol + 1)}>
          <MessageIcon /> {t("feedback.entry")}
          {feedback.unread > 0 && (
            <span className="tv-profile-badge" data-testid="tv-profile-feedback-unread">
              {feedback.unread}
            </span>
          )}
        </button>
        {places.map((place, index) => (
          <button key={place.id} className="tv-hero-button tv-profile-place" onClick={place.onPress} data-testid={place.testId} data-lit={place.lit ? "true" : undefined} {...at(settingsCol + 2 + index)}>
            {place.icon} {place.label}
            {place.badge && <span className="tv-profile-badge">{place.badge}</span>}
          </button>
        ))}
        {onConnectGoogle && (
          <button className="tv-hero-button tv-profile-google" onClick={onConnectGoogle} data-testid="tv-profile-google" {...at(googleCol)}>
            <GoogleMark /> {t("account.googleConnect")}
          </button>
        )}
        {tag && (
          <button className="tv-hero-button tv-profile-copy-tag" onClick={copyTag} data-testid="tv-profile-tag-copy" data-state={copying} {...at(googleCol + (onConnectGoogle ? 1 : 0))}>
            {copying === "copied" ? (
              <>
                <CheckIcon /> {t("friends.tagCopied")}
              </>
            ) : (
              <>
                <CopyIcon /> {t("friends.copyTag")}
              </>
            )}
          </button>
        )}
      </div>
      {release && <GetTheApp release={release} className="in-profile-head" />}
    </div>
  );
}
