import { useEffect, useRef, useState } from "react";
import {
  IDLE_STATE,
  describeChange,
  previousEpisode,
  seriesKeyOf,
  stateIsFor,
  type Command,
  type NormalizedMedia,
  type PartyTv,
  type PlayHint,
  type PlayerState,
  type ResolveStatus,
  type TvInfo,
} from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { profileStore, useProfileData } from "../account/store";
import { useT } from "../i18n";
import { Rich } from "../i18n/Rich";
import { readStorage, writeStorage } from "../shared/format";
import { MoreIcon, TvIcon } from "../shared/icons";
import { readLaunchParams } from "../shared/launch";
import { connectSocket, type Socket, type SocketStatus } from "../shared/socket";
import { noticeText, resolveFailure, socketError } from "../shared/words";
import { AccountButton, AccountScreen, ChooseProfile, Page } from "./AccountScreen";
import { LinkApprove } from "../account/LinkApprove";
import { Library } from "./Library";
import { PairScreen } from "./PairScreen";
import { PlayLink } from "./PlayLink";
import { Remote, type SheetKind } from "./Remote";
import { ContinueRow, ListRow } from "./Rows";
import { Sheet } from "./Sheet";
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
  const [tv, setTv] = useState<TvInfo | null>(null);
  const [media, setMedia] = useState<NormalizedMedia | null>(null);
  const [player, setPlayer] = useState<PlayerState>(IDLE_STATE);
  const [error, setError] = useState<string | null>(null);
  /** What the lookup of a link is up to (a status of "cancelled" clears it instead of being kept). */
  const [resolve, setResolve] = useState<Exclude<ResolveStatus, { phase: "cancelled" }> | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [pairing, setPairing] = useState(false);
  /** The other TVs that watch along with this phone's TV, and the code that brings another one in. */
  const [party, setParty] = useState<PartyTv[]>([]);
  const [invite, setInvite] = useState<PartyInvite>(null);
  /** The code of another TV that this phone scanned while it had one: waiting to be told what the new TV is for. `control`: that TV has a phone, so joining its party is not an option. */
  const [other, setOther] = useState<{ code: string; control: boolean } | null>(null);
  // What the profile in use has watched and saved: "Continue watching", My List, and the marks on the episode list.
  const { progress, watched, list } = useProfileData();

  // What this page was opened for: a code from the TV's QR code, or a link shared from another app.
  const launchRef = useRef(readLaunchParams(location.search));
  const [code, setCode] = useState(launchRef.current.code ?? "");
  // The account page, and the sign-in request of a TV (from its QR code) waiting for this signed-in phone to say yes or no.
  const [showAccount, setShowAccount] = useState(false);
  const [approveCode, setApproveCode] = useState<string | null>(launchRef.current.link ?? null);
  useEffect(() => {
    // A sign-in code is for one use: it does not stay in the address (a reload or a bookmark would offer it again).
    if (launchRef.current.link) window.history.replaceState(null, "", location.pathname);
  }, []);

  /** A video was found: it moves to the front of "Continue watching" (keeping its place if it was left unfinished). */
  const onFound = (found: NormalizedMedia) => {
    setMedia(found);
    profileStore.playbackStarted(found);
  };

  useEffect(() => {
    const socket = connectSocket({
      hello: () => ({ type: "CTL_HELLO", controllerId: readStorage(CONTROLLER_KEY) }),
      onStatus: setConnection,
      onMessage: (message) => {
        switch (message.type) {
          case "CTL_WELCOME": {
            writeStorage(CONTROLLER_KEY, message.controllerId);
            setTv(message.tv);
            setMedia(message.media);
            setPlayer(message.state);
            setParty(message.party ?? []);
            setInvite(null);
            setError(null);
            setPairing(false);
            if (!message.tv) {
              setSheet(null);
              setResolve(null);
              setOther(null);
            }

            const launch = launchRef.current;
            if (launch.code || launch.control || launch.url) window.history.replaceState(null, "", location.pathname);
            const scanned = launch.code ?? launch.control;
            if (scanned) {
              // Scanned the TV's QR code: connect straight away. A phone that has a TV is asked first (unless this is that TV's own code).
              launchRef.current = { ...launch, code: undefined, control: undefined };
              if (!message.tv) {
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
          case "MEDIA":
            setMedia(message.media);
            break;
          case "ERROR":
            // "Invalid message" means the server is older than this page (started before an update, never restarted); see socketError.
            setError(socketError(message.code, message.message));
            setPairing(false);
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
    socketRef.current?.send({ type: "CTL_HELLO", controllerId: readStorage(CONTROLLER_KEY) });
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
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const lastPlayerRef = useRef<PlayerState>(IDLE_STATE);
  useEffect(() => {
    const change = describeChange(lastPlayerRef.current, player, noticeText);
    lastPlayerRef.current = player;
    if (change) setToast((current) => ({ id: (current?.id ?? 0) + 1, text: change }));
  }, [player]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

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
    if (player.state === "idle") setResolve((status) => (status?.phase === "found" ? null : status));
  }, [player.state]);

  const active = player.state !== "idle" && media !== null;
  useEffect(() => {
    if (!active) setSheet((open) => (open && open !== "menu" && open !== "party" ? null : open));
  }, [active]);

  /* ------------------------------ views ------------------------------ */

  const closeApprove = () => setApproveCode(null);
  const accountButton = <AccountButton onClick={() => setShowAccount(true)} />;
  // On top of whichever screen is showing: the account, a TV asking to be signed in, and what the account has to say.
  const accountLayer = (
    <>
      {approveCode ? (
        <Page title={t("account.signInTv")} onBack={closeApprove} testId="approve-page">
          <LinkApprove code={approveCode} onClose={closeApprove} />
        </Page>
      ) : (
        showAccount && <AccountScreen onClose={() => setShowAccount(false)} />
      )}
      {account.message && (
        <p className="account-toast" key={account.message.id} role="status" data-testid="account-toast">
          {account.message.text}
        </p>
      )}
    </>
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
            socketRef.current?.send({ type: "PAIR", code: value });
          }}
          connection={connection}
          pending={pairing}
          error={error}
          corner={accountButton}
        />
        {accountLayer}
      </>
    );
  }

  const online = connection === "open" && tv.online;
  const closeSheet = () => setSheet(null);
  const absolute = (url: string) => new URL(url, location.href).href;
  const link = (
    <>
      <PlayLink tvName={tv.name} resolve={resolve} onPlay={(url) => playLink(url)} />
      <ContinueRow items={progress} onPlay={playLink} onRemove={(key) => profileStore.removeProgress(key)} />
      <ListRow items={list} onPlay={(url, hint) => playLink(absolute(url), undefined, hint)} onRemove={(url) => profileStore.removeFromList(url)} />
      <Library onPlay={(url, hint) => playLink(url, undefined, hint)} />
    </>
  );

  return (
    <main className="phone">
      {accountLayer}
      <header className="top">
        <div className="top-tv">
          <TvIcon />
          <h1 data-testid="tv-name">{tv.name}</h1>
          {party.length > 0 && (
            <span className="party-count" data-testid="party-count">
              +{party.length}
            </span>
          )}
        </div>
        <span className={`pill ${online ? "ok" : "bad"}`} data-testid="tv-online">
          {connection !== "open" ? t("phone.reconnecting") : tv.online ? t("phone.tvConnected") : t("phone.tvDisconnected")}
        </span>
        {accountButton}
        <button className="icon-btn" aria-label={t("phone.tvMenu")} data-testid="menu" onClick={openMenu}>
          <MoreIcon />
        </button>
      </header>

      {connection === "open" && !tv.online && (
        <p className="banner">
          <Rich k="phone.tvOffline" parts={{ host: <b>{location.host}</b> }} />
        </p>
      )}

      {active && media ? (
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
          <p className="muted">{t("phone.homeHelp", { tv: tv.name })}</p>
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

      {error && sheet !== "party" && (
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
          controlCode={tv.controlCode}
          controllerCount={tv.controllerCount}
          onParty={() => setSheet("party")}
          onClose={closeSheet}
          onDisconnect={() => {
            socketRef.current?.send({ type: "UNPAIR" });
            setCode("");
            setSheet(null);
          }}
        />
      )}
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
        />
      )}
      {other && (
        <OtherTvSheet
          tvName={tv.name}
          guests={party.length}
          phones={tv.controllerCount ?? 1}
          canAdd={!other.control}
          onClose={() => setOther(null)}
          onAdd={() => {
            setError(null);
            socketRef.current?.send({ type: "ADD_TV", code: other.code });
            setOther(null);
            setSheet("party");
          }}
          onSwitch={() => {
            socketRef.current?.send({ type: "UNPAIR" });
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

      {toast && (
        <p className="toast" key={toast.id} data-testid="toast" role="status">
          {toast.text}
        </p>
      )}
    </main>
  );
}
