import { useEffect, useRef, useState } from "react";
import {
  describeChange,
  episodeLabel,
  IDLE_STATE,
  parseWatched,
  previousEpisode,
  recordWatching,
  resolveCaptionStyle,
  serializeWatched,
  seriesKeyOf,
  sourcesOf,
  stateIsFor,
  type CaptionStyle,
  type NormalizedMedia,
  type PlayerState,
} from "../../shared";
import { formatClock, readStorage, writeStorage } from "../shared/format";
import { FullscreenIcon } from "../shared/icons";
import { APP_NAME } from "../shared/Logo";
import { connectSocket, type Socket, type SocketStatus } from "../shared/socket";
import { Captions } from "./Captions";
import { PlayerEngine } from "./engine";
import { Hud } from "./Hud";
import { TvIdle, TvLocked, type Pairing } from "./Idle";
import { TvBrowse } from "./Browse";
import { actionForKey, SKIP_SECONDS } from "./keys";
import { moveInMenu, TvMenu, type MenuKind } from "./Menu";
import { syncStep } from "./sync";
import {
  describeTrack,
  parsePrefs,
  pickTrack,
  PREFS_KEY,
  serializePrefs,
  type Prefs,
} from "./prefs";
import { useWakeLock } from "./useWakeLock";
import "./tv.css";

const DEVICE_KEY = "tv.deviceId";
const WATCHED_KEY = "tv.watched";
/** The overlay fades out this long after the last key press, but only while a video is actually playing. */
const HUD_HIDE_MS = 2500;
/** A lookup that never reports back (lost message, dead server) must not leave the TV spinning forever. */
const RESOLVING_TIMEOUT_MS = 45_000;
/** The video follows the end of a lookup straight away; if none has by then, the lookup failed. */
const NO_VIDEO_AFTER_LOOKUP_MS = 1500;
/** Skips pressed within this long of each other count as one run in the "+30s" flash. */
const SKIP_RUN_MS = 1200;

