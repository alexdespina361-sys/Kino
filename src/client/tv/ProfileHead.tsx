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
  name: string;
  avatar: AvatarId | undefined;
  line: string;
  signedIn: boolean;
  canSignIn: boolean;
  onSignIn: () => void;
  onSettings: () => void;
  onArrive: (col: number, button: HTMLElement) => void;
  places: readonly RailEntry[];
  onConnectGoogle?: (() => void) | undefined;
  tag?: string | undefined;
}

export function ProfileHead({ name, avatar, line, signedIn, canSignIn, onSignIn, onSettings, onArrive, places, onConnectGoogle, tag }: ProfileHeadProps) {
  const t = useT();
  const feedback = useFeedbackEntry();
  const tagShown = useRef<HTMLElement>(null);
  const [copying, copyTag] = useCopy(tag ?? "", tagShown);
  const release = useAppRelease();
  const at = (col: number) => ({ "data-zone": "hero", "data-row": 0, "data-col": col, onFocus: (event: FocusEvent<HTMLElement>) => onArrive(col, event.currentTarget) });
  const settingsCol = signedIn || !canSignIn ? 0 : 1;
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
