import { useEffect, useRef, useState } from "react";
import {
  IDLE_STATE,
  describeChange,
  parseWatched,
  previousEpisode,
  recordWatching,
  serializeWatched,
  seriesKeyOf,
  stateIsFor,
  type Command,
  type NormalizedMedia,
  type PartyTv,
  type PlayerState,
  type ResolveStatus,
  type TvInfo,
} from "../../shared";
import { readStorage, writeStorage } from "../shared/format";
import { MoreIcon, TvIcon } from "../shared/icons";
import { readLaunchParams } from "../shared/launch";
import { connectSocket, type Socket, type SocketStatus } from "../shared/socket";
import {
  HISTORY_KEY,
  parseHistory,
  recordPlay,
  recordProgress,
  removeEntry,
  serializeHistory,
  type HistoryEntry,
} from "./history";
import { Library } from "./Library";
import { PairScreen } from "./PairScreen";
import { PlayLink } from "./PlayLink";
import { Remote, type SheetKind } from "./Remote";
import { Sheet } from "./Sheet";
import { CaptionStyleSheet, EpisodesSheet, MenuSheet, PartySheet, QualitySheet, SourcesSheet, SpeedSheet, TracksSheet } from "./Sheets";
import "./controller.css";

const CONTROLLER_KEY = "controller.id";
const WATCHED_KEY = "controller.watched";
/** A lookup that has not answered by now is reported as failed instead of spinning forever. */
const RESOLVE_TIMEOUT_MS = 40_000;
/** How often playback progress is written to the recently-played list. Stop saves the exact spot. */
const PROGRESS_EVERY_MS = 5_000;
/** The link a phone sent is only attached to a "found" that arrives soon after. */
const PENDING_LINK_MS = 90_000;

/**
 * This page only sends messages it knows are valid, so "invalid message" means the server is older than the page:
 * it was started before an update and never restarted. "Invalid message." alone leaves nobody any the wiser.
 */
const OUTDATED_SERVER = "The server doesn't understand this app version. Restart the server, then reload this page.";