export function Tv() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [unlocked, setUnlocked] = useState(false);
  /** Shown when the phone asked for full screen but the browser wants a press on the TV itself. */
  const [fsPrompt, setFsPrompt] = useState(false);
  const [connection, setConnection] = useState<SocketStatus>("connecting");
  const [paired, setPaired] = useState(false);
  /** The name of the TV this one watches along with. Such a TV plays what that one plays and has no controls of its own. */
  const [following, setFollowing] = useState<string | null>(null);
  const followingRef = useRef<string | null>(null);
  followingRef.current = following;
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [player, setPlayer] = useState<PlayerState>(IDLE_STATE);
  const [currentMedia, setCurrentMedia] = useState<NormalizedMedia | null>(null);
  const [resolving, setResolving] = useState(false);
  /** A lookup is under way (or has just ended), so its end with no video after it means it failed. */
  const wasResolvingRef = useRef(false);

  // Netflix Up Next Countdown & Preload State
  const [upNextCountdown, setUpNextCountdown] = useState<number | null>(null);
  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const preloadedNextMediaRef = useRef<NormalizedMedia | null>(null);

  // Audio / subtitles / speed / quality / episodes picker
  const [menu, setMenu] = useState<MenuKind | null>(null);
  const [browsing, setBrowsing] = useState(false);
  /** Playback began from the library, so ending it (or Back) goes back there instead of to the start screen. */
  const fromBrowseRef = useRef(false);
  /** Said on the start screens when a title that was just chosen would not play. */
  const [notice, setNotice] = useState<string | null>(null);

  // How the viewer likes to watch (subtitle language, audio language, text size), remembered on this TV.
  const [initialPrefs] = useState(() => parsePrefs(readStorage(PREFS_KEY)));
  const prefsRef = useRef<Prefs>(initialPrefs);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(() => resolveCaptionStyle(initialPrefs.captionStyle));
  const captionStyleRef = useRef(captionStyle);
  captionStyleRef.current = captionStyle;
  const [subtitleDelay, setSubtitleDelay] = useState<number>(() => initialPrefs.subtitleDelay ?? 0);
  const subtitleDelayRef = useRef(subtitleDelay);
  subtitleDelayRef.current = subtitleDelay;
  /** Sends the TV's current state to the phone again (set once the player exists). */
  const republishRef = useRef<() => void>(() => {});
  // Whether the remembered choice has been applied to the video that is loaded now (once per video).
  const appliedRef = useRef({ subtitles: false, audio: false });
  const playerRef = useRef<PlayerState>(IDLE_STATE);

  // Which episodes were watched, for the episode list.
  const [watched, setWatched] = useState(() => parseWatched(readStorage(WATCHED_KEY)));
  useEffect(() => {
    writeStorage(WATCHED_KEY, serializeWatched(watched));
  }, [watched]);
  useEffect(() => {
    if (!currentMedia || (player.state !== "playing" && player.state !== "paused") || player.buffering || !stateIsFor(currentMedia, player)) return;
    setWatched((list) => recordWatching(list, currentMedia, player, Date.now()));
  }, [player, currentMedia]);

  // Brief "+10s" flash after a skip, from the remote or the phone
  const [toast, setToast] = useState<{ id: number; text: string; notice?: boolean } | null>(null);
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
    if (!nextUrl || following) {
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
  }, [currentMedia?.series?.next?.url, following]);

  const currentMediaRef = useRef<NormalizedMedia | null>(null);
  currentMediaRef.current = currentMedia;
  playerRef.current = player;
  const upNextDismissedRef = useRef(false);
  upNextDismissedRef.current = upNextDismissed;

  /* ------------------------------ sources ------------------------------ */

  // Which of the video's sources is playing, and which have been tried since the last pick (a failing one is skipped).
  const [sourceIndex, setSourceIndex] = useState(0);
  const sourceIndexRef = useRef(0);
  const triedSourcesRef = useRef(new Set([0]));
  const resetSources = () => {
    sourceIndexRef.current = 0;
    triedSourcesRef.current = new Set([0]);
    setSourceIndex(0);
  };
  /** Play the video from one of its sources, carrying on from where it was. `manual`: someone picked it, so the others are fair game again. */
  const loadSource = (index: number, manual: boolean) => {
    const media = currentMediaRef.current;
    const source = media ? sourcesOf(media)[index] : undefined;
    if (!media || !source || (manual && index === sourceIndexRef.current)) return;
    const at = playerRef.current.currentTime;
    triedSourcesRef.current = manual ? new Set([index]) : triedSourcesRef.current.add(index);
    sourceIndexRef.current = index;
    setSourceIndex(index);
    resetApplied();
    void engineRef.current?.load(source.stream.url, source.stream.type, source.subtitles, at > 5 ? at : undefined);
    engineRef.current?.play();
  };

  // A source that fails hands over to the next one that hasn't been tried, so the first one that works plays.
  useEffect(() => {
    if (player.state !== "error") return;
    const media = currentMediaRef.current;
    if (!media) return;
    const sources = sourcesOf(media);
    const next = sources.findIndex((_, index) => !triedSourcesRef.current.has(index));
    if (next === -1) return;
    notify(`${sources[sourceIndexRef.current]?.label ?? "That source"} didn't work. Trying ${sources[next]!.label}…`);
    loadSource(next, false);
  }, [player.state]);

  const triggerNextEpisode = () => {
    if (followingRef.current) return; // the TV being followed picks what comes next
    setUpNextCountdown(null);
    setUpNextDismissed(false);
    const preloaded = preloadedNextMediaRef.current;
    const nextUrl = currentMediaRef.current?.series?.next?.url;

    if (preloaded && nextUrl) {
      setCurrentMedia(preloaded);
      resetApplied();
      resetSources();
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
  /** From the TV's menu or the phone's style sheet: change some of the caption look, keep the rest, remember it. */
  const changeCaptions = (changes: Partial<CaptionStyle>) => {
    const next = resolveCaptionStyle({ ...captionStyleRef.current, ...changes });
    captionStyleRef.current = next;
    setCaptionStyle(next);
    remember({ captionStyle: next });
  };
  const chooseSubtitleDelay = (delay: number) => {
    const clamped = Math.max(-60, Math.min(60, Math.round(delay * 10) / 10));
    subtitleDelayRef.current = clamped;
    setSubtitleDelay(clamped);
    remember({ subtitleDelay: clamped });
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, text: `Subtitle delay: ${clamped > 0 ? "+" : ""}${clamped.toFixed(1)}s` });
  };
  useEffect(() => republishRef.current(), [captionStyle, subtitleDelay]); // the phone's sheet shows what the TV really uses
  const streamUrl = currentMedia?.stream.url;
  useEffect(() => republishRef.current(), [streamUrl, sourceIndex]); // a state names its media and source, and those can change without the video doing so

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
    const timer = setTimeout(() => setToast(null), toast.notice ? 1800 : 900);
    return () => clearTimeout(timer);
  }, [toast]);

  /** Say something on screen for a moment. */
  const notify = (text: string) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, text, notice: true });
  };

  // A new speed, subtitle, audio track or quality is said on screen, whether it came from the menu, a key or the phone.
  const lastPlayerRef = useRef<PlayerState>(IDLE_STATE);
  useEffect(() => {
    const change = describeChange(lastPlayerRef.current, player);
    lastPlayerRef.current = player;
    if (change && !followingRef.current) notify(change); // a follower is nudged in speed all the time; that is not news
  }, [player]);

  /* ------------------------------ wiring ------------------------------ */

  useEffect(() => {
    const video = videoRef.current!;
    const publish = (state: PlayerState) => {
      const full = withTvState(state, captionStyleRef.current, currentMediaRef.current, sourceIndexRef.current, subtitleDelayRef.current);
      setPlayer(full);
      if (!followingRef.current) socketRef.current?.send({ type: "TV_STATE", state: full }); // a follower has no phone to tell
    };
    // The leader's last position was this long ago (see TV_SYNC); a jump too soon after another would only chase a picture still filling.
    let lastSeekAt = 0;
    const engine = new PlayerEngine(
      video,
      publish,
      () => {
        // onEnded: trigger next episode prompt or instant play
        if (!followingRef.current && currentMediaRef.current?.series?.next && !upNextDismissedRef.current) {
          setUpNextCountdown((prev) => (prev !== null && prev <= 5 ? prev : 5));
        }
      },
    );
    engineRef.current = engine;
    republishRef.current = () => publish(engine.getState());

    const socket = connectSocket({
      hello: () => ({ type: "TV_HELLO", deviceId: readStorage(DEVICE_KEY) }),
      onStatus: setConnection,
      onMessage: (message) => {
        switch (message.type) {
          case "TV_WELCOME":
            writeStorage(DEVICE_KEY, message.deviceId);
            setPaired(message.paired);
            setFollowing(message.following ?? null);
            setPairing(toPairing(message.pairing));
            if (!message.following) {
              socketRef.current?.send({ type: "TV_STATE", state: withTvState(engine.getState(), captionStyleRef.current, currentMediaRef.current, sourceIndexRef.current, subtitleDelayRef.current) });
            }
            break;
          case "TV_CODE":
            setPairing(toPairing(message.pairing));
            break;
          case "TV_PAIRED":
            setPaired(true);
            setPairing(null);
            break;
          case "TV_FOLLOWING":
            // Another TV's phone picked this one to watch along: no code to show now, and the video comes from that TV.
            setPaired(true);
            setPairing(null);
            setFollowing(message.leader);
            break;
          case "TV_SYNC": {
            const media = currentMediaRef.current;
            if (!media || (message.stream && message.stream !== media.stream.url)) break; // not the same video (yet)
            const local = engine.getState();
            if (local.state !== "playing" && local.state !== "paused") break;
            const rate = local.playbackRate ?? 1;
            const step = syncStep(
              { playing: message.playing, time: message.time, rate: message.rate },
              { playing: local.state === "playing", time: local.currentTime, rate, buffering: Boolean(local.buffering) },
              Date.now() - lastSeekAt,
            );
            if (step.seek !== undefined) {
              engine.seek(step.seek);
              lastSeekAt = Date.now();
            }
            if (Math.abs(step.rate - rate) > 0.001) engine.setPlaybackRate(step.rate);
            if (step.play !== (local.state === "playing")) {
              if (step.play) engine.play();
              else engine.pause();
            }
            break;
          }
          case "TV_UNPAIRED":
            // The phone forgot this TV (it already told us to STOP), or the party ended: back to showing a fresh code.
            setPaired(false);
            setFollowing(null);
            setPairing(toPairing(message.pairing));
            wasResolvingRef.current = false; // a lookup cut short by this is not a failed one
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
              resetSources();
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
            else if (command.type === "SET_SUBTITLE_DELAY") chooseSubtitleDelay(command.delay);
            else if (command.type === "SET_CAPTION_STYLE") changeCaptions(command.style);
            else if (command.type === "SET_SPEED") engine.setPlaybackRate(command.rate);
            else if (command.type === "SET_AUDIO") chooseAudio(command.track);
            else if (command.type === "SET_SOURCE") loadSource(command.index, true);
            else if (command.type === "TOGGLE_FULLSCREEN") fullscreenFromPhone();
            else if (command.type === "NEXT_EPISODE") triggerNextEpisode();
            // Anything the phone does should be visible on the TV for a moment.
            if (command.type !== "LOAD" && command.type !== "STOP") wake();
            break;
          }
        }
      },
    });
    socketRef.current = socket;

    // The phone shows whether the TV is full screen, so tell it whenever that changes (Esc, the HUD button, the OK prompt).
    const onFullscreenChange = () => {
      republishRef.current();
      if (document.fullscreenElement) setFsPrompt(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
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

  // The server only tells a phone when a lookup fails; here the end of the lookup with no video following it is the tell.
  useEffect(() => {
    if (resolving) {
      wasResolvingRef.current = true;
      setNotice(null);
      return;
    }
    if (!wasResolvingRef.current) return;
    wasResolvingRef.current = false;
    const timer = setTimeout(() => {
      if (currentMediaRef.current) return;
      setNotice("That one wouldn't play. Try another.");
      if (fromBrowseRef.current) {
        fromBrowseRef.current = false;
        setBrowsing(true);
      }
    }, NO_VIDEO_AFTER_LOOKUP_MS);
    return () => clearTimeout(timer);
  }, [resolving]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Back at the library once what was chosen from it has stopped.
  const showedVideoRef = useRef(false);
  useEffect(() => {
    const showing = player.state !== "idle";
    if (showedVideoRef.current && !showing && fromBrowseRef.current) {
      fromBrowseRef.current = false;
      setBrowsing(true);
    }
    showedVideoRef.current = showing;
  }, [player.state]);

  const enterFullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {});
  /** From the TV's own remote or mouse, which the browser accepts as the press it needs. */
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) void enterFullscreen();
    else document.exitFullscreen().catch(() => {});
  };
  /**
   * From the phone. Leaving is always allowed; going in is refused unless the TV page just got a click or key press,
   * so then the TV asks for one (OK on its remote) instead of failing without a word.
   */
  const fullscreenFromPhone = () => {
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
    document.documentElement.requestFullscreen?.().catch(() => setFsPrompt(true));
  };
  const acceptFullscreenPrompt = () => {
    setFsPrompt(false);
    void enterFullscreen();
  };
  useEffect(() => {
    if (!fsPrompt) return;
    const timer = setTimeout(() => setFsPrompt(false), 12_000);
    return () => clearTimeout(timer);
  }, [fsPrompt]);

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
      !following &&
      !upNextDismissed &&
      upNextCountdown === null
    ) {
      setUpNextCountdown(15);
    }
  }, [player.currentTime, player.duration, player.state, currentMedia?.series?.next, following, upNextDismissed, upNextCountdown]);

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
  const playEpisode = (url: string, fromLibrary = false) => {
    if (fromLibrary) fromBrowseRef.current = true;
    setMenu(null);
    setBrowsing(false);
    setUpNextCountdown(null);
    setUpNextDismissed(false);
    socketRef.current?.send({ type: "TV_PLAY_URL", url });
  };
  /** A TV that watches along stops, and goes back to its own pairing screen. */
  const leaveParty = () => {
    engineRef.current?.stop();
    setCurrentMedia(null);
    socketRef.current?.send({ type: "TV_UNPAIR" });
  };
  const goToPrevious = () => {
    const previous = previousEpisode(currentMediaRef.current?.series);
    if (previous) playEpisode(previous.url);
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

      if (browsing) return; // the library walks and closes itself (Browse.tsx)

      if (action === "browse") {
        if (!following && !resolving && player.state === "idle") setBrowsing(true);
        event.preventDefault();
        return;
      }

      if (fsPrompt && (action === "select" || action === "back")) {
        if (action === "select") acceptFullscreenPrompt();
        else setFsPrompt(false);
        event.preventDefault();
        return;
      }

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

      // Waiting for a video: the start screen walks its own buttons (see Idle.tsx).
      if (!engine || player.state === "idle") return;

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

      if (following) {
        // Watching along: no playback keys, just the way out (Down, then OK) and full screen.
        if (action === "down" && overlayWasVisible) controlsRef.current?.querySelector<HTMLElement>("button")?.focus();
        else if (action === "fullscreen") toggleFullscreen();
        event.preventDefault();
        return;
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
        case "previous":
          goToPrevious();
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
        case "back":
          // What was picked in the library goes back to it: the first Back shows the controls, a second one leaves.
          if (fromBrowseRef.current && overlayWasVisible) {
            setCurrentMedia(null);
            engine.stop();
          }
          break;
        default: // "up": nothing to do beyond showing the overlay
          break;
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [unlocked, player, upNextCountdown, currentMedia?.series?.next, menu, paired, resolving, fsPrompt, following, browsing]);

  /* ------------------------------ render ------------------------------ */

  const showVideo = player.state !== "idle";

  // Series details
  const series = currentMedia?.series;
  const next = series?.next;
  const previous = previousEpisode(series);
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
      <video
        ref={videoRef}
        className="tv-video"
        preload="auto"
        style={{ display: showVideo ? "block" : "none" }}
        playsInline
        onClick={following ? undefined : togglePlay}
        onDoubleClick={toggleFullscreen}
      />

      {showVideo && menu !== "captions" && <Captions videoRef={videoRef} style={captionStyle} delay={subtitleDelay} />}

      {/* Pressing OK here is also the press the browser needs to let the page go full screen. */}
      {!unlocked && (
        <TvLocked
          onUnlock={() => {
            void enterFullscreen();
            setUnlocked(true);
          }}
        />
      )}

      {unlocked && !showVideo && !browsing && (
        <TvIdle
          paired={paired}
          following={following}
          pairing={pairing}
          resolving={resolving}
          onDisconnect={() => socketRef.current?.send({ type: "TV_UNPAIR" })}
          onBrowse={following ? undefined : () => setBrowsing(true)}
          notice={notice}
        />
      )}

      {unlocked && browsing && !following && (
        <TvBrowse
          onPlay={(url) => playEpisode(url, true)}
          onClose={() => setBrowsing(false)}
          notice={notice}
        />
      )}

      {unlocked && showVideo && following && (
        <div className="tv-follow-bar" data-testid="tv-follow-bar" ref={controlsRef}>
          <span>Watching along with {following}</span>
          <button className="tv-leave" onClick={leaveParty} data-testid="tv-leave">
            Leave
          </button>
        </div>
      )}

      {unlocked && showVideo && !following && (
        <Hud
          visible={controlsVisible && menu !== "captions"}
          player={player}
          title={mainTitle}
          subTitle={series ? `Season ${series.season}, Episode ${series.episode}` : ""}
          badge={series ? `S${series.season}:E${series.episode}` : ""}
          clock={clock}
          nextLabel={next ? episodeLabel(next) : null}
          prevLabel={previous ? episodeLabel(previous) : null}
          sourceLabel={player.sources ? (player.sources.labels[player.sources.current] ?? null) : null}
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
          onPrevious={goToPrevious}
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
          show={currentMedia ? seriesKeyOf(currentMedia) : undefined}
          watched={watched}
          captionStyle={captionStyle}
          subtitleDelay={subtitleDelay}
          onSubtitleDelay={chooseSubtitleDelay}
          rootRef={menuRef}
          onClose={() => setMenu(null)}
          onSubtitle={chooseSubtitle}
          onAudio={chooseAudio}
          onSpeed={(rate) => engineRef.current?.setPlaybackRate(rate)}
          onQuality={(level) => engineRef.current?.setQuality(level)}
          onSource={(index) => {
            setMenu(null);
            loadSource(index, true);
          }}
          onCaption={changeCaptions}
          onKind={setMenu}
          onEpisode={playEpisode}
        />
      )}

      {unlocked && fsPrompt && (
        <button className="tv-fs-prompt" data-testid="fs-prompt" onClick={acceptFullscreenPrompt}>
          <FullscreenIcon /> Press OK for full screen
        </button>
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

/** What the TV knows that the video doesn't: which media this is, whether it is full screen, and how subtitles look. */
const withTvState = (state: PlayerState, captionStyle: CaptionStyle, media: NormalizedMedia | null, sourceIndex: number, subtitleDelay: number): PlayerState => ({
  ...state,
  ...(media && state.state !== "idle" ? { stream: media.stream.url } : {}),
  ...(media && state.state !== "idle" && sourcesOf(media).length > 1
    ? { sources: { labels: sourcesOf(media).map((source) => source.label), current: sourceIndex } }
    : {}),
  fullscreen: Boolean(document.fullscreenElement),
  captionStyle,
  subtitleDelay,
});

function toPairing(info: { code: string; expiresInMs: number } | null): Pairing | null {
  return info ? { code: info.code, expiresAt: Date.now() + info.expiresInMs } : null;
}
