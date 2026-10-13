import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  IDLE_STATE,
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
import type { ListEntry } from "../account/profileStore";
import { profileStore, useProfileData } from "../account/store";
import { useT } from "../i18n";
import { Rich } from "../i18n/Rich";
import { readKept, writeKept } from "../shared/kept";
import { FullscreenToggle } from "../shared/FullscreenToggle";
import { MoreIcon, TvIcon } from "../shared/icons";
import { partyLink, readLaunchParams } from "../shared/launch";
import { useLinkBox } from "../shared/linkBox";
import { connectSocket, type Socket, type SocketStatus } from "../shared/socket";
import { useWaking } from "../shared/useSlow";
import { noticeText, resolveFailure, socketError } from "../shared/words";
import { AccountButton, AccountScreen, ChooseProfile, Page } from "./AccountScreen";
import { LinkApprove } from "../account/LinkApprove";
import type { Entry } from "../tv/pages";
import { FriendInvite, FriendsHome } from "./Friends";
import { Library } from "./Library";
import { ListPickerSheet, ListsSheet } from "./ListSheets";
import { PairScreen } from "./PairScreen";
import { PlayLink } from "./PlayLink";
import { Remote, type SheetKind } from "./Remote";
import { LINE_EVENT } from "./Round";
import { RatingsSheet } from "./RatingsSheet";
import { ContinueRow, ListRows, RatingsRow } from "./Rows";
import { Sheet } from "./Sheet";
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

const CONTROLLER_KEY = "controller.id";
/** A lookup that has not answered by now is reported as failed instead of spinning forever. */
const RESOLVE_TIMEOUT_MS = 40_000;

export function Controller() {
  const t = useT();
  const account = useAccount();
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
  const [approveCode, setApproveCode] = useState<string | null>(launchRef.current.link ?? null);
  /** A friend's code, from the link or the QR code of their invitation: asked about until it is used or sent away. */
  const [friendCode, setFriendCode] = useState<string | null>(launchRef.current.friend ?? null);
  useLayoutEffect(() => {
    // A sign-in code is for one use: it does not stay in the address (a reload or a bookmark would offer it again). Nor does a friend's.
    // (Before the sheet that asks about it adds its own step to the history: that one would be changed, and the first would keep the code.)
    if (launchRef.current.link || launchRef.current.friend) window.history.replaceState(null, "", location.pathname);
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
            if (launch.code || launch.control || launch.url) window.history.replaceState(null, "", location.pathname);
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
              setSheet((open) => (open === "link" || open === "episodes" ? null : open));
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
    socketRef.current?.send({ type: "PLAY_URL", url: link, ...(startAt ? { startAt } : {}), ...(hint ? { hint } : {}) });
  };

  /** Ask the TV for the code of its party; asking is what opens one, and the TV answers with the code (and who is in). */
  const openParty = () => {
    setInvite("asking");
    socketRef.current?.send({ type: "OPEN_PARTY" });
  };

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
  // A play that did not work says so where the thumb is: the page's own line sits at the top of a library that may be scrolled far from it (the link sheet has the line itself, in view).
  useEffect(() => {
    if (resolve?.phase === "failed" && sheetRef.current !== "link") setToast((current) => ({ id: (current?.id ?? 0) + 1, text: resolveFailure(resolve), long: true }));
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
  useEffect(() => {
    if (!active) setSheet((open) => (open && open !== "menu" && open !== "party" && open !== "tvs" ? null : open));
  }, [active]);

  /* ------------------------------ views ------------------------------ */

  const closeApprove = () => setApproveCode(null);
  /** Devices were signed out of the account: the TV that goes with this phone may be one of them, and finds out now rather than at its next exchange with the server. */
  const tellTvToLookAgain = () => {
    if (tv?.online) socketRef.current?.send({ type: "CMD", command: { type: "REFRESH_ACCOUNT" } });
  };
  const accountButton = <AccountButton onClick={() => setShowAccount(true)} />
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
        showAccount && <AccountScreen onClose={() => setShowAccount(false)} onSessionsChanged={tellTvToLookAgain} onOpenTitle={setTitle} />
      )}
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
        {accountLayer}
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
        {tvsSheet}
        {accountLayer}
        {titleSheets}
      </>
    );
  }

  const online = connection === "open" && tv.online;
  /** The server is reached but the TV is not: nothing the remote shows of it can be trusted. */
  const away = connection === "open" && !tv.online;
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
  // The box for pasting a link is there when it is turned on, and when the library has nothing to play instead (it would be the only way to start anything).
  const link = (
    <>
      <PlayLink tvName={tv.name} resolve={resolve} onPlay={(url) => playLink(url)} form={linkBox} />
      <FriendsHome onOpenTitle={setTitle} />
      <ContinueRow items={progress} onPlay={playLink} onRemove={(key) => profileStore.removeProgress(key)} onPick={pickList} />
      <ListRows lists={lists} items={list} onOpen={setTitle} onPick={pickList} onRemove={(url, id) => profileStore.removeFromList(url, id)} onManage={() => setListSheet({ kind: "manage" })} />
      {ratingsOn && <RatingsRow ratings={ratings} onOpen={setTitle} onAll={() => setRatingsOpen(true)} />}
      <Library onOpen={setTitle} onPick={pickList} failedLookups={failedLookups} fallback={linkBox ? undefined : <PlayLink tvName={tv.name} resolve={resolve} onPlay={(url) => playLink(url)} status={false} />} />
    </>
  );

  return (
    <main className="phone">
      {accountLayer}
      <header className="top">
        <div className="top-tv">
          <TvIcon />
          {/* The name gets the width; how the TV is doing sits under it as a few small words. */}
          <div className="top-name">
            <div className="top-line">
              <h1 data-testid="tv-name">{tv.name}</h1>
              {party.length > 0 && (
                <span className="party-count" data-testid="party-count">
                  +{party.length}
                </span>
              )}
            </div>
            <span className={`tv-status ${online ? "ok" : "bad"}`} data-testid="tv-online">
              {connection !== "open" ? t("phone.reconnecting") : tv.online ? t("phone.tvConnected") : t("phone.tvDisconnected")}
            </span>
          </div>
        </div>
        {accountButton}
        <button className="icon-btn" aria-label={t("phone.tvMenu")} data-testid="menu" onClick={openMenu}>
          <MoreIcon />
        </button>
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

      {away && active ? null : active && media ? (
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
        />
      ) : (
        <section className="home">
          <h2>{t("phone.homeTitle")}</h2>
          {linkBox && <p className="muted">{t("phone.homeHelp", { tv: tv.name })}</p>}
          {link}
        </section>
      )}

      {active && sheet !== "link" && resolve && resolve.phase !== "found" && (
        <p className={`status ${resolve.phase}`} data-testid="resolve-status" data-phase={resolve.phase} role="status">
          {resolve.phase === "resolving" ? (
            <>
              <span className="spinner" />
              {t("play.finding")}
            </>
          ) : (
            resolveFailure(resolve)
          )}
        </p>
      )}

      {error && sheet !== "party" && sheet !== "tvs" && (
        <p className="error banner" data-testid="error" role="alert">
          {error}
        </p>
      )}

      {sheet === "link" && (
        <Sheet title={t("play.on", { tv: tv.name })} onClose={closeSheet} testId="link-sheet">
          {link}
        </Sheet>
      )}
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