export function Controller() {
  const socketRef = useRef<Socket | null>(null);
  const [connection, setConnection] = useState<SocketStatus>("connecting");
  const [tv, setTv] = useState<TvInfo | null>(null);
  const [media, setMedia] = useState<NormalizedMedia | null>(null);
  const [player, setPlayer] = useState<PlayerState>(IDLE_STATE);
  const [error, setError] = useState<string | null>(null);
  const [resolve, setResolve] = useState<ResolveStatus | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [pairing, setPairing] = useState(false);
  /** The other TVs that watch along with this phone's TV. */
  const [party, setParty] = useState<PartyTv[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>(() => parseHistory(readStorage(HISTORY_KEY)));

  // What this page was opened for: a code from the TV's QR code, or a link shared from another app.
  const launchRef = useRef(readLaunchParams(location.search));
  const [code, setCode] = useState(launchRef.current.code ?? "");

  const mediaRef = useRef<NormalizedMedia | null>(null);
  mediaRef.current = media;
  /** The link the phone just sent, waiting for the resolver to say what it turned out to be. */
  const pendingRef = useRef<{ url: string; at: number } | null>(null);
  const lastSaveRef = useRef(0);

  useEffect(() => {
    writeStorage(HISTORY_KEY, serializeHistory(history));
  }, [history]);

  // Which episodes were watched, for the episode list.
  const [watched, setWatched] = useState(() => parseWatched(readStorage(WATCHED_KEY)));
  useEffect(() => {
    writeStorage(WATCHED_KEY, serializeWatched(watched));
  }, [watched]);

  /** A video was found: remember it in the recently-played list, under the link that led to it. */
  const onFound = (found: NormalizedMedia) => {
    setMedia(found);
    const pending = pendingRef.current;
    pendingRef.current = null;
    const previous = mediaRef.current;
    // Not sent from this phone? Then it is the next (or previous) episode starting from the TV.
    const advanced = found.series
      ? [previous?.series?.next, previousEpisode(previous?.series)].find(
          (episode) => episode && episode.season === found.series?.season && episode.episode === found.series.episode,
        )?.url
      : undefined;
    const url = pending && Date.now() - pending.at < PENDING_LINK_MS ? pending.url : advanced;
    if (!url) return;
    const seriesKey = seriesKeyOf(found);
    setHistory((list) =>
      recordPlay(list, {
        url,
        title: found.title ?? "",
        streamUrl: found.stream.url,
        ...(seriesKey ? { seriesKey } : {}),
        now: Date.now(),
      }),
    );
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
            setError(null);
            setPairing(false);
            if (!message.tv) {
              setSheet(null);
              setResolve(null);
            }

            const launch = launchRef.current;
            if (launch.code || launch.url) window.history.replaceState(null, "", location.pathname);
            if (launch.code) {
              // Scanned the TV's QR code: connect straight away, switching TVs if this phone had another.
              launchRef.current = { ...launch, code: undefined };
              if (message.tv) socketRef.current?.send({ type: "UNPAIR" });
              socketRef.current?.send({ type: "PAIR", code: launch.code });
              setPairing(true);
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
            setResolve(message.status);
            if (message.status.phase === "found") {
              onFound(message.status.media);
              setSheet((open) => (open === "link" || open === "episodes" ? null : open));
            } else if (message.status.phase === "failed") {
              pendingRef.current = null;
            }
            break;
          case "PARTY":
            setParty(message.tvs);
            break;
          case "TV_STATUS":
            setTv((current) => (current ? { ...current, online: message.online } : current));
            break;
          case "MEDIA":
            setMedia(message.media);
            break;
          case "ERROR":
            setError(message.code === "BAD_MESSAGE" ? OUTDATED_SERVER : message.message);
            setPairing(false);
            break;
        }
      },
    });
    socketRef.current = socket;
    return () => socket.disconnect();
  }, []);

  /** Any pasted or shared link (page or direct media): the server finds the video and tells the TV. */
  const playLink = (link: string, startAt?: number) => {
    setError(null);
    setResolve(null);
    pendingRef.current = { url: link, at: Date.now() };
    socketRef.current?.send({ type: "PLAY_URL", url: link, ...(startAt ? { startAt } : {}) });
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
    if (media && player.duration > 0) saveProgress(media, player);
    pendingRef.current = null;
    setResolve(null);
    send({ type: "STOP" });
  };

  const saveProgress = (current: NormalizedMedia, state: PlayerState) =>
    stateIsFor(current, state) &&
    setHistory((list) =>
      recordProgress(list, {
        streamUrl: current.stream.url,
        position: state.currentTime,
        duration: state.duration,
        now: Date.now(),
      }),
    );

  // Every few seconds of real playback, remember how far it got. A pause saves at once: the TV stops reporting while nothing changes.
  useEffect(() => {
    const watching = player.state === "playing" || player.state === "paused";
    if (!media || !watching || player.buffering || player.duration <= 0) return;
    const now = Date.now();
    if (player.state === "playing" && now - lastSaveRef.current < PROGRESS_EVERY_MS) return;
    lastSaveRef.current = now;
    saveProgress(media, player);
  }, [player, media]);

  useEffect(() => {
    if (!media || (player.state !== "playing" && player.state !== "paused") || player.buffering || !stateIsFor(media, player)) return;
    setWatched((list) => recordWatching(list, media, player, Date.now()));
  }, [player, media]);

  // What the TV just did, in a line at the bottom: the answer to a button, and the news when someone else pressed one.
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const lastPlayerRef = useRef<PlayerState>(IDLE_STATE);
  useEffect(() => {
    const change = describeChange(lastPlayerRef.current, player);
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

  if (!tv) {
    return (
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
      />
    );
  }

  const online = connection === "open" && tv.online;
  const closeSheet = () => setSheet(null);
  const link = (
    <>
      <PlayLink
        tvName={tv.name}
        resolve={resolve}
        history={history}
        onPlay={playLink}
        onRemove={(url) => setHistory((list) => removeEntry(list, url))}
      />
      <Library onPlay={playLink} />
    </>
  );

  return (
    <main className="phone">
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
          {connection !== "open" ? "Reconnecting…" : tv.online ? "TV connected" : "TV disconnected"}
        </span>
        <button className="icon-btn" aria-label="TV menu" data-testid="menu" onClick={() => setSheet("menu")}>
          <MoreIcon />
        </button>
      </header>

      {connection === "open" && !tv.online && (
        <p className="banner">
          The TV is offline. Open <b>{location.host}</b> on it and this remote will pick up again.
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
          <h2>What do you want to watch?</h2>
          <p className="muted">Paste a link to a video, or to a page that has one. It plays on {tv.name}, without the page.</p>
          {link}
        </section>
      )}

      {active && sheet !== "link" && resolve && resolve.phase !== "found" && (
        <p className={`status ${resolve.phase}`} data-testid="resolve-status" data-phase={resolve.phase} role="status">
          {resolve.phase === "resolving" ? (
            <>
              <span className="spinner" />
              Finding video…
            </>
          ) : (
            resolve.message
          )}
        </p>
      )}

      {error && sheet !== "party" && (
        <p className="error banner" data-testid="error" role="alert">
          {error}
        </p>
      )}

      {sheet === "link" && (
        <Sheet title={`Play on ${tv.name}`} onClose={closeSheet} testId="link-sheet">
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
          error={error}
          onClose={closeSheet}
          onAdd={(code) => {
            setError(null);
            socketRef.current?.send({ type: "ADD_TV", code });
          }}
          onRemove={(id) => socketRef.current?.send({ type: "REMOVE_TV", id })}
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
