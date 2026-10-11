import { useState, type FormEvent } from "react";
import { AVATAR_IDS, MAX_PROFILES, PROFILE_NAME_MAX, type AvatarId, type Profile } from "../../shared";
import { useT } from "../i18n";
import { PencilIcon, PlusIcon, TrashIcon } from "../shared/icons";
import { Avatar } from "./Avatar";
import { describeError } from "./errors";

interface GridProps {
  profiles: readonly Profile[];
  /** The profile in use, marked with a ring. */
  current?: string | null | undefined;
  /** "pick": choosing who is watching. "manage": each one opens its editor instead. */
  mode?: "pick" | "manage";
  onPick: (profile: Profile) => void;
  /** Shown as a "new profile" tile while there is room for one. */
  onAdd?: () => void;
  /** On the TV every tile is reached with the remote's arrow keys. */
  tv?: boolean;
}

/** "Who's watching?": the profiles of an account as big pictures with names, and a tile to add one while there is room. */
export function ProfileGrid({ profiles, current, mode = "pick", onPick, onAdd, tv = false }: GridProps) {
  const t = useT();
  const nav = tv ? { "data-nav": true } : {};
  return (
    <ul className={`profile-grid${tv ? " profile-tv" : ""}`} data-testid="profile-grid">
      {profiles.map((profile) => (
        <li key={profile.id}>
          <button
            className="profile-tile"
            onClick={() => onPick(profile)}
            aria-current={profile.id === current ? "true" : undefined}
            data-testid={`profile-${profile.name}`}
            aria-label={mode === "manage" ? `${t("profiles.edit")}: ${profile.name}` : profile.name}
            {...nav}
            {...(tv && profile.id === current ? { "data-autofocus": true } : {})}
          >
            <span className="profile-picture">
              <Avatar id={profile.avatar} className="profile-avatar" />
              {mode === "manage" && (
                <span className="profile-pencil" aria-hidden="true">
                  <PencilIcon />
                </span>
              )}
            </span>
            <span className="profile-name">{profile.name}</span>
          </button>
        </li>
      ))}
      {onAdd && profiles.length < MAX_PROFILES && (
        <li>
          <button className="profile-tile profile-add" onClick={onAdd} data-testid="profile-add" aria-label={t("profiles.add")} {...nav}>
            <span className="profile-picture">
              <span className="profile-plus">
                <PlusIcon />
              </span>
            </span>
            <span className="profile-name">{t("profiles.add")}</span>
          </button>
        </li>
      )}
    </ul>
  );
}

interface EditorProps {
  /** Absent: a new profile. */
  profile?: Profile | undefined;
  /** The pictures already taken by the account's other profiles (a new profile starts on the first free one). */
  taken?: readonly AvatarId[];
  onSave: (name: string, avatar: AvatarId) => Promise<void>;
  onCancel: () => void;
  /** Absent for the only profile an account has: it can't be removed. */
  onDelete?: (() => Promise<void>) | undefined;
  /** On the TV every control is reached with the remote's arrow keys (`data-nav`), and the buttons look like the TV's. */
  tv?: boolean;
}

/** The name and picture of one profile. */
export function ProfileEditor({ profile, taken = [], onSave, onCancel, onDelete, tv = false }: EditorProps) {
  const t = useT();
  const [name, setName] = useState(profile?.name ?? "");
  const [avatar, setAvatar] = useState<AvatarId>(profile?.avatar ?? AVATAR_IDS.find((id) => !taken.includes(id)) ?? AVATAR_IDS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const nav = tv ? { "data-nav": true } : {};
  const buttonClass = (kind: "main" | "plain" | "danger") =>
    tv ? `tv-action${kind === "main" ? " tv-action-primary" : kind === "danger" ? " tv-action-danger" : ""}` : `btn${kind === "main" ? " btn-red" : kind === "danger" ? " btn-danger" : ""}`;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) void run(() => onSave(name.trim(), avatar));
  };

  return (
    <form className={`profile-editor${tv ? " profile-editor-tv" : ""}`} onSubmit={submit} noValidate data-testid="profile-editor">
      <div className="editor-preview">
        <Avatar id={avatar} className="profile-avatar editor-avatar" />
      </div>
      <label className="auth-field">
        <span>{t("profiles.name")}</span>
        <input
          data-testid="profile-name-input"
          value={name}
          maxLength={PROFILE_NAME_MAX}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          onChange={(event) => setName(event.target.value)}
          {...nav}
        />
      </label>
      <fieldset className="avatar-picker">
        <legend>{t("profiles.picture")}</legend>
        <div role="radiogroup" aria-label={t("profiles.picture")} className="avatar-choices">
          {AVATAR_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={id === avatar}
              aria-label={t(`avatar.${id}`)}
              className="avatar-choice"
              onClick={() => setAvatar(id)}
              data-testid={`avatar-${id}`}
              {...nav}
            >
              <Avatar id={id} className="choice-avatar" />
            </button>
          ))}
        </div>
      </fieldset>

      {error && (
        <p className="auth-error" role="alert" data-testid="profile-error">
          {error}
        </p>
      )}

      <div className="editor-actions">
        <button type="submit" className={buttonClass("main")} disabled={busy || !name.trim()} data-testid="profile-save" {...nav}>
          {t("common.save")}
        </button>
        <button type="button" className={buttonClass("plain")} onClick={onCancel} disabled={busy} data-testid="profile-cancel" {...nav}>
          {t("common.cancel")}
        </button>
      </div>

      {onDelete &&
        (confirming ? (
          <div className="editor-confirm" role="alert">
            <p>{t("profiles.deleteAsk", { name: profile?.name ?? "" })}</p>
            <div className="editor-actions">
              <button type="button" className={buttonClass("danger")} disabled={busy} onClick={() => void run(onDelete)} data-testid="profile-delete-confirm" {...nav}>
                <TrashIcon /> {t("common.delete")}
              </button>
              {/* The button that was pressed is gone: on the TV the remote lands on the safe answer. */}
              <button type="button" className={buttonClass("plain")} disabled={busy} onClick={() => setConfirming(false)} data-testid="profile-delete-cancel" autoFocus={tv} {...nav}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : tv ? (
          <button type="button" className={buttonClass("danger")} onClick={() => setConfirming(true)} disabled={busy} data-testid="profile-delete" {...nav}>
            <TrashIcon /> {t("profiles.delete")}
          </button>
        ) : (
          <button type="button" className="auth-switch danger" onClick={() => setConfirming(true)} disabled={busy} data-testid="profile-delete">
            <TrashIcon /> {t("profiles.delete")}
          </button>
        ))}
    </form>
  );
}
