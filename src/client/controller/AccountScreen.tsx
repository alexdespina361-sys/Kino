import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ratingsShown, tagLabel, type Profile } from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { Avatar } from "../account/Avatar";
import { AuthForm } from "../account/AuthForm";
import { GetTheApp, useAppRelease } from "../app/GetTheApp";
import { signedInLine } from "../account/google";
import { GoogleMark, useCanConnectGoogle } from "../account/GoogleButton";
import { ProfileEditor, ProfileGrid } from "../account/Profiles";
import { ProfileSetup } from "../account/ProfileSetup";
import { useProfileData } from "../account/store";
import { useFeedbackEntry } from "../feedback/entry";
import { useFriends } from "../friends/FriendsProvider";
import { useT } from "../i18n";
import { ChevronIcon, GearIcon, LockIcon, LogoutIcon, MessageIcon, PencilIcon, PhoneIcon, SparkleIcon, StarIcon, TvIcon, UserIcon, UsersIcon } from "../shared/icons";
import { LATEST, useNews } from "../changelog/news";
import { NewsList } from "../changelog/NewsList";
import { Logo } from "../shared/Logo";
import type { Entry } from "../tv/pages";
import { DevicesPage, LabsPage, LinkPage, SecurityPage, SettingsPage } from "./AccountPages";
import { PinAsk } from "./Pin";
import { pinAsker } from "../account/pinAsker";
import { LinkApprove } from "../account/LinkApprove";
import { useBackToClose } from "../shared/backButton";
import { useChildCards } from "../shared/childGate";
import { FriendPage, FriendsPage, YourTag } from "./Friends";
import { RatingsSheet } from "./RatingsSheet";
import { keepFocusIn, sheetIsOpen } from "./Sheet";

const pagesOpen: object[] = [];

