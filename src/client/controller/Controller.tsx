import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  IDLE_STATE,
  MAX_LINK_LENGTH,
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
import { PhoneChat } from "../chat/PhoneChat";
import { nameOf } from "../friends/entries";
import { useFriends } from "../friends/FriendsProvider";
import { useT } from "../i18n";
import { Rich } from "../i18n/Rich";
import { useBackWhile } from "../shared/backButton";
import { readKept, writeKept } from "../shared/kept";
import { FullscreenToggle } from "../shared/FullscreenToggle";
import { ChevronLeftIcon } from "../shared/icons";
import { partyLink, readLaunchParams } from "../shared/launch";
import { useLinkBox } from "../shared/linkBox";
import { connectSocket, type Socket, type SocketStatus } from "../shared/socket";
import { useWaking } from "../shared/useSlow";
import { noticeText, resolveFailure, socketError } from "../shared/words";
import { AccountButton, AccountScreen, ChooseProfile, Page } from "./AccountScreen";
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
import { ContinueRow } from "./Rows";
import { MiniRemote } from "./shell/MiniRemote";
import { MyLists } from "./shell/MyLists";
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

const CONTROLLER_KEY = "controller.id";
/** A lookup that has not answered by now is reported as failed instead of spinning forever. */
const RESOLVE_TIMEOUT_MS = 40_000;

