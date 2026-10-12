import { useEffect, useState, type ReactNode } from "react";
import type { Profile } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { Avatar } from "../account/Avatar";
import { AuthForm } from "../account/AuthForm";
import { ProfileEditor, ProfileGrid } from "../account/Profiles";
import { useFriends } from "../friends/FriendsProvider";
import { useT } from "../i18n";
import { ChevronIcon, GearIcon, LockIcon, LogoutIcon, PencilIcon, PhoneIcon, ScanIcon, UserIcon, UsersIcon } from "../shared/icons";
import { Logo } from "../shared/Logo";
import type { Entry } from "../tv/pages";
import { DevicesPage, LinkPage, SecurityPage, SettingsPage } from "./AccountPages";
import { LinkApprove } from "../account/LinkApprove";
import { useBackToClose } from "./backButton";
import { FriendPage, FriendsPage } from "./Friends";
import { sheetIsOpen } from "./Sheet";

/** A full-screen page with a way back: the phone's account pages stack like the pages of a settings app. */
export function Page({ title, onBack, children, testId }: { title: string; onBack: () => void; children: ReactNode; testId?: string }) {
  const t = useT();
  useBackToClose(onBack); // (the phone's own Back goes back a page too, instead of leaving the site)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !sheetIsOpen() && onBack();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);
  return (
    <div className="page" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <header className="page-head">
        <button className="icon-btn" onClick={onBack} aria-label={t("common.back")} data-testid="page-back">
          <ChevronIcon className="flip" />
        </button>
        <h2>{title}</h2>
      </header>
      <div className="page-body">{children}</div>
    </div>
  );
}

type View = "main" | "picker" | "profiles" | "edit" | "settings" | "devices" | "security" | "link" | "approve" | "friends" | "friend";

function MenuRow({ icon, label, onClick, testId, detail }: { icon: ReactNode; label: string; onClick: () => void; testId: string; detail?: string }) {
  return (
    <button className="menu-row" onClick={onClick} data-testid={testId}>
      <span className="menu-icon">{icon}</span>
      <span className="menu-label">{label}</span>
      {detail && <small>{detail}</small>}
      <ChevronIcon />
    </button>
  );
}