export function Page({ title, onBack, children, testId, backTestId, bare = false }: { title: string; onBack: () => void; children: ReactNode; testId?: string; backTestId?: string; bare?: boolean }) {
  const t = useT();
  const page = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const me = useRef({}).current;
  const back = useRef(onBack);
  back.current = onBack;
  useBackToClose(onBack);
  useEffect(() => {
    pagesOpen.push(me);
    return () => void pagesOpen.splice(pagesOpen.indexOf(me), 1);
  }, [me]);
  useLayoutEffect(() => {
    body.current?.scrollTo(0, 0);
  }, [title]);
  useEffect(() => {
    if (page.current && !page.current.contains(document.activeElement)) page.current.focus({ preventScroll: true });
  }, [title, testId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (sheetIsOpen()) return;
      if (pagesOpen[pagesOpen.length - 1] !== me) return;
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        back.current();
      } else if (event.key === "Tab" && page.current) keepFocusIn(page.current, event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [me]);
  const backButton = (
    <button className={`icon-btn${bare ? " page-float-back" : ""}`} onClick={onBack} aria-label={t("common.back")} data-testid={backTestId ?? "page-back"}>
      <ChevronIcon className="flip" />
    </button>
  );
  return (
    <div className={`page${bare ? " is-bare" : ""}`} ref={page} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      {bare ? (
        backButton
      ) : (
        <header className="page-head">
          {backButton}
          <h2>{title}</h2>
        </header>
      )}
      <div className="page-body" ref={body}>
        {children}
      </div>
    </div>
  );
}

type View = "main" | "picker" | "profiles" | "edit" | "settings" | "devices" | "security" | "approve" | "friends" | "friend" | "news" | "labs";

function NewsPage({ onSeen }: { onSeen: () => void }) {
  useEffect(onSeen, [onSeen]);
  return <NewsList className="page-news" />;
}

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

export function AccountScreen({
  onClose,
  initial = "main",
  inline = false,
  onSessionsChanged,
  onOpenTitle,
  onStartParty,
  onTvs,
  tvCount = 0,
}: {
  onClose: () => void;
  initial?: View;
  inline?: boolean;
  onSessionsChanged?: () => void;
  onTvs?: () => void;
  tvCount?: number;
  onOpenTitle?: (entry: Entry) => void;
  onStartParty?: (friendId: string) => void;
}) {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const feedback = useFeedbackEntry();
  const news = useNews();
  const release = useAppRelease();
  const canConnectGoogle = useCanConnectGoogle();
  const { settings } = useProfileData();
  const { ratings } = useChildCards();
  const ratingsOn = ratingsShown(settings);
  const [ratingsOpen, setRatingsOpen] = useState(false);
  const [view, setView] = useState<View>(initial);
  const [editing, setEditing] = useState<Profile | "new" | null>(null);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [friendId, setFriendId] = useState<string | null>(null);
  const [friendsFrom, setFriendsFrom] = useState<View | "close">(initial === "friends" ? "close" : "main");
  const { me, profile } = account;
  const [settingsFrom, setSettingsFrom] = useState<View>("main");
  const [deleteFirst, setDeleteFirst] = useState(false);
  const back = () => setView("main");
  const { asking, cancel, relock } = account.childLock;
  const self = useRef({}).current;
  const grownUp = (action: () => void) => {
    pinAsker.set(self);
    account.childLock.grownUp(action);
  };
  const guarded = (next: View) => () => grownUp(() => setView(next));
  useEffect(
    () => () => {
      cancel();
      relock();
    },
    [cancel, relock],
  );
  const openFriends = (from: View) => {
    setFriendsFrom(from);
    setView("friends");
  };
  const openSettings = (from: View) => {
    setSettingsFrom(from);
    setView("settings");
  };

  useEffect(() => {
    if (me && view === "main" && account.choosing) setView("picker");
  }, [me, view, account.choosing]);

  if (asking && pinAsker.is(self)) {
    return (
      <Page title={t("pin.title")} onBack={cancel} testId="pin-page">
        <PinAsk />
      </Page>
    );
  }
  if (view === "approve" && linkCode) {
    return (
      <Page title={t("account.signInTv")} onBack={() => setView("devices")} testId="approve-page">
        <LinkApprove code={linkCode} onClose={() => setView("devices")} />
      </Page>
    );
  }
  if (view === "settings") {
    return (
      <Page title={t("settings.title")} onBack={() => setView(settingsFrom)}>
        <SettingsPage
          grownUp={grownUp}
          onOpenFriends={() => {
            setSettingsFrom("main");
            openFriends("settings");
          }}
          onOpenLabs={() => setView("labs")}
          onDeleteAccount={() =>
            grownUp(() => {
              setDeleteFirst(true);
              setView("security");
            })
          }
        />
      </Page>
    );
  }
  if (view === "labs") {
    return (
      <Page title={t("settings.labs")} onBack={() => setView("settings")} testId="labs-screen">
        <LabsPage />
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
        <div className="page-stack">
          {onTvs && tvCount > 0 && (
            <nav className="menu">
              <MenuRow icon={<TvIcon />} label={tvCount > 1 ? t("menu.tvsCount", { count: tvCount }) : t("menu.tvs")} onClick={onTvs} testId="devices-tvs" />
            </nav>
          )}
          <section aria-label={t("account.signInTv")}>
            <h3 className="sheet-section">{t("account.signInTv")}</h3>
            <LinkPage
              onCode={(code) => {
                setLinkCode(code);
                setView("approve");
              }}
            />
          </section>
          <DevicesPage onChanged={onSessionsChanged} />
        </div>
      </Page>
    );
  }
  if (view === "news") {
    return (
      <Page title={t("news.title")} onBack={back} testId="news-page">
        <NewsPage onSeen={news.seen} />
      </Page>
    );
  }
  if (view === "security") {
    return (
      <Page
        title={t("account.security")}
        onBack={() => {
          setDeleteFirst(false);
          setView(deleteFirst ? "settings" : "main");
        }}
      >
        <SecurityPage onDeleted={onClose} startDeleting={deleteFirst} />
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
            const go = () => {
              account.choose(picked.id);
              onClose();
            };
            if (picked.id === profile?.id) go();
            else grownUp(go);
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

  const ratingsRow = ratingsOn && <MenuRow icon={<StarIcon />} label={t("rating.mine")} detail={ratings.length > 0 ? String(ratings.length) : undefined} onClick={() => setRatingsOpen(true)} testId="menu-ratings" />;
  const feedbackRow = <MenuRow icon={<MessageIcon />} label={t("feedback.entry")} detail={feedback.unread > 0 ? String(feedback.unread) : undefined} onClick={feedback.open} testId="menu-feedback" />;
  const newsRow = <MenuRow icon={<SparkleIcon />} label={t("news.title")} detail={news.fresh ? t("news.tileFresh", { version: LATEST.version }) : t("news.version", { version: LATEST.version })} onClick={() => setView("news")} testId="menu-news" />;
  const front = (
    <>
      {me && profile ? (
        <div className="page-stack account-hub">
          <section className="account-card" data-testid="account-card">
            <Avatar id={profile.avatar} className="account-avatar" />
            <div className="account-who">
              <h1 data-testid="account-profile-name">{profile.name}</h1>
              <p className="muted">{signedInLine(me)}</p>
            </div>
          </section>
          {friends.on && profile.tag !== undefined && <YourTag label={tagLabel(profile.name, profile.tag)} testId="account-tag" help={false} />}
          {release && <GetTheApp release={release} />}
          <div className="menu-groups">
            <nav className="menu">
              {me.profiles.length > 1 && <MenuRow icon={<UserIcon />} label={t("profiles.switch")} onClick={guarded("picker")} testId="menu-switch" />}
              <MenuRow icon={<PencilIcon />} label={t("profiles.manage")} onClick={guarded("profiles")} testId="menu-profiles" />
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
              {newsRow}
              <MenuRow icon={<PhoneIcon />} label={t("account.devices")} onClick={guarded("devices")} testId="menu-devices" />
              {canConnectGoogle && <MenuRow icon={<GoogleMark />} label={t("account.googleConnect")} onClick={() => grownUp(() => account.withGoogle("link"))} testId="menu-google" />}
              <MenuRow icon={<LockIcon />} label={t("account.security")} onClick={guarded("security")} testId="menu-security" />
            </nav>
          </div>
          <button
            className="btn btn-block"
            onClick={() =>
              grownUp(() => {
                void account.signOut();
                onClose();
              })
            }
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
            {newsRow}
          </nav>
          {release && <GetTheApp release={release} />}
          <p className="muted small center">{t("account.guestNote")}</p>
        </div>
      )}
      {ratingsOpen && ratingsOn && <RatingsSheet ratings={ratings} onOpen={(entry) => onOpenTitle?.(entry)} onClose={() => setRatingsOpen(false)} />}
    </>
  );
  if (inline) {
    return (
      <section data-testid="account-screen" aria-label={t("account.title")}>
        <h2 className="sr-only">{t("account.title")}</h2>
        {front}
      </section>
    );
  }
  return (
    <Page title={t("account.title")} onBack={onClose} testId="account-screen">
      {front}
    </Page>
  );
}

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

export function SetUpProfile() {
  const account = useAccount();
  const profile = account.profile;
  if (!account.me || !profile?.setup) return null;
  return (
    <ProfileSetup
      profile={profile}
      frame={(step, children) => (
        <main key={step} className="phone choose phone-ui setup-page" data-testid="setup-profile">
          <div className="brand">
            <Logo />
          </div>
          {children}
        </main>
      )}
    />
  );
}

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
