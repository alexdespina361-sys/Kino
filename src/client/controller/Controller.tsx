import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  IDLE_STATE,
  MAX_LINK_LENGTH,
  ratingsShown,
  describeChange,
  previousEpisode,
  seriesKeyOf,
  stateIsFor,
  type Command,
  type NormalizedMedia,
  type PartyTv,
  type PhoneTv,
  type PlayHint,
  type PlayerState,
  type ResolveStatus,
  type TvInfo,
} from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { describeError } from "../account/errors";
import type { ListEntry } from "../account/profileStore";
import { profileStore, useProfileData } from "../account/store";
import { GetTheAppStrip } from "../app/GetTheApp";
import { PhoneChat } from "../chat/PhoneChat";
import { nameOf } from "../friends/entries";
import { useFriends } from "../friends/FriendsProvider";
import { useT } from "../i18n";
import { Rich } from "../i18n/Rich";
import { useBackWhile } from "../shared/backButton";
import { CONTROLLER_KEY } from "../role";
import { readKept, writeKept } from "../shared/kept";
import { FullscreenToggle } from "../shared/FullscreenToggle";
import { ChevronLeftIcon } from "../shared/icons";
import { partyLink, readLaunchParams } from "../shared/launch";
import { useLinkBox } from "../shared/linkBox";
import { forgetStrayAddress, strayAddress } from "../shared/strayAddress";
import { connectSocket, type Socket, type SocketStatus } from "../shared/socket";
import { noticeText, resolveFailure, socketError } from "../shared/words";
import { AccountButton, AccountScreen, ChooseProfile, SetUpProfile, Page } from "./AccountScreen";
import { BellButton, NotificationsSheet } from "./Bell";
import { LinkApprove } from "../account/LinkApprove";
import type { Entry } from "../tv/pages";
import { FriendInvite, FriendsHome } from "./Friends";
import { Library } from "./Library";
import { ListPickerSheet, ListsSheet } from "./ListSheets";
import { PairScreen } from "./PairScreen";
import { PlayLink, ResolveLine } from "./PlayLink";
import { Remote, type SheetKind } from "./Remote";
import { LINE_EVENT } from "./Round";
import { RatingsSheet } from "./RatingsSheet";
import { useChildCards } from "../shared/childGate";
import { ContinueRow } from "./Rows";
import { MiniRemote } from "./shell/MiniRemote";
import { MyLists } from "./shell/MyLists";
import { RowPage } from "./shell/RowPage";
import { TabBar } from "./shell/TabBar";
import { TvChip } from "./shell/TvChip";
import { useTabs } from "./shell/useTabs";
import { TitleSheet } from "./TitleSheet";
import {
  CaptionStyleSheet,
  EpisodesSheet,
  MenuSheet,
  OtherTvSheet,
  PartySheet,
  QualitySheet,
  SourcesSheet,
  SpeedSheet,
  TracksSheet,
  TvsSheet,
  type PartyInvite,
} from "./Sheets";
import "./controller.css";
import "../polish/phone.css";
import "../polish/shell.css";

const RESOLVE_TIMEOUT_MS = 40_000;

