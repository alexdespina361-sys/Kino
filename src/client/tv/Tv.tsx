import { useEffect, useRef, useState } from "react";
import { IDLE_STATE, type NormalizedMedia, type PlayerState } from "../../shared";
import { formatClock, readStorage, writeStorage } from "../shared/format";
import { APP_NAME } from "../shared/Logo";
import { connectSocket, type Socket, type SocketStatus } from "../shared/socket";
import { PlayerEngine } from "./engine";
import { Hud } from "./Hud";
import { TvIdle, TvLocked, type Pairing } from "./Idle";
import { actionForKey, SKIP_SECONDS } from "./keys";
import { moveInMenu, TvMenu, type MenuKind } from "./Menu";
import {
  describeTrack,
  parsePrefs,
  pickTrack,
  PREFS_KEY,
  serializePrefs,
  SUBTITLE_FONT_SIZE,
  type Prefs,
  type SubtitleSize,
} from "./prefs";
import { useWakeLock } from "./useWakeLock";
import "./tv.css";

const DEVICE_KEY = "tv.deviceId";
/** The overlay fades out this long after the last key press, but only while a video is actually playing. */
const HUD_HIDE_MS = 2500;
/** A lookup that never reports back (lost message, dead server) must not leave the TV spinning forever. */
const RESOLVING_TIMEOUT_MS = 45_000;
/** Skips pressed within this long of each other count as one run in the "+30s" flash. */
const SKIP_RUN_MS = 1200;