/** Everything about the account on the phone: who is signed in, the profiles, settings, devices, and signing a TV in. */
export function AccountScreen({
  onClose,
  initial = "main",
  onSessionsChanged,
  onOpenTitle,
}: {
  onClose: () => void;
  initial?: View;
  onSessionsChanged?: () => void;
  /** A title a friend sent, or has in a list, was tapped (not given on a phone that has no TV to play it on). */
  onOpenTitle?: (entry: Entry) => void;
}) {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const [view, setView] = useState<View>(initial);
  const [editing, setEditing] = useState<Profile | "new" | null>(null);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  /** The friend whose page is open, and the page the friends were opened from (the settings, or the account's menu). */
  const [friendId, setFriendId] = useState<string | null>(null);
  const [friendsFrom, setFriendsFrom] = useState<View>("main");
  const { me, profile } = account;
  const back = () => setView("main");
  const openFriends = (from: View) => {
    setFriendsFrom(from);
    setView("friends");
  };

  // Signed in just now: the page for guests (the form) gives way to the page of the account.
  useEffect(() => {
    if (me && view === "main" && account.choosing) setView("picker");
  }, [me, view, account.choosing]);

  if (view === "approve" && linkCode) {
    return (
      <Page title={t("account.signInTv")} onBack={() => setView("link")} testId="approve-page">
        <LinkApprove code={linkCode} onClose={back} />
      </Page>
    );
  }
  if (view === "link") {
    return (
      <Page title={t("account.signInTv")} onBack={back}>
        <LinkPage
          onCode={(code) => {
            setLinkCode(code);
            setView("approve");
          }}
        />
      </Page>
    );
  }
  if (view === "settings") {
    return (
      <Page title={t("settings.title")} onBack={back}>
        <SettingsPage onOpenFriends={() => openFriends("settings")} />
      </Page>
    );
  }
  if (view === "friend" && friendId) {
    return (
      <Page title={t("friends.title")} onBack={() => setView("friends")} testId="friend-screen">
        <FriendPage friendId={friendId} onOpenTitle={onOpenTitle} onGone={() => setView("friends")} />
      </Page>
    );
  }
  if (view === "friends") {
    return (
      <Page title={t("friends.title")} onBack={() => setView(friendsFrom)} testId="friends-screen">
        <FriendsPage
          onOpenFriend={(id) => {
            setFriendId(id);
            setView("friend");
          }}
          onOpenTitle={onOpenTitle}
        />
      </Page>
    );
  }
  if (view === "devices") {
    return (
      <Page title={t("account.devices")} onBack={back}>
        <DevicesPage onChanged={onSessionsChanged} />
      </Page>
    );
  }
  if (view === "security") {
    return (
      <Page title={t("account.security")} onBack={back}>
        <SecurityPage onDeleted={onClose} />
      </Page>
    );
  }
  if (view === "picker" && me) {
    return (
      <Page title={t("profiles.title")} onBack={account.choosing ? onClose : back}>
        <ProfileGrid
          profiles={me.profiles}
          current={profile?.id}
          onPick={(picked) => {
            account.choose(picked.id);
            onClose();
          }}
        />
      </Page>
    );
  }
  if (view === "profiles" && me) {
    return (
      <Page title={t("profiles.manage")} onBack={back}>
        <ProfileGrid
          profiles={me.profiles}
          current={profile?.id}
          mode="manage"
          onPick={(picked) => {
            setEditing(picked);
            setView("edit");
          }}
          onAdd={() => {
            setEditing("new");
            setView("edit");
          }}
        />
        <p className="muted small center">{t("profiles.count", { count: me.profiles.length, max: 5 })}</p>
      </Page>
    );
  }
  if (view === "edit" && me && editing) {
    const existing = editing === "new" ? undefined : editing;
    const done = () => {
      setEditing(null);
      setView("profiles");
    };
    return (
      <Page title={existing ? t("profiles.edit") : t("profiles.new")} onBack={done}>
        <ProfileEditor
          profile={existing}
          taken={me.profiles.map((other) => other.avatar)}
          onSave={async (name, avatar) => {
            if (existing) await account.updateProfile(existing.id, { name, avatar });
            else await account.addProfile(name, avatar);
            done();
          }}
          onCancel={done}
          onDelete={existing && me.profiles.length > 1 ? async () => {
            await account.deleteProfile(existing.id);
            done();
          } : undefined}
        />
      </Page>
    );
  }

  return (
    <Page title={t("account.title")} onBack={onClose} testId="account-screen">
      {me && profile ? (
        <div className="page-stack">
          <section className="account-card" data-testid="account-card">
            <Avatar id={profile.avatar} className="account-avatar" />
            <div className="account-who">
              <h1 data-testid="account-profile-name">{profile.name}</h1>
              <p className="muted">{t("account.signedInAs", { email: me.account.email })}</p>
            </div>
          </section>
          <nav className="menu">
            {me.profiles.length > 1 && <MenuRow icon={<UserIcon />} label={t("profiles.switch")} onClick={() => setView("picker")} testId="menu-switch" />}
            <MenuRow icon={<PencilIcon />} label={t("profiles.manage")} onClick={() => setView("profiles")} testId="menu-profiles" />
            <MenuRow icon={<ScanIcon />} label={t("account.signInTv")} onClick={() => setView("link")} testId="menu-link" />
            {friends.on && <MenuRow icon={<UsersIcon />} label={t("friends.title")} detail={friends.unread > 0 ? String(friends.unread) : undefined} onClick={() => openFriends("main")} testId="menu-friends" />}
            <MenuRow icon={<GearIcon />} label={t("settings.title")} onClick={() => setView("settings")} testId="menu-settings" />
            <MenuRow icon={<PhoneIcon />} label={t("account.devices")} onClick={() => setView("devices")} testId="menu-devices" />
            <MenuRow icon={<LockIcon />} label={t("account.security")} onClick={() => setView("security")} testId="menu-security" />
          </nav>
          <button
            className="btn btn-block"
            onClick={() => {
              void account.signOut();
              onClose();
            }}
            data-testid="sign-out"
          >
            <LogoutIcon /> {t("auth.signOut")}
          </button>
        </div>
      ) : me ? (
        <ProfileGrid profiles={me.profiles} onPick={(picked) => account.choose(picked.id)} />
      ) : (
        <div className="page-stack">
          <section className="account-pitch">
            <Logo />
            <h1>{t("auth.pitch")}</h1>
            <p className="muted">{t("auth.pitchDetail")}</p>
          </section>
          <AuthForm onDone={() => undefined} />
          <nav className="menu">
            <MenuRow icon={<GearIcon />} label={t("settings.title")} onClick={() => setView("settings")} testId="menu-settings" />
          </nav>
          <p className="muted small center">{t("account.guestNote")}</p>
        </div>
      )}
    </Page>
  );
}

/** Netflix's first question, full screen: signed in on a phone that doesn't know who is holding it. */
export function ChooseProfile() {
  const t = useT();
  const account = useAccount();
  const [adding, setAdding] = useState(false);
  if (!account.me) return null;
  return (
    <main className="phone choose" data-testid="choose-profile">
      <div className="brand">
        <Logo />
      </div>
      <h1>{t("profiles.title")}</h1>
      {adding ? (
        <ProfileEditor
          taken={account.me.profiles.map((other) => other.avatar)}
          onSave={async (name, avatar) => {
            const added = await account.addProfile(name, avatar);
            if (added) account.choose(added.id);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <ProfileGrid profiles={account.me.profiles} onPick={(picked) => account.choose(picked.id)} onAdd={() => setAdding(true)} />
      )}
      <button className="auth-switch" onClick={() => void account.signOut()} data-testid="choose-signout">
        {t("auth.signOut")}
      </button>
    </main>
  );
}

/** The corner button of the phone's pages: the picture of the profile in use, or a way in for someone not signed in. */
export function AccountButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  const { status, profile, me } = useAccount();
  const { unread } = useFriends();
  if (status !== "ready") return null;
  if (me && profile) {
    return (
      <button className="avatar-button" onClick={onClick} aria-label={`${t("account.open")}: ${profile.name}${unread > 0 ? ` · ${t("friends.unread", { count: unread })}` : ""}`} data-testid="account-button">
        <Avatar id={profile.avatar} />
        {unread > 0 && <i className="unread-dot" aria-hidden="true" data-testid="unread-dot" />}
      </button>
    );
  }
  return (
    <button className="signin-pill" onClick={onClick} data-testid="account-button">
      <UserIcon /> {t("account.signInPrompt")}
    </button>
  );
}