export function Controller() {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const socketRef = useRef<Socket | null>(null);
  const [connection, setConnection] = useState<SocketStatus>("connecting");
  const [tv, setTv] = useState<TvInfo | null>(null);
  const [tvs, setTvs] = useState<PhoneTv[]>([]);
  const [media, setMedia] = useState<NormalizedMedia | null>(null);
  const [player, setPlayer] = useState<PlayerState>(IDLE_STATE);
  const [error, setError] = useState<string | null>(null);
  const [resolve, setResolve] = useState<Exclude<ResolveStatus, { phase: "cancelled" }> | null>(null);
  const [failedLookups, setFailedLookups] = useState(0);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [pairing, setPairing] = useState(false);
  const [party, setParty] = useState<PartyTv[]>([]);
  const [invite, setInvite] = useState<PartyInvite>(null);
  const [other, setOther] = useState<{ code: string; control: boolean } | null>(null);
  const [listSheet, setListSheet] = useState<{ kind: "manage" } | { kind: "pick"; entry: ListEntry } | null>(null);
  const [title, setTitle] = useState<Entry | null>(null);
  const [linkBox] = useLinkBox();
  const { watched, lists, settings } = useProfileData();
  const ratingsOn = ratingsShown(settings);
  const { child, progress, list, ratings } = useChildCards();
  const childRef = useRef(child);
  childRef.current = child;
  const [ratingsOpen, setRatingsOpen] = useState(false);
  const [seeAll, setSeeAll] = useState<string | null>(null);
  useEffect(() => {
    if (!child) return;
    setTitle(null);
    setSeeAll(null);
    setRatingsOpen(false);
    setSheet((open) => (open === "party" ? null : open));
  }, [child]);

  const launchRef = useRef(readLaunchParams(location.search));
  const [code, setCode] = useState(launchRef.current.code ?? "");
  const sentCodeRef = useRef("");
  const hadTvRef = useRef(false);
  const addingRef = useRef(false);
  const [lost, setLost] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [accountAt, setAccountAt] = useState<"main" | "friends">("main");
  const [showBell, setShowBell] = useState(false);
  const [chatWith, setChatWith] = useState<string | null>(null);
  const closeAccount = () => {
    setShowAccount(false);
    setAccountAt("main");
  };
  const settingUp = Boolean(account.profile?.setup);
  useEffect(() => {
    if (settingUp) closeAccount();
  }, [settingUp]); // eslint-disable-line react-hooks/exhaustive-deps
  const [approveCode, setApproveCode] = useState<string | null>(launchRef.current.link ?? null);
  const [friendCode, setFriendCode] = useState<string | null>(launchRef.current.friend ?? null);
  useLayoutEffect(() => {
    if (launchRef.current.link || launchRef.current.friend) window.history.replaceState(window.history.state, "", location.pathname);
  }, []);

  const onFound = (found: NormalizedMedia) => {
    setMedia(found);
    profileStore.playbackStarted(found);
  };

  useEffect(() => {
    const socket = connectSocket({
      hello: () => ({ type: "CTL_HELLO", controllerId: readKept(CONTROLLER_KEY) }),
      onStatus: (status) => {
        setConnection(status);
        if (status !== "open") setPairing(false);
      },
      onMessage: (message) => {
        switch (message.type) {
          case "CTL_WELCOME": {
            writeKept(CONTROLLER_KEY, message.controllerId);
            setTv(message.tv);
            setTvs(message.tvs ?? []);
            setMedia(message.media);
            setPlayer(message.state);
            setParty(message.party ?? []);
            setInvite(null);
            setError(null);
            setPairing(false);
            if (addingRef.current) {
              addingRef.current = false;
              setSheet((open) => (open === "tvs" ? null : open));
            }
            if (message.tv) {
              hadTvRef.current = true;
              setLost(false);
            } else if (hadTvRef.current) {
              hadTvRef.current = false;
              setLost(true);
              setCode("");
            }
            if (!message.tv) {
              setSheet(null);
              setListSheet(null);
              setRatingsOpen(false);
              setSeeAll(null);
              setTitle(null);
              setResolve(null);
              setOther(null);
            }

            const launch = launchRef.current;
            if (launch.code || launch.control || launch.url) window.history.replaceState(window.history.state, "", location.pathname);
            const scanned = launch.code ?? launch.control;
            if (scanned && message.tv && !message.tv.online && message.tv.controlCode !== scanned) {
              launchRef.current = { ...launch, code: undefined, control: undefined };
              sentCodeRef.current = scanned;
              socketRef.current?.send({ type: "PAIR", code: scanned });
              setPairing(true);
              break;
            }
            if (scanned) {
              launchRef.current = { ...launch, code: undefined, control: undefined };
              if (!message.tv) {
                sentCodeRef.current = scanned;
                socketRef.current?.send({ type: "PAIR", code: scanned });
                setPairing(true);
              } else if (message.tv.controlCode !== scanned) {
                setOther({ code: scanned, control: launch.code === undefined });
              }
            } else if (launch.url && message.tv) {
              launchRef.current = { ...launch, url: undefined, startAt: undefined };
              if (childRef.current) setError(t("notice.childNoLinks"));
              else playLink(launch.url, launch.startAt);
            }
            break;
          }
          case "STATE":
            setPlayer(message.state);
            break;
          case "RESOLVE_STATUS":
            setResolve(message.status.phase === "cancelled" ? null : message.status);
            if (message.status.phase === "failed") setFailedLookups((n) => n + 1);
            if (message.status.phase === "found") {
              onFound(message.status.media);
              setSheet((open) => (open === "episodes" ? null : open));
            }
            break;
          case "PARTY":
            setParty(message.tvs);
            setInvite(message.code ? { code: message.code.code, endsAt: Date.now() + message.code.expiresInMs } : null);
            break;
          case "TV_STATUS":
            setTv((current) => (current ? { ...current, online: message.online } : current));
            break;
          case "TVS": {
            const now = message.tvs.find((row) => row.current);
            setTvs(message.tvs);
            setTv((current) => (current && now ? { ...current, name: now.name, online: now.online } : current));
            break;
          }
          case "MEDIA":
            setMedia(message.media);
            break;
          case "ERROR":
            if (message.code === "PARTY_CODE" && sentCodeRef.current) {
              if (!childRef.current) {
                location.assign(partyLink(sentCodeRef.current));
                break;
              }
              setError(t("notice.childNoParty"));
              setCode("");
              setPairing(false);
              break;
            }
            setError(socketError(message.code, message.message));
            if (message.code === "INVALID_CODE") setCode("");
            setPairing(false);
            addingRef.current = false;
            setInvite((current) => (current === "asking" ? null : current));
            break;
        }
      },
    });
    socketRef.current = socket;
    return () => socket.disconnect();
  }, []);

  const playLink = (link: string, startAt?: number, hint?: PlayHint) => {
    setError(null);
    setResolve(null);
    if (link.length > MAX_LINK_LENGTH) return setError(t("phone.linkTooLong"));
    setRemoteShown(true);
    socketRef.current?.send({ type: "PLAY_URL", url: link, ...(startAt ? { startAt } : {}), ...(hint ? { hint } : {}) });
  };

  const openParty = () => {
    setInvite("asking");
    socketRef.current?.send({ type: "OPEN_PARTY" });
  };

  const [together, setTogether] = useState<string | null>(null);
  const startTogether = (friend: string) => {
    setTogether(friend);
    openParty();
  };
  useEffect(() => {
    if (!together || !invite || invite === "asking") return;
    setTogether(null);
    const name = nameOf(friends.state?.friends ?? [], together);
    void friends.send([together], { kind: "party", code: invite.code, endsAt: invite.endsAt }).then(
      async (answer) => {
        account.say(answer.sent.length > 0 ? t("friends.inviteSent", { names: name }) : t("friends.declined", { names: name }));
        await friends.refresh();
      },
      (error: unknown) => account.say(describeError(error)),
    );
    closeAccount();
    setSheet("party");
  }, [together, invite]);

  const openMenu = () => {
    socketRef.current?.send({ type: "CTL_HELLO", controllerId: readKept(CONTROLLER_KEY) });
    setSheet("menu");
  };

  const send = (command: Command) => {
    setError(null);
    try {
      navigator.vibrate?.(8);
    } catch {
    }
    socketRef.current?.send({ type: "CMD", command });
  };

  const stop = () => {
    if (media && player.duration > 0 && stateIsFor(media, player)) profileStore.playbackAt(media, player);
    setResolve(null);
    send({ type: "STOP" });
  };

  useEffect(() => {
    if (!media || (player.state !== "playing" && player.state !== "paused") || player.buffering || player.duration <= 0 || !stateIsFor(media, player)) return;
    profileStore.playbackAt(media, player);
  }, [player, media]);

  const [toast, setToast] = useState<{ id: number; text: string; long?: true } | null>(null);
  const lastPlayerRef = useRef<PlayerState>(IDLE_STATE);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  useEffect(() => {
    const change = describeChange(lastPlayerRef.current, player, noticeText);
    lastPlayerRef.current = player;
    if (change && !sheetRef.current) setToast((current) => ({ id: (current?.id ?? 0) + 1, text: change }));
  }, [player]);
  useEffect(() => {
    if (sheet) setToast(null);
  }, [sheet]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.long ? 4500 : 2000);
    return () => clearTimeout(timer);
  }, [toast]);
  const [stray, setStray] = useState(strayAddress);
  useEffect(() => {
    if (!stray) return;
    forgetStrayAddress();
    setToast((current) => ({ id: (current?.id ?? 0) + 1, text: t("notice.noSuchPageShort"), long: true }));
    const timer = setTimeout(() => setStray(false), 8000);
    return () => clearTimeout(timer);
  }, [stray]);
  useEffect(() => {
    const say = (event: Event) => setToast((current) => ({ id: (current?.id ?? 0) + 1, text: String((event as CustomEvent<string>).detail) }));
    window.addEventListener(LINE_EVENT, say);
    return () => window.removeEventListener(LINE_EVENT, say);
  }, []);
  useEffect(() => {
    if (resolve?.phase === "failed") setToast((current) => ({ id: (current?.id ?? 0) + 1, text: resolveFailure(resolve), long: true }));
    else if (resolve?.phase === "resolving") setToast((current) => (current?.long ? null : current));
  }, [resolve]);

  useEffect(() => {
    if (resolve?.phase !== "resolving") return;
    const timer = setTimeout(
      () =>
        setResolve({ phase: "failed", reason: "temporary_failure", message: "This is taking too long. Try again in a moment." }),
      RESOLVE_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [resolve]);

  useEffect(() => {
    if (player.state === "idle" || player.state === "playing" || player.state === "paused") setResolve((status) => (status?.phase === "found" ? null : status));
  }, [player.state]);

  const active = player.state !== "idle" && media !== null;
  const [remoteShown, setRemoteShown] = useState(true);
  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current) setRemoteShown(true);
    wasActive.current = active;
  }, [active]);
  const away = connection === "open" && tv !== null && !tv.online;
  const remoteOpen = active && remoteShown && !away;
  useBackWhile(remoteOpen, () => setRemoteShown(false));
  const covered = seeAll !== null || title !== null || sheet !== null || listSheet !== null || other !== null || ratingsOpen || showAccount || showBell || chatWith !== null || approveCode !== null || friendCode !== null;
  const tabs = useTabs(remoteOpen || covered, tv !== null);
  useEffect(() => {
    if (!active) setSheet((open) => (open && open !== "menu" && open !== "party" && open !== "tvs" ? null : open));
  }, [active]);

  const closeApprove = () => setApproveCode(null);
  const tellTvToLookAgain = () => {
    if (tv?.online) socketRef.current?.send({ type: "CMD", command: { type: "REFRESH_ACCOUNT" } });
  };
  const bellButton = <BellButton onClick={() => setShowBell(true)} />;
  const pickList = (entry: ListEntry) => setListSheet({ kind: "pick", entry });
  const titleSheets = (
    <>
      {title && (
        <TitleSheet
          entry={title}
          {...(tv
            ? {
                onPlay: (url: string, startAt: number | undefined, hint: PlayHint) => {
                  setTitle(null);
                  playLink(url, startAt, hint);
                },
              }
            : {})}
          onPick={pickList}
          onOpenTitle={setTitle}
          onClose={() => setTitle(null)}
        />
      )}
      {listSheet?.kind === "manage" && <ListsSheet onClose={() => setListSheet(null)} />}
      {listSheet?.kind === "pick" && <ListPickerSheet entry={listSheet.entry} onClose={() => setListSheet(null)} />}
    </>
  );
  const accountLayer = (
    <>
      {approveCode ? (
        <Page title={t("account.signInTv")} onBack={closeApprove} testId="approve-page">
          <LinkApprove code={approveCode} onClose={closeApprove} />
        </Page>
      ) : (
        showAccount && (
          <AccountScreen
            key={accountAt}
            initial={accountAt}
            onClose={closeAccount}
            onSessionsChanged={tellTvToLookAgain}
            onOpenTitle={setTitle}
            onTvs={() => setSheet("tvs")}
            tvCount={tvs.length}
            {...(tv ? { onStartParty: startTogether } : {})}
          />
        )
      )}
      {showBell && !showAccount && !approveCode && (
        <NotificationsSheet
          onClose={() => setShowBell(false)}
          onOpenTitle={setTitle}
          {...(tv ? { onStartParty: startTogether } : {})}
          onOpenFriends={() => {
            setAccountAt("friends");
            setShowAccount(true);
          }}
          onOpenChat={setChatWith}
        />
      )}
      {chatWith && !showAccount && !approveCode && <PhoneChat key={chatWith} friendId={chatWith} onClose={() => setChatWith(null)} onOpenTitle={setTitle} />}
      {friendCode && !showAccount && !approveCode && !account.choosing && (
        <FriendInvite
          code={friendCode}
          onClose={() => setFriendCode(null)}
          onSignIn={() => setShowAccount(true)}
        />
      )}
      {account.message && (
        <p className="account-toast" key={account.message.id} role="status" data-testid="account-toast">
          {account.message.text}
        </p>
      )}
    </>
  );

  const tvsSheet = sheet === "tvs" && (
    <TvsSheet
      tvs={tvs}
      error={error}
      onSwitch={(id) => {
        setSheet(null);
        socketRef.current?.send({ type: "SWITCH_TV", id });
      }}
      onForget={(id) => {
        if (tvs.some((row) => row.id === id && row.current)) hadTvRef.current = false;
        socketRef.current?.send({ type: "UNPAIR", id });
      }}
      onName={(name) => socketRef.current?.send({ type: "NAME_TV", name })}
      onAdd={(value) => {
        setError(null);
        addingRef.current = true;
        sentCodeRef.current = value;
        setPairing(true);
        socketRef.current?.send({ type: "PAIR", code: value });
      }}
      onClose={() => {
        setError(null);
        setSheet(null);
      }}
    />
  );

  if (account.choosing && !approveCode) {
    return (
      <>
        <ChooseProfile />
        <div className="phone-ui layers">{accountLayer}</div>
      </>
    );
  }
  if (settingUp && !approveCode) return <SetUpProfile />;

  if (!tv) {
    return (
      <>
        <PairScreen
          code={code}
          onCodeChange={setCode}
          onSubmit={(value) => {
            setError(null);
            setPairing(true);
            sentCodeRef.current = value;
            socketRef.current?.send({ type: "PAIR", code: value });
          }}
          connection={connection}
          pending={pairing}
          error={error}
          notice={lost ? t("phone.tvGone") : stray ? t("notice.noSuchPageShort") : null}
          tvCount={tvs.length}
          onTvs={() => setSheet("tvs")}
          corner={
            <>
              <FullscreenToggle className="icon-btn" />
              {bellButton}
              <AccountButton onClick={() => setShowAccount(true)} />
            </>
          }
        />
        <div className="phone-ui layers">
          {tvsSheet}
          {accountLayer}
          {titleSheets}
        </div>
      </>
    );
  }

  const online = connection === "open" && tv.online;
  const disconnect = () => {
    hadTvRef.current = false;
    socketRef.current?.send({ type: "UNPAIR" });
    setCode("");
    setSheet(null);
  };
  const closeSheet = () => {
    if (sheet === "party" || sheet === "tvs") setError(null);
    setSheet(null);
  };
  const status = connection !== "open" ? t("phone.reconnecting") : tv.online ? t("phone.tvConnected") : t("phone.tvDisconnected");

  const home = (
    <section className="home" data-testid="home-panel">
      <h2 className="sr-only">{t("phone.homeTitle")}</h2>
      {linkBox && !child && <PlayLink tvName={tv.name} onPlay={(url) => playLink(url)} />}
      <FriendsHome onOpenTitle={setTitle} onStartParty={startTogether} />
      <ContinueRow items={progress} onPlay={playLink} onRemove={(key) => profileStore.removeProgress(key)} onPick={pickList} />
      <Library onOpen={setTitle} onPlay={playLink} onPick={pickList} onSeeAll={setSeeAll} failedLookups={failedLookups} fallback={linkBox || child ? undefined : <PlayLink tvName={tv.name} onPlay={(url) => playLink(url)} />} />
    </section>
  );
  const search = (
    <section className="search-panel" data-testid="search-panel">
      <h2 className="sr-only">{t("tabs.search")}</h2>
      <Library mode="search" onOpen={setTitle} onPick={pickList} failedLookups={failedLookups} />
    </section>
  );
  const myLists = (
    <MyLists
      lists={lists}
      items={list}
      ratings={ratings}
      ratingsOn={ratingsOn}
      onOpen={setTitle}
      onPick={pickList}
      onRemove={(url, id) => profileStore.removeFromList(url, id)}
      onManage={() => setListSheet({ kind: "manage" })}
      onAllRatings={() => setRatingsOpen(true)}
      onBrowse={() => tabs.setTab("home")}
    />
  );
  const you = (
    <AccountScreen inline onClose={() => tabs.setTab("home")} onSessionsChanged={tellTvToLookAgain} onOpenTitle={setTitle} onStartParty={startTogether} onTvs={() => setSheet("tvs")} tvCount={tvs.length} />
  );
  const panel = { home, search, list: myLists, you }[tabs.tab];
  const mini = active && !remoteOpen && !away;

  return (
    <main className={`phone phone-ui shell${remoteOpen ? " is-remote" : ""}${mini ? " has-mini" : ""}`}>
      {seeAll !== null && <RowPage rowId={seeAll} onClose={() => setSeeAll(null)} onOpen={setTitle} onPick={pickList} />}
      {accountLayer}
      <header className="top">
        {remoteOpen && (
          <button type="button" className="icon-btn top-back" aria-label={t("common.back")} data-testid="remote-back" onClick={() => setRemoteShown(false)}>
            <ChevronLeftIcon />
          </button>
        )}
        <TvChip name={tv.name} party={party.length} ok={online} status={status} onClick={openMenu} />
        {!remoteOpen && (
          <div className="top-actions">
            {bellButton}
            <AccountButton onClick={() => tabs.select("you")} />
          </div>
        )}
      </header>

      {!remoteOpen && tabs.tab !== "you" && <GetTheAppStrip />}

      {away && (
        <section className="away" data-testid="tv-away">
          <p className="banner">
            <Rich k="phone.tvOffline" parts={{ host: <b>{location.host}</b> }} />
          </p>
          <button className="btn btn-block" data-testid="connect-another" onClick={() => setSheet("tvs")}>
            {tvs.length > 1 ? t("phone.switchTv") : t("phone.anotherTv")}
          </button>
        </section>
      )}

      <ResolveLine resolve={resolve} tvName={tv.name} />

      {error && sheet !== "party" && sheet !== "tvs" && (
        <p className="error banner" data-testid="error" role="alert">
          {error}
        </p>
      )}

      {remoteOpen && media ? (
        <Remote
          tv={tv}
          online={online}
          media={media}
          player={player}
          send={send}
          onStop={stop}
          onNext={() => send({ type: "NEXT_EPISODE" })}
          onPrevious={() => {
            const previous = previousEpisode(media.series);
            if (previous) playLink(previous.url);
          }}
          onOpen={setSheet}
          onChangeVideo={() => {
            setRemoteShown(false);
            tabs.setTab("home");
          }}
        />
      ) : (
        <div className="tab-panel" key={tabs.tab} ref={tabs.place}>
          {panel}
        </div>
      )}
      {mini && media && <MiniRemote media={media} player={player} tvName={tv.name} online={online} onOpen={() => setRemoteShown(true)} onToggle={() => send({ type: player.state === "playing" ? "PAUSE" : "PLAY" })} />}
      {!remoteOpen && <TabBar tab={tabs.tab} onSelect={tabs.select} />}
      {sheet === "menu" && (
        <MenuSheet
          tvName={tv.name}
          online={online}
          partySize={party.length}
          tvCount={tvs.length}
          controlCode={tv.controlCode}
          controllerCount={tv.controllerCount}
          onParty={child ? null : () => setSheet("party")}
          onTvs={() => setSheet("tvs")}
          onClose={closeSheet}
          onDisconnect={disconnect}
        />
      )}
      {tvsSheet}
      {sheet === "party" && (
        <PartySheet
          tvName={tv.name}
          party={party}
          invite={invite}
          error={error}
          onClose={closeSheet}
          onInvite={openParty}
          onAdd={(code) => {
            setError(null);
            socketRef.current?.send({ type: "ADD_TV", code });
          }}
          onRemove={(id) => socketRef.current?.send({ type: "REMOVE_TV", id })}
          onAdmin={(id, admin) => socketRef.current?.send({ type: "PARTY_ADMIN", id, admin })}
          onEnd={() => socketRef.current?.send({ type: "END_PARTY" })}
        />
      )}
      {other && (
        <OtherTvSheet
          tvName={tv.name}
          canAdd={!other.control && !child}
          onClose={() => setOther(null)}
          onAdd={() => {
            setError(null);
            socketRef.current?.send({ type: "ADD_TV", code: other.code });
            setOther(null);
            setSheet("party");
          }}
          onSwitch={() => {
            setError(null);
            sentCodeRef.current = other.code;
            socketRef.current?.send({ type: "PAIR", code: other.code });
            setPairing(true);
            setOther(null);
          }}
        />
      )}
      {sheet === "tracks" && (
        <TracksSheet
          player={player}
          onClose={closeSheet}
          onSubtitle={(track) => send({ type: "SET_SUBTITLE", track })}
          onAudio={(track) => send({ type: "SET_AUDIO", track })}
          onDelay={(delay) => send({ type: "SET_SUBTITLE_DELAY", delay })}
          onSync={(on) => send({ type: "SET_SUBTITLE_SYNC", on })}
          onSyncMode={(mode) => send({ type: "SET_SUBTITLE_SYNC", on: true, mode })}
          onStyle={() => setSheet("captions")}
        />
      )}
      {sheet === "captions" && (
        <CaptionStyleSheet
          style={player.captionStyle}
          onClose={closeSheet}
          onChange={(changes) => send({ type: "SET_CAPTION_STYLE", style: changes })}
        />
      )}
      {sheet === "speed" && (
        <SpeedSheet player={player} onClose={closeSheet} onPick={(rate) => send({ type: "SET_SPEED", rate })} />
      )}
      {sheet === "quality" && (
        <QualitySheet player={player} onClose={closeSheet} onPick={(level) => send({ type: "SET_QUALITY", level })} onEnhance={(mode) => send({ type: "SET_ENHANCE", mode })} />
      )}
      {sheet === "sources" && (
        <SourcesSheet player={player} onClose={closeSheet} onPick={(index) => send({ type: "SET_SOURCE", index })} />
      )}
      {sheet === "episodes" && media?.series?.episodes && (
        <EpisodesSheet series={media.series} show={seriesKeyOf(media)} watched={watched} onClose={closeSheet} onPlay={playLink} />
      )}
      {ratingsOpen && ratingsOn && <RatingsSheet ratings={ratings} onOpen={setTitle} onClose={() => setRatingsOpen(false)} />}
      {titleSheets}

      {toast && (
        <p className="toast" key={toast.id} data-testid="toast" role="status">
          {toast.text}
        </p>
      )}
    </main>
  );
}