export function Tv() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [unlocked, setUnlocked] = useState(false);
  const [connection, setConnection] = useState<SocketStatus>("connecting");
  const [paired, setPaired] = useState(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [player, setPlayer] = useState<PlayerState>(IDLE_STATE);
  const [currentMedia, setCurrentMedia] = useState<NormalizedMedia | null>(null);
  const [resolving, setResolving] = useState(false);

  // Netflix Up Next Countdown & Preload State
  const [upNextCountdown, setUpNextCountdown] = useState<number | null>(null);
  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const preloadedNextMediaRef = useRef<NormalizedMedia | null>(null);

  // Audio / subtitles / speed / quality / episodes picker
  const [menu, setMenu] = useState<MenuKind | null>(null);

  // How the viewer likes to watch (subtitle language, audio language, text size), remembered on this TV.
  const [initialPrefs] = useState(() => parsePrefs(readStorage(PREFS_KEY)));
  const prefsRef = useRef<Prefs>(initialPrefs);
  const [subtitleSize, setSubtitleSize] = useState<SubtitleSize>(initialPrefs.subtitleSize ?? "medium");
  // Whether the remembered choice has been applied to the video that is loaded now (once per video).
  const appliedRef = useRef({ subtitles: false, audio: false });
  const playerRef = useRef<PlayerState>(IDLE_STATE);

  // Brief "+10s" flash after a skip, from the remote or the phone
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const toastIdRef = useRef(0);
  const skipRunRef = useRef({ total: 0, at: 0 });

  useWakeLock(unlocked);

  // Clock
  const [clock, setClock] = useState(() => formatClock(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setClock(formatClock(new Date())), 10_000);
    return () => clearInterval(timer);
  }, []);

  // Preload next episode whenever current media has a series next URL
  useEffect(() => {
    const nextUrl = currentMedia?.series?.next?.url;
    if (!nextUrl) {
      preloadedNextMediaRef.current = null;
      return;
    }

    let active = true;
    preloadedNextMediaRef.current = null;

    // 1. Resolve next episode via /api/resolve
    fetch(`/api/resolve?url=${encodeURIComponent(nextUrl)}`)
      .then((res) => res.json())
      .then(async (data: { status: string; media?: NormalizedMedia }) => {
        if (!active || data.status !== "success" || !data.media) return;
        preloadedNextMediaRef.current = data.media;

        // 2. Prefetch the master playlist and initial media chunks into browser HTTP cache
        try {
          const playlistRes = await fetch(data.media.stream.url);
          const playlistText = await playlistRes.text();
          const lines = playlistText.split(/\r?\n/);
          const firstProxyUrl = lines.find((l) => l.startsWith("/api/proxy"));
          if (firstProxyUrl) {
            const subRes = await fetch(firstProxyUrl);
            const subText = await subRes.text();
            const subLines = subText.split(/\r?\n/);
            const firstSegmentUrl = subLines.find((l) => l.startsWith("/api/proxy"));
            if (firstSegmentUrl) {
              // Prefetch first segment so playback begins instantaneously
              fetch(firstSegmentUrl).catch(() => {});
            }
          }
        } catch {
          // Preloading is best-effort
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [currentMedia?.series?.next?.url]);

  const currentMediaRef = useRef<NormalizedMedia | null>(null);
  currentMediaRef.current = currentMedia;
  playerRef.current = player;
  const upNextDismissedRef = useRef(false);
  upNextDismissedRef.current = upNextDismissed;

  const triggerNextEpisode = () => {
    setUpNextCountdown(null);
    setUpNextDismissed(false);
    const preloaded = preloadedNextMediaRef.current;
    const nextUrl = currentMediaRef.current?.series?.next?.url;

    if (preloaded && nextUrl) {
      setCurrentMedia(preloaded);
      resetApplied();
      engineRef.current?.load(preloaded.stream.url, preloaded.stream.type, preloaded.subtitles);
      engineRef.current?.play();
      socketRef.current?.send({ type: "TV_PLAY_URL", url: nextUrl });
    } else if (nextUrl) {
      socketRef.current?.send({ type: "TV_NEXT_EPISODE" });
    }
  };

  /* ---------------------------- overlay visibility ---------------------------- */

  const [controlsVisible, setControlsVisible] = useState(true);
  const visibleRef = useRef(true);
  visibleRef.current = controlsVisible;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Paused, loading, failed, or a menu open: the overlay stays put.
  const stickyRef = useRef(false);
  stickyRef.current = player.state !== "playing" || menu !== null;

  /** Show the overlay and start the countdown to hiding it again. */
  const wake = () => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!stickyRef.current) setControlsVisible(false);
    }, HUD_HIDE_MS);
  };

  useEffect(() => {
    if (player.state === "playing" && menu === null) {
      wake();
    } else {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setControlsVisible(true);
    }
  }, [player.state, menu]);

  // A hidden overlay must not keep keyboard focus, or OK would press a button nobody can see.
  useEffect(() => {
    if (!controlsVisible && controlsRef.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
  }, [controlsVisible]);

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  /* ------------------------- remembered track choices ------------------------- */

  const remember = (patch: Partial<Prefs>) => {
    prefsRef.current = { ...prefsRef.current, ...patch };
    writeStorage(PREFS_KEY, serializePrefs(prefsRef.current));
  };
  function resetApplied() {
    appliedRef.current = { subtitles: false, audio: false };
  }

  // Every way of changing a track (remote key, TV menu, the phone) goes through these, so the choice is always remembered.
  const chooseSubtitle = (track: number) => {
    appliedRef.current.subtitles = true;
    engineRef.current?.setSubtitle(track);
    const picked = playerRef.current.subtitles?.tracks.find((candidate) => candidate.id === track);
    remember({ subtitles: track === -1 || !picked ? "off" : describeTrack(picked) });
  };
  const chooseAudio = (track: number) => {
    appliedRef.current.audio = true;
    engineRef.current?.setAudio(track);
    const picked = playerRef.current.audio?.tracks.find((candidate) => candidate.id === track);
    if (picked) remember({ audio: describeTrack(picked) });
  };
  const chooseSize = (size: SubtitleSize) => {
    setSubtitleSize(size);
    remember({ subtitleSize: size });
  };

  useEffect(() => {
    if (player.state === "idle") resetApplied();
  }, [player.state]);

  // When a video's tracks show up, switch to the language the viewer picked last time. Once per video, and never over a manual pick.
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    const wanted = prefsRef.current;
    const subtitles = player.subtitles;
    if (!engine || !subtitles || applied.subtitles || subtitles.tracks.length === 0) return;
    applied.subtitles = true;
    if (wanted.subtitles === "off") {
      if (subtitles.current !== -1) engine.setSubtitle(-1);
    } else if (wanted.subtitles) {
      const id = pickTrack(subtitles.tracks, wanted.subtitles);
      if (id !== undefined && id !== subtitles.current) engine.setSubtitle(id);
    }
  }, [player.subtitles]);

  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    const audio = player.audio;
    if (!engine || !audio || applied.audio || audio.tracks.length < 2) return;
    applied.audio = true;
    const id = prefsRef.current.audio ? pickTrack(audio.tracks, prefsRef.current.audio) : undefined;
    if (id !== undefined && id !== audio.current) engine.setAudio(id);
  }, [player.audio]);

  /* ------------------------------ skipping ------------------------------ */

  const skip = (seconds: number) => {
    engineRef.current?.skip(seconds);
    // Quick presses in the same direction add up ("+30s"), so you can see how far you have gone.
    const run = skipRunRef.current;
    const now = Date.now();
    run.total = now - run.at < SKIP_RUN_MS && Math.sign(run.total) === Math.sign(seconds) ? run.total + seconds : seconds;
    run.at = now;
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, text: `${run.total > 0 ? "+" : "−"}${Math.abs(run.total)}s` });
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 900);
    return () => clearTimeout(timer);
  }, [toast]);

  /* ------------------------------ wiring ------------------------------ */

  useEffect(() => {
    const video = videoRef.current!;
    const engine = new PlayerEngine(
      video,
      (state) => {
        setPlayer(state);
        socketRef.current?.send({ type: "TV_STATE", state });
      },
      () => {
        // onEnded: trigger next episode prompt or instant play
        if (currentMediaRef.current?.series?.next && !upNextDismissedRef.current) {
          setUpNextCountdown((prev) => (prev !== null && prev <= 5 ? prev : 5));
        }
      },
    );
    engineRef.current = engine;

    const socket = connectSocket({
      hello: () => ({ type: "TV_HELLO", deviceId: readStorage(DEVICE_KEY) }),
      onStatus: setConnection,
      onMessage: (message) => {
        switch (message.type) {
          case "TV_WELCOME":
            writeStorage(DEVICE_KEY, message.deviceId);
            setPaired(message.paired);
            setPairing(toPairing(message.pairing));
            socketRef.current?.send({ type: "TV_STATE", state: engine.getState() });
            break;
          case "TV_CODE":
            setPairing(toPairing(message.pairing));
            break;
          case "TV_PAIRED":
            setPaired(true);
            setPairing(null);
            break;
          case "TV_UNPAIRED":
            // The phone forgot this TV (it already told us to STOP): back to showing a fresh code.
            setPaired(false);
            setPairing(toPairing(message.pairing));
            setResolving(false);
            break;
          case "TV_RESOLVING":
            setResolving(message.active);
            break;
          case "TV_CMD": {
            const { command } = message;
            if (command.type === "LOAD") {
              setResolving(false);
              const current = currentMediaRef.current;
              const isSameEpisode = Boolean(
                current?.series &&
                command.media.series &&
                current.series.season === command.media.series.season &&
                current.series.episode === command.media.series.episode
              );
              const isSameStream = current?.stream.url === command.media.stream.url;

              if (isSameEpisode || isSameStream) {
                setCurrentMedia(command.media);
                return;
              }

              setCurrentMedia(command.media);
              setUpNextCountdown(null);
              setUpNextDismissed(false);
              resetApplied();
              void engine.load(command.media.stream.url, command.media.stream.type, command.media.subtitles, command.startAt);
            } else if (command.type === "PLAY") engine.play();
            else if (command.type === "PAUSE") engine.pause();
            else if (command.type === "SEEK") engine.seek(command.time);
            else if (command.type === "SKIP") skip(command.seconds);
            else if (command.type === "STOP") {
              setCurrentMedia(null);
              setUpNextCountdown(null);
              setResolving(false);
              setMenu(null);
              engine.stop();
            } else if (command.type === "SET_QUALITY") engine.setQuality(command.level);
            else if (command.type === "SET_SUBTITLE") chooseSubtitle(command.track);
            else if (command.type === "SET_SPEED") engine.setPlaybackRate(command.rate);
            else if (command.type === "SET_AUDIO") chooseAudio(command.track);
            else if (command.type === "TOGGLE_FULLSCREEN") toggleFullscreen();
            else if (command.type === "NEXT_EPISODE") triggerNextEpisode();
            // Anything the phone does should be visible on the TV for a moment.
            if (command.type !== "LOAD" && command.type !== "STOP") wake();
            break;
          }
        }
      },
    });
    socketRef.current = socket;

    return () => {
      socket.disconnect();
      engine.destroy();
    };
  }, []);

  // Safety net for TV_RESOLVING { active: true } without a matching end.
  useEffect(() => {
    if (!resolving) return;
    const timer = setTimeout(() => setResolving(false), RESOLVING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [resolving]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Up Next Countdown interval
  useEffect(() => {
    if (upNextCountdown === null) return;
    if (upNextCountdown <= 0) {
      triggerNextEpisode();
      return;
    }
    const timer = setTimeout(() => {
      setUpNextCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [upNextCountdown]);

  // Check near end of video (last 15s) to trigger Netflix up next card
  useEffect(() => {
    if (
      player.state === "playing" &&
      player.duration > 30 &&
      player.currentTime >= player.duration - 15 &&
      currentMedia?.series?.next &&
      !upNextDismissed &&
      upNextCountdown === null
    ) {
      setUpNextCountdown(15);
    }
  }, [player.currentTime, player.duration, player.state, currentMedia?.series?.next, upNextDismissed, upNextCountdown]);

  // Ask for a fresh code when the displayed one expires
  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(
      () => socketRef.current?.send({ type: "TV_NEW_CODE" }),
      Math.max(0, pairing.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pairing]);

  /* --------------------------- remote control --------------------------- */

  const togglePlay = () => (player.state === "playing" ? engineRef.current?.pause() : engineRef.current?.play());
  const dismissUpNext = () => {
    setUpNextCountdown(null);
    setUpNextDismissed(true);
  };
  /** Pick an episode from the list: the server looks it up like any link, the TV shows the spinner meanwhile. */
  const playEpisode = (url: string) => {
    setMenu(null);
    setUpNextCountdown(null);
    setUpNextDismissed(false);
    socketRef.current?.send({ type: "TV_PLAY_URL", url });
  };

  // Arrow keys move along the buttons once one has focus; otherwise they seek. OK presses the focused button.
  useEffect(() => {
    if (!unlocked) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const action = actionForKey(event);
      if (!action) return;
      const engine = engineRef.current;
      const overlayWasVisible = visibleRef.current;
      wake();

      if (menu) {
        // The picker owns the keys; OK presses the focused option itself.
        if (action === "back") setMenu(null);
        else if (action === "up" || action === "down" || action === "left" || action === "right") moveInMenu(menuRef.current, action);
        else return;
        event.preventDefault();
        return;
      }

      if (action === "back" && upNextCountdown !== null) {
        dismissUpNext();
        event.preventDefault();
        return;
      }

      if (!engine || player.state === "idle") {
        // Waiting for a video: the only button is Disconnect. Down (or OK) moves onto it, then OK presses it.
        const disconnect = paired && !resolving ? document.querySelector<HTMLElement>(".tv-disconnect") : null;
        if (disconnect && document.activeElement !== disconnect && (action === "down" || action === "select")) {
          disconnect.focus();
          event.preventDefault();
        } else if (disconnect && document.activeElement === disconnect && (action === "up" || action === "back")) {
          disconnect.blur();
          event.preventDefault();
        }
        return;
      }

      const row = controlsRef.current;
      const focused = document.activeElement as HTMLElement | null;
      if (row && focused && row.contains(focused)) {
        const buttons = [...row.querySelectorAll<HTMLElement>("button:not(:disabled)")];
        if (action === "left" || action === "right") {
          const next = buttons[Math.max(0, Math.min(buttons.length - 1, buttons.indexOf(focused) + (action === "right" ? 1 : -1)))];
          next?.focus();
          event.preventDefault();
          return;
        }
        if (action === "up" || action === "back") {
          focused.blur();
          event.preventDefault();
          return;
        }
        if (action === "select") return; // press the focused button
      }

      switch (action) {
        case "select":
        case "playpause":
          if (upNextCountdown !== null) triggerNextEpisode();
          else togglePlay();
          break;
        case "play":
          engine.play();
          break;
        case "pause":
          engine.pause();
          break;
        case "left":
        case "rewind":
          skip(-SKIP_SECONDS);
          break;
        case "right":
        case "forward":
          skip(SKIP_SECONDS);
          break;
        case "down":
          // First press only wakes the overlay; the next one steps onto its buttons.
          if (overlayWasVisible) controlsRef.current?.querySelector<HTMLElement>("button")?.focus();
          break;
        case "next":
          if (currentMedia?.series?.next) triggerNextEpisode();
          break;
        case "captions":
          if (player.subtitles && player.subtitles.tracks.length > 0) {
            const total = player.subtitles.tracks.length;
            chooseSubtitle(player.subtitles.current + 1 >= total ? -1 : player.subtitles.current + 1);
          }
          break;
        case "fullscreen":
          toggleFullscreen();
          break;
        case "stop":
          engine.stop();
          break;
        default: // "up", "back": nothing to do beyond showing the overlay
          break;
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [unlocked, player, upNextCountdown, currentMedia?.series?.next, menu, paired, resolving]);

  /* ------------------------------ render ------------------------------ */

  const showVideo = player.state !== "idle";

  // Series details
  const series = currentMedia?.series;
  const next = series?.next;
  const rawTitle = currentMedia?.title || APP_NAME;
  const mainTitle = series && rawTitle.includes("·") ? rawTitle.split("·")[0]!.trim() : rawTitle;

  return (
    <main
      className="tv"
      data-testid="tv"
      data-state={player.state}
      data-time={player.currentTime.toFixed(1)}
      data-error={player.error ?? ""}
      data-hud={controlsVisible ? "visible" : "hidden"}
      onMouseMove={wake}
      onClick={wake}
    >
      {/* Subtitle size: written out as a plain rule (::cue can't be sized from React, and var() inside ::cue isn't dependable on TV browsers). */}
      <style>{`.tv-video::cue { font-size: ${SUBTITLE_FONT_SIZE[subtitleSize]}; }`}</style>

      <video
        ref={videoRef}
        className="tv-video"
        preload="auto"
        style={{ display: showVideo ? "block" : "none" }}
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
      />

      {!unlocked && <TvLocked onUnlock={() => setUnlocked(true)} />}

      {unlocked && !showVideo && (
        <TvIdle
          paired={paired}
          pairing={pairing}
          resolving={resolving}
          onDisconnect={() => socketRef.current?.send({ type: "TV_UNPAIR" })}
        />
      )}

      {unlocked && showVideo && (
        <Hud
          visible={controlsVisible}
          player={player}
          title={mainTitle}
          subTitle={series ? `Season ${series.season}, Episode ${series.episode}` : ""}
          badge={series ? `S${series.season}:E${series.episode}` : ""}
          clock={clock}
          nextLabel={next ? next.title || `S${next.season}:E${next.episode}` : null}
          episodeCount={series?.episodes?.length ?? 0}
          resolving={resolving}
          toast={toast}
          upNext={
            upNextCountdown !== null && next
              ? {
                  seconds: upNextCountdown,
                  label: next.title || `Season ${next.season}, Episode ${next.episode}`,
                }
              : null
          }
          controlsRef={controlsRef}
          onToggle={togglePlay}
          onSkip={skip}
          onSeekTo={(time) => engineRef.current?.seek(time)}
          onNext={triggerNextEpisode}
          onDismissUpNext={dismissUpNext}
          onOpenMenu={setMenu}
          onFullscreen={toggleFullscreen}
          onStop={() => engineRef.current?.stop()}
        />
      )}

      {unlocked && showVideo && menu && (
        <TvMenu
          kind={menu}
          player={player}
          series={series}
          subtitleSize={subtitleSize}
          rootRef={menuRef}
          onClose={() => setMenu(null)}
          onSubtitle={chooseSubtitle}
          onAudio={chooseAudio}
          onSpeed={(rate) => engineRef.current?.setPlaybackRate(rate)}
          onQuality={(level) => engineRef.current?.setQuality(level)}
          onSize={chooseSize}
          onEpisode={playEpisode}
        />
      )}

      {unlocked && connection !== "open" && (
        <div className="tv-banner" data-testid="tv-banner">
          {connection === "replaced"
            ? "This TV page was opened in another window."
            : connection === "connecting"
              ? "Connecting…"
              : "Reconnecting…"}
        </div>
      )}
    </main>
  );
}

function toPairing(info: { code: string; expiresInMs: number } | null): Pairing | null {
  return info ? { code: info.code, expiresAt: Date.now() + info.expiresInMs } : null;
}
