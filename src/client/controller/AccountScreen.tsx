import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Profile } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { Avatar } from "../account/Avatar";
import { AuthForm } from "../account/AuthForm";
import { ProfileEditor, ProfileGrid } from "../account/Profiles";
import { useProfileData } from "../account/store";
import { useFeedbackEntry } from "../feedback/entry";
import { useFriends } from "../friends/FriendsProvider";
import { useT } from "../i18n";
import { ChevronIcon, GearIcon, LockIcon, LogoutIcon, MessageIcon, PencilIcon, PhoneIcon, ScanIcon, StarIcon, UserIcon, UsersIcon } from "../shared/icons";
import { Logo } from "../shared/Logo";
import type { Entry } from "../tv/pages";
import { DevicesPage, LinkPage, SecurityPage, SettingsPage } from "./AccountPages";
import { LinkApprove } from "../account/LinkApprove";
import { useBackToClose } from "../shared/backButton";
import { FriendPage, FriendsPage } from "./Friends";
import { RatingsSheet } from "./RatingsSheet";
import { keepFocusIn, sheetIsOpen } from "./Sheet";

/** A full-screen page with a way back: the phone's account pages stack like the pages of a settings app. */
export function Page({ title, onBack, children, testId }: { title: string; onBack: () => void; children: ReactNode; testId?: string }) {
  const t = useT();
  const page = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useBackToClose(onBack); // (the phone's own Back goes back a page too, instead of leaving the site)
  // (one page is the next one in the same place: what was scrolled in the one before is not where the next begins)
  useLayoutEffect(() => {
    body.current?.scrollTo(0, 0);
  }, [title]);
  // The keyboard goes into the page when it opens (not left on the button behind it), and Tab goes round it rather than out to the controls under it.
  // (The pages of a view that changes are this one component with other words: each is "opened" as its title changes, the button that opened it gone.)
  useEffect(() => {
    if (page.current && !page.current.contains(document.activeElement)) page.current.focus({ preventScroll: true });
  }, [title, testId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (sheetIsOpen()) return; // (a sheet over the page keeps its own focus)
      if (event.key === "Escape") onBack();
      else if (event.key === "Tab" && page.current) keepFocusIn(page.current, event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);
  return (
    <div className="page" ref={page} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <header className="page-head">
        <button className="icon-btn" onClick={onBack} aria-label={t("common.back")} data-testid="page-back">
          <ChevronIcon className="flip" />
        </button>
        <h2>{title}</h2>
      </header>
      <div className="page-body" ref={body}>
        {children}
      </div>
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
  onStartParty,
}: {
  onClose: () => void;
  initial?: View;
  onSessionsChanged?: () => void;
  /** A title a friend sent, or has in a list, was tapped (not given on a phone that has no TV to play it on). */
  onOpenTitle?: (entry: Entry) => void;
  /** A friend's request to watch together was answered with "Start a party" (not given on a phone that has no TV to host one). */
  onStartParty?: (friendId: string) => void;
}) {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const feedback = useFeedbackEntry();
  const { ratings, settings } = useProfileData();
  const ratingsOn = settings.ratings ?? true;
  /** What this profile rated, over the account's page: it is the profile's, so it is kept here with the friends and the settings. */
  const [ratingsOpen, setRatingsOpen] = useState(false);
  const [view, setView] = useState<View>(initial);
  const [editing, setEditing] = useState<Profile | "new" | null>(null);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  /** The friend whose page is open, and the page the friends were opened from (the settings, or the account's menu). */
  const [friendId, setFriendId] = useState<string | null>(null);
  const [friendsFrom, setFriendsFrom] = useState<View | "close">(initial === "friends" ? "close" : "main"); // (opened on the friends from the bell: Back leaves the account)
  const { me, profile } = account;
  /** The page the settings were opened from (the account's menu, or the friends' page that says what to turn on): Back goes there. */
  const [settingsFrom, setSettingsFrom] = useState<View>("main");
  const back = () => setView("main");
  const openFriends = (from: View) => {
    setFriendsFrom(from);
    setView("friends");
  };
  const openSettings = (from: View) => {
    setSettingsFrom(from);
    setView("settings");
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
      <Page title={t("settings.title")} onBack={() => setView(settingsFrom)}>
        <SettingsPage
          onOpenFriends={() => {
            setSettingsFrom("main"); // (the friends' page leads back here, and from here Back goes to the menu: not round again)
            openFriends("settings");
          }}
        />
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
      <Page title={t("friends.title")} onBack={() => (friendsFrom === "close" ? onClose() : setView(friendsFrom))} testId="friends-screen">
        <FriendsPage
          onOpenFriend={(id) => {
            setFriendId(id);
            setView("friend");
          }}
          onOpenTitle={onOpenTitle}
          onOpenSettings={() => openSettings("friends")}
          {...(onStartParty ? { onStartParty } : {})}
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

  /** What this profile rated is there for a guest too: a guest rates, and keeps it, until it signs in. */
  const ratingsRow = ratingsOn && <MenuRow icon={<StarIcon />} label={t("rating.mine")} detail={ratings.length > 0 ? String(ratings.length) : undefined} onClick={() => setRatingsOpen(true)} testId="menu-ratings" />;
  /** Next to Settings, for a guest too: anybody may say what is wrong (the number is how many answers from the team wait). */
  const feedbackRow = <MenuRow icon={<MessageIcon />} label={t("feedback.entry")} detail={feedback.unread > 0 ? String(feedback.unread) : undefined} onClick={feedback.open} testId="menu-feedback" />;
  return (
    <Page title={t("account.title")} onBack={onClose} testId="account-screen">
      {me && profile ? (
        <div className="page-stack account-hub">
          <section className="account-card" data-testid="account-card">
            <Avatar id={profile.avatar} className="account-avatar" />
            <div className="account-who">
              <h1 data-testid="account-profile-name">{profile.name}</h1>
              <p className="muted">{t("account.signedInAs", { email: me.account.email })}</p>
            </div>
          </section>
          <div className="menu-groups">
            <nav className="menu">
              {me.profiles.length > 1 && <MenuRow icon={<UserIcon />} label={t("profiles.switch")} onClick={() => setView("picker")} testId="menu-switch" />}
              <MenuRow icon={<PencilIcon />} label={t("profiles.manage")} onClick={() => setView("profiles")} testId="menu-profiles" />
            </nav>
            {(friends.on || ratingsOn) && (
              <nav className="menu">
                {friends.on && <MenuRow icon={<UsersIcon />} label={t("friends.title")} detail={friends.attention > 0 ? String(friends.attention) : undefined} onClick={() => openFriends("main")} testId="menu-friends" />}
                {ratingsRow}
              </nav>
            )}
            <nav className="menu">
              <MenuRow icon={<GearIcon />} label={t("settings.title")} onClick={() => openSettings("main")} testId="menu-settings" />
              {feedbackRow}
              <MenuRow icon={<ScanIcon />} label={t("account.signInTv")} onClick={() => setView("link")} testId="menu-link" />
              <MenuRow icon={<PhoneIcon />} label={t("account.devices")} onClick={() => setView("devices")} testId="menu-devices" />
              <MenuRow icon={<LockIcon />} label={t("account.security")} onClick={() => setView("security")} testId="menu-security" />
            </nav>
          </div>
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
        <div className="page-stack account-guest">
          <section className="account-pitch">
            <Logo />
            <h1>{t("auth.pitch")}</h1>
            <p className="muted">{t("auth.pitchDetail")}</p>
          </section>
          <AuthForm onDone={() => undefined} />
          <nav className="menu">
            {ratingsRow}
            <MenuRow icon={<GearIcon />} label={t("settings.title")} onClick={() => openSettings("main")} testId="menu-settings" />
            {feedbackRow}
          </nav>
          <p className="muted small center">{t("account.guestNote")}</p>
        </div>
      )}
      {ratingsOpen && ratingsOn && <RatingsSheet ratings={ratings} onOpen={(entry) => onOpenTitle?.(entry)} onClose={() => setRatingsOpen(false)} />}
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
    <main className="phone choose phone-ui" data-testid="choose-profile">
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

/** The corner button of the phone's pages: the picture of the profile in use, or a way in for someone not signed in. (What waits for the profile is on the bell beside it.) */
export function AccountButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  const { status, profile, me } = useAccount();
  if (status !== "ready") return null;
  if (me && profile) {
    return (
      <button className="avatar-button" onClick={onClick} aria-label={`${t("account.open")}: ${profile.name}`} data-testid="account-button">
        <Avatar id={profile.avatar} />
      </button>
    );
  }
  return (
    <button className="signin-pill" onClick={onClick} data-testid="account-button">
      <UserIcon /> {t("account.signInPrompt")}
    </button>
  );
}