export function Controller() {
  const t = useT();
  const account = useAccount();
  const friends = useFriends();
  const socketRef = useRef<Socket | null>(null);
  const [connection, setConnection] = useState<SocketStatus>("connecting");
  /** The server has not answered for a while: the header's "Reconnecting…" gets a line that says why that can be. */
  const waking = useWaking(connection);
  const [tv, setTv] = useState<TvInfo | null>(null);
  /** Every TV this phone has connected to and not let go of, the one it controls among them (see `TvsSheet`). */
  const [tvs, setTvs] = useState<PhoneTv[]>([]);
  const [media, setMedia] = useState<NormalizedMedia | null>(null);
  const [player, setPlayer] = useState<PlayerState>(IDLE_STATE);
  const [error, setError] = useState<string | null>(null);
  /** What the lookup of a link is up to (a status of "cancelled" clears it instead of being kept). */
  const [resolve, setResolve] = useState<Exclude<ResolveStatus, { phase: "cancelled" }> | null>(null);
  /** How many lookups have failed so far: the library asks the server for its lists again at each, which may have taken the title off them. */
  const [failedLookups, setFailedLookups] = useState(0);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [pairing, setPairing] = useState(false);
  /** The other TVs that watch along with this phone's TV, and the code that brings another one in. */
  const [party, setParty] = useState<PartyTv[]>([]);
  const [invite, setInvite] = useState<PartyInvite>(null);
  /** The code of another TV that this phone scanned while it had one: waiting to be told what the new TV is for. `control`: that TV has a phone, so joining its party is not an option. */
  const [other, setOther] = useState<{ code: string; control: boolean } | null>(null);
  /** The sheets of the lists: the lists themselves, or the lists one title can go in. They open over whatever sheet is open. */
  const [listSheet, setListSheet] = useState<{ kind: "manage" } | { kind: "pick"; entry: ListEntry } | null>(null);
  /** The page of a title that was tapped in the library or a list: where it is played, or put in a list. */
  const [title, setTitle] = useState<Entry | null>(null);
  /** Whether the home screen has the box for pasting a link (also turned on and off in the settings: see linkBox.ts). */
  const [linkBox, changeLinkBox] = useLinkBox();
  // What the profile in use has watched and saved: "Continue watching", its lists, and the marks on the episode list.
  const { progress, watched, lists, list, ratings, settings } = useProfileData();
  const ratingsOn = settings.ratings ?? true;
  /** The page that lists everything this profile rated. */
  const [ratingsOpen, setRatingsOpen] = useState(false);

  // What this page was opened for: a code from the TV's QR code, or a link shared from another app.
  const launchRef = useRef(readLaunchParams(location.search));
  const [code, setCode] = useState(launchRef.current.code ?? "");
  /** The code that was last sent to connect with: when the server says it belongs to a watch party instead, this is the party to go to. */
  const sentCodeRef = useRef("");
  /** This phone had a TV, and the first screen is showing again without the phone having asked for it. */
  const hadTvRef = useRef(false);
  /** The list of TVs sent a code for another one: it stays open until the TV answers, and shows what went wrong if it does not. */
  const addingRef = useRef(false);
  const [lost, setLost] = useState(false);
  // The account page, and the sign-in request of a TV (from its QR code) waiting for this signed-in phone to say yes or no.
  const [showAccount, setShowAccount] = useState(false);
  /** The account page opens on its menu, or on the friends when the bell sent it there. */
  const [accountAt, setAccountAt] = useState<"main" | "friends">("main");
  const [showBell, setShowBell] = useState(false);
  /** The friend whose chat the bell opened (the chat from a friend's page is that page's own). */
  const [chatWith, setChatWith] = useState<string | null>(null);
  const closeAccount = () => {
    setShowAccount(false);
    setAccountAt("main");
  };
  const [approveCode, setApproveCode] = useState<string | null>(launchRef.current.link ?? null);
  /** A friend's code, from the link or the QR code of their invitation: asked about until it is used or sent away. */
  const [friendCode, setFriendCode] = useState<string | null>(launchRef.current.friend ?? null);
  useLayoutEffect(() => {
    // A sign-in code is for one use: it does not stay in the address (a reload or a bookmark would offer it again). Nor does a friend's.
    // (Before the sheet that asks about it adds its own step to the history: that one would be changed, and the first would keep the code.)
    if (launchRef.current.link || launchRef.current.friend) window.history.replaceState(window.history.state, "", location.pathname);
  }, []);

  /** A video was found: it moves to the front of "Continue watching" (keeping its place if it was left unfinished). */
  const onFound = (found: NormalizedMedia) => {
    setMedia(found);
    profileStore.playbackStarted(found);
  };

  useEffect(() => {
    const socket = connectSocket({
      hello: () => ({ type: "CTL_HELLO", controllerId: readKept(CONTROLLER_KEY) }),
      onStatus: (status) => {
        setConnection(status);
        if (status !== "open") setPairing(false); // a code sent over a connection that is gone gets no answer: do not wait for one
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
              addingRef.current = false; // the TV that was asked for has answered: the list of TVs has done its job
              setSheet((open) => (open === "tvs" ? null : open));
            }
            if (message.tv) {
              hadTvRef.current = true;
              setLost(false);
            } else if (hadTvRef.current) {
              hadTvRef.current = false; // the TV let go, or the server forgot it (it was restarted): the first screen says so, and its code is no use any more
              setLost(true);
              setCode("");
            }
            if (!message.tv) {
              setSheet(null);
              setListSheet(null);
              setRatingsOpen(false);
              setTitle(null);
              setResolve(null);
              setOther(null);
            }

            const launch = launchRef.current;
            if (launch.code || launch.control || launch.url) window.history.replaceState(window.history.state, "", location.pathname);
            const scanned = launch.code ?? launch.control;
            if (scanned && message.tv && !message.tv.online && message.tv.controlCode !== scanned) {
              // The TV this phone had is off, so there is nothing to ask: another TV's code is the answer. The first stays on the list.
              launchRef.current = { ...launch, code: undefined, control: undefined };
              sentCodeRef.current = scanned;
              socketRef.current?.send({ type: "PAIR", code: scanned });
              setPairing(true);
              break;
            }
            if (scanned) {
              // Scanned the TV's QR code: connect straight away. A phone that has a TV is asked first (unless this is that TV's own code).
              launchRef.current = { ...launch, code: undefined, control: undefined };
              if (!message.tv) {
                sentCodeRef.current = scanned;
                socketRef.current?.send({ type: "PAIR", code: scanned });
                setPairing(true);
              } else if (message.tv.controlCode !== scanned) {
                setOther({ code: scanned, control: launch.code === undefined });
              }
            } else if (launch.url && message.tv) {
              // Shared a link to this app: play it as soon as there is a TV to play it on.
              launchRef.current = { ...launch, url: undefined };
              playLink(launch.url);
            }
            break;
          }
          case "STATE":
            setPlayer(message.state);
            break;
          case "RESOLVE_STATUS":
            setResolve(message.status.phase === "cancelled" ? null : message.status); // given up on at the TV: nothing left to wait for
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
            // How the list looks now (a TV came or went, was named); the header shows the TV in use, so it is told as well.
            const now = message.tvs.find((row) => row.current);
            setTvs(message.tvs);
            setTv((current) => (current && now ? { ...current, name: now.name, online: now.online } : current));
            break;
          }
          case "MEDIA":
            setMedia(message.media);
            break;
          case "ERROR":
            // The code was a watch party's, which a screen joins, not a remote: this phone becomes one, as the party's own link would make it.
            if (message.code === "PARTY_CODE" && sentCodeRef.current) {
              location.assign(partyLink(sentCodeRef.current));
              break;
            }
            // "Invalid message" means the server is older than this page (started before an update, never restarted); see socketError.
            setError(socketError(message.code, message.message));
            if (message.code === "INVALID_CODE") setCode(""); // the digits are of no use again: the field is ready for the next try
            setPairing(false);
            addingRef.current = false; // (the list of TVs stays open, with the error in it)
            setInvite((current) => (current === "asking" ? null : current)); // no answer is coming
            break;
        }
      },
    });
    socketRef.current = socket;
    return () => socket.disconnect();
  }, []);

  /**
   * Any pasted or shared link (page or direct media): the server finds the video and tells the TV. `startAt` picks up an
   * unfinished title where it was left, and `hint` carries the picture and year a library tile already has.
   */
  const playLink = (link: string, startAt?: number, hint?: PlayHint) => {
    setError(null);
    setResolve(null);
    // (The server cannot read a longer one, and would answer with the words for a page that is newer than it: a signed link of a file host can be that long.)
    if (link.length > MAX_LINK_LENGTH) return setError(t("phone.linkTooLong"));
    setRemoteShown(true); // (a title picked while another plays: the remote is for that one)
    socketRef.current?.send({ type: "PLAY_URL", url: link, ...(startAt ? { startAt } : {}), ...(hint ? { hint } : {}) });
  };

  /** Ask the TV for the code of its party; asking is what opens one, and the TV answers with the code (and who is in). */
  const openParty = () => {
    setInvite("asking");
    socketRef.current?.send({ type: "OPEN_PARTY" });
  };

  /** A friend asked to watch together: this phone's TV starts a party (asking for its code does that), and the friend is invited as soon as the code is here. */
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
        await friends.refresh(); // (the server takes the request away once they are invited)
      },
      (error: unknown) => account.say(describeError(error)),
    );
    // The party is what the person asked for: they see its code, and who comes.
    closeAccount();
    setSheet("party");
  }, [together, invite]);

  /** The menu shows the code a second phone joins with: opening it asks again, which gives the current code and keeps it good for a while. */
  const openMenu = () => {
    socketRef.current?.send({ type: "CTL_HELLO", controllerId: readKept(CONTROLLER_KEY) });
    setSheet("menu");
  };

  const send = (command: Command) => {
    setError(null);
    // A tick under the thumb, where the browser has a motor for it (not on iPhones).
    try {
      navigator.vibrate?.(8);
    } catch {
      /* no vibration here */
    }
    socketRef.current?.send({ type: "CMD", command });
  };

  const stop = () => {
    if (media && player.duration > 0 && stateIsFor(media, player)) profileStore.playbackAt(media, player); // the exact spot it stopped at
    setResolve(null);
    send({ type: "STOP" });
  };

  // What the TV reports of the video is where it got to: remembered every few seconds (the store ignores what barely moved).
  useEffect(() => {
    if (!media || (player.state !== "playing" && player.state !== "paused") || player.buffering || player.duration <= 0 || !stateIsFor(media, player)) return;
    profileStore.playbackAt(media, player);
  }, [player, media]);

  // What the TV just did, in a line at the bottom: the answer to a button, and the news when someone else pressed one.
  const [toast, setToast] = useState<{ id: number; text: string; long?: true } | null>(null);
  const lastPlayerRef = useRef<PlayerState>(IDLE_STATE);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  useEffect(() => {
    const change = describeChange(lastPlayerRef.current, player, noticeText);
    lastPlayerRef.current = player;
    // With a sheet open the answer is in the sheet itself (the row that is now chosen): a line over its rows would only be in the way.
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
  // What a hold on a title did (it went in a list, or came out) is said down here as well, where the finger is.
  useEffect(() => {
    const say = (event: Event) => setToast((current) => ({ id: (current?.id ?? 0) + 1, text: String((event as CustomEvent<string>).detail) }));
    window.addEventListener(LINE_EVENT, say);
    return () => window.removeEventListener(LINE_EVENT, say);
  }, []);
  // A play that did not work says so where the thumb is: the page's own line sits at the top of a library that may be scrolled far from it.
  useEffect(() => {
    if (resolve?.phase === "failed") setToast((current) => ({ id: (current?.id ?? 0) + 1, text: resolveFailure(resolve), long: true }));
    else if (resolve?.phase === "resolving") setToast((current) => (current?.long ? null : current)); // another try: the answer to the last one has had its say
  }, [resolve]);

  // A lookup that never reports back must not leave the phone waiting.
  useEffect(() => {
    if (resolve?.phase !== "resolving") return;
    const timer = setTimeout(
      () =>
        setResolve({ phase: "failed", reason: "temporary_failure", message: "This is taking too long. Try again in a moment." }),
      RESOLVE_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [resolve]);

  // "Video found" is only a stepping stone; it must not still be on screen once playback has ended.
  useEffect(() => {
    if (player.state === "idle" || player.state === "playing" || player.state === "paused") setResolve((status) => (status?.phase === "found" ? null : status));
  }, [player.state]);

  const active = player.state !== "idle" && media !== null;
  // The remote is the page while something plays, as it has been; the phone's own Back puts it away, to the library, and the film plays on (a line
  // at the top of the library brings the remote back). A film that starts (here, or on the TV) brings it up again.
  const [remoteShown, setRemoteShown] = useState(true);
  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current) setRemoteShown(true);
    wasActive.current = active;
  }, [active]);
  /** The server is reached but the TV is not: nothing the remote shows of it can be trusted. */
  const away = connection === "open" && tv !== null && !tv.online;
  /** The remote has the screen (the bar, and the places it leads to, are put away until it is). */
  const remoteOpen = active && remoteShown && !away;
  useBackWhile(remoteOpen, () => setRemoteShown(false));
  // The four places of the bar: Home, Search, My lists and You.
  const tabs = useTabs(remoteOpen, tv !== null);
  useEffect(() => {
    if (!active) setSheet((open) => (open && open !== "menu" && open !== "party" && open !== "tvs" ? null : open));
  }, [active]);

  /* ------------------------------ views ------------------------------ */

  const closeApprove = () => setApproveCode(null);
  /** Devices were signed out of the account: the TV that goes with this phone may be one of them, and finds out now rather than at its next exchange with the server. */
  const tellTvToLookAgain = () => {
    if (tv?.online) socketRef.current?.send({ type: "CMD", command: { type: "REFRESH_ACCOUNT" } });
  };
  const bellButton = <BellButton onClick={() => setShowBell(true)} />;
  // (The first page has no bar: the account opens over it. On the bar's pages it is a place of the bar: "You".)
  const accountButton = (
    <>
      {bellButton}
      <AccountButton onClick={() => setShowAccount(true)} />
    </>
  );
  const pickList = (entry: ListEntry) => setListSheet({ kind: "pick", entry });
  // A title's page, and the lists it can go in: over the remote, and over the account too (My ratings, a friend's lists), which a phone with no TV has as well. It then has no Play.
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
          onClose={() => setTitle(null)}
        />
      )}
      {listSheet?.kind === "manage" && <ListsSheet onClose={() => setListSheet(null)} />}
      {listSheet?.kind === "pick" && <ListPickerSheet entry={listSheet.entry} onClose={() => setListSheet(null)} />}
    </>
  );
  // On top of whichever screen is showing: the account, a TV asking to be signed in, and what the account has to say.
  const accountLayer = (
    <>
      {approveCode ? (
        <Page title={t("account.signInTv")} onBack={closeApprove} testId="approve-page">
          <LinkApprove code={approveCode} onClose={closeApprove} />
        </Page>
      ) : (
        showAccount && <AccountScreen key={accountAt} initial={accountAt} onClose={closeAccount} onSessionsChanged={tellTvToLookAgain} onOpenTitle={setTitle} {...(tv ? { onStartParty: startTogether } : {})} />
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
      {chatWith && !showAccount && !approveCode && <PhoneChat key={chatWith} friendId={chatWith} onClose={() => setChatWith(null)} />}
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

  // The TVs this phone has: over the remote, and over the first screen when it controls none of them.
  const tvsSheet = sheet === "tvs" && (
    <TvsSheet
      tvs={tvs}
      error={error}
      onSwitch={(id) => {
        setSheet(null);
        socketRef.current?.send({ type: "SWITCH_TV", id });
      }}
      onForget={(id) => {
        if (tvs.some((row) => row.id === id && row.current)) hadTvRef.current = false; // asked for: not a pairing that was lost
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
        setError(null); // (what went wrong in there is not for the page behind it)
        setSheet(null);
      }}
    />
  );

  // Signed in on a phone that has not been told who is holding it: the first thing to ask.
  if (account.choosing && !approveCode) {
    return (
      <>
        <ChooseProfile />
        <div className="phone-ui layers">{accountLayer}</div>
      </>
    );
  }

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
          notice={lost ? t("phone.tvGone") : null}
          tvCount={tvs.length}
          onTvs={() => setSheet("tvs")}
          corner={
            <>
              {/* This page's own full screen, which hides the browser's bar (the TV's is a button on the remote, in the paired phone's menu there is this one). */}
              <FullscreenToggle className="icon-btn" />
              {accountButton}
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
  /** Let go of this TV: it shows a new code, and this phone is on the first screen again. */
  const disconnect = () => {
    hadTvRef.current = false; // asked for: not a pairing that was lost
    socketRef.current?.send({ type: "UNPAIR" });
    setCode("");
    setSheet(null);
  };
  const closeSheet = () => {
    if (sheet === "party" || sheet === "tvs") setError(null); // what went wrong in there (a code that was refused) is not for the page behind it
    setSheet(null);
  };
  const status = connection !== "open" ? t("phone.reconnecting") : tv.online ? t("phone.tvConnected") : t("phone.tvDisconnected");
  const removeFromList = (url: string, id: string) => profileStore.removeFromList(url, id);

  /* The four places of the bar (the one that is showing is drawn; the others are not: a library that is not on screen must not go on asking for its next rows). */

  // Home: where a link is pasted (the box is there when it is turned on, and when the library has nothing to play instead: it would be the only way to start anything) and what to watch next.
  const home = (
    <section className="home" data-testid="home-panel">
      <h2 className="sr-only">{t("phone.homeTitle")}</h2>
      <PlayLink tvName={tv.name} resolve={resolve} onPlay={(url) => playLink(url)} form={linkBox} status={false} />
      <FriendsHome onOpenTitle={setTitle} onStartParty={startTogether} />
      <ContinueRow items={progress} onPlay={playLink} onRemove={(key) => profileStore.removeProgress(key)} onPick={pickList} />
      <Library onOpen={setTitle} onPick={pickList} failedLookups={failedLookups} fallback={linkBox ? undefined : <PlayLink tvName={tv.name} resolve={resolve} onPlay={(url) => playLink(url)} status={false} />} />
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
      onRemove={removeFromList}
      onManage={() => setListSheet({ kind: "manage" })}
      onAllRatings={() => setRatingsOpen(true)}
      onBrowse={() => tabs.setTab("home")}
    />
  );
  const you = <AccountScreen inline onClose={() => tabs.setTab("home")} onSessionsChanged={tellTvToLookAgain} onOpenTitle={setTitle} onStartParty={startTogether} />;
  const panel = { home, search, list: myLists, you }[tabs.tab];
  /** What plays is a line above the bar, on every page, until the remote is the page (and not while the TV is gone: what it says of the film cannot be trusted). */
  const mini = active && media !== null && !remoteOpen && !away;

  return (
    <main className={`phone phone-ui shell${remoteOpen ? " is-remote" : ""}${mini ? " has-mini" : ""}`} data-tab={tabs.tab}>
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

      {waking && (
        <p className="banner" data-testid="server-waking" role="status">
          {t("server.waking")}
        </p>
      )}

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

      {/* What the lookup of a link is up to, whichever page the phone is on (a title is picked on any of them). */}
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
            // Another video is picked where videos are: the remote steps aside (the film plays on) and the page with the box for a link and the library is the one in view.
            setRemoteShown(false);
            tabs.setTab("home");
          }}
        />
      ) : (
        <div className="tab-panel" key={tabs.tab}>
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
          linkBox={linkBox}
          onLinkBox={changeLinkBox}
          onParty={() => setSheet("party")}
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
          canAdd={!other.control}
          onClose={() => setOther(null)}
          onAdd={() => {
            setError(null);
            socketRef.current?.send({ type: "ADD_TV", code: other.code });
            setOther(null);
            setSheet("party");
          }}
          onSwitch={() => {
            // The first TV stays on the list, as it was: the code is all it takes.
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
        <QualitySheet player={player} onClose={closeSheet} onPick={(level) => send({ type: "SET_QUALITY", level })} />
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
