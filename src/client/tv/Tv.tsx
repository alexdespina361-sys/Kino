import { useEffect, useMemo, useRef, useState, useLayoutEffect, type CSSProperties, type RefObject } from "react";
import {
  describeChange,
  episodeLabel,
  friendChoices,
  formatDelay,
  groupBySeason,
  IDLE_STATE,
  isSameEpisode,
  playingEpisodeName,
  previousEpisode,
  resolveCaptionStyle,
  seriesKeyOf,
  preferredSourceIndex,
  sourceMenus,
  sourcesOf,
  stateIsFor,
  type CaptionStyle,
  type NormalizedMedia,
  type PartyCommand,
  type PartyView,
  type PlayableSource,
  type PlayerState,
  type SubtitleSyncMode,
} from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { describeError } from "../account/errors";
import { profileStore, useProfileData } from "../account/store";
import { reportWontPlay } from "../feedback/store";
import { friendsApi } from "../friends/api";
import { nameOf } from "../friends/entries";
import { useFriends } from "../friends/FriendsProvider";
import { t, useT } from "../i18n";
import { browserBack, pressAgain, useBackWhile } from "../shared/backButton";
import { useEpisodeDetails } from "../shared/episodeDetails";
import { readStorage, writeStorage } from "../shared/format";
import { readKept, writeKept } from "../shared/kept";
import { canFullscreen as offersFullscreen, enterFullscreen, entersAtFirstPress, toggleFullscreen, useLandscapeWhile } from "../shared/fullscreen";
import { FullscreenIcon, UsersIcon } from "../shared/icons";
import { readPartyCode } from "../shared/launch";
import { useProfileHold } from "../shared/profileHold";
import { APP_NAME } from "../shared/Logo";
import { connectSocket, type Socket, type SocketStatus } from "../shared/socket";
import { friendlyError, noticeText, socketError } from "../shared/words";
import { TvAccount, type AccountView } from "./Account";
import { EdgeScrollHint } from "./EdgeScrollHint";
import { PlayerEngine, PlayerError } from "./engine";
import { useEnhance } from "../enhance/useEnhance";
import { pickInRows } from "./dpad";
import { HOLD_SPEED, isPicture, usePictureGestures, useTouchUi, zoneOf, type PointerKind, type Side } from "./gestures";
import { holdLine, resumeLine, sameHold, type Hold } from "./hold";
import { EndCard, ErrorCard, FollowStatus, Hud, isBlocked, isBusy, UP_NEXT_SECONDS } from "./Hud";
import { TvIdle, TvLocked, TvWelcome, type Pairing } from "./Idle";
import { STARTING_FADE_MS, StartingFilm, startingFrom, UNHEARD_MS, type Starting } from "./Starting";
import { keepPageFor, TvBrowse, type PlayOptions } from "./Browse";
import { actionForKey, partyCommandForKey, SKIP_SECONDS } from "./keys";
import { moveInMenu, pageBefore, TvMenu, type MenuKind } from "./Menu";
import { PartyPage, PartyPanel } from "./Party";
import { nearTheEnd } from "./preloadNext";
import { AUTO_SKIP_SECONDS, FRESH_MS, nextButtonFrom, useSkipSegment, useSkipTimes, type SkipControl } from "./skip";
import { useShown } from "../shared/names";
import { Follower } from "./sync";
import {
  defaultSyncMode,
  describeTrack,
  parsePrefs,
  pickBaseSubtitleTrack,
  pickTrack,
  PREFS_KEY,
  serializePrefs,
  thisDevice,
  type Prefs,
} from "./prefs";
import "./tv.css";
import "../polish/tv.css";
import "../polish/tv-posters.css";
import "../polish/tv-phone.css";
import { captionBottom, captionTextStyle } from "../shared/captionCss";
import { cuesAt, isHeld } from "../subsync/hold";

function CueText({ cue }: { cue: TextTrackCue }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const vtt = cue as Partial<VTTCue>;
    node.replaceChildren(vtt.getCueAsHTML ? vtt.getCueAsHTML() : document.createTextNode(vtt.text ?? ""));
  }, [cue]);
  return <span ref={ref} className="tv-caption-text" />;
}
const isCaptionTrack = (track: TextTrack) => track.kind === "subtitles";
const sameCues = (a: TextTrackCue[], b: TextTrackCue[]) => a.length === b.length && a.every((cue, i) => cue === b[i]);
const cueKeys = new WeakMap<TextTrackCue, number>();
let cueKeyNext = 0;
const cueKey = (cue: TextTrackCue) => {
  let key = cueKeys.get(cue);
  if (key === undefined) cueKeys.set(cue, (key = ++cueKeyNext));
  return key;
};
function Captions({ videoRef, style, delay = 0 }: { videoRef: RefObject<HTMLVideoElement | null>; style: CaptionStyle; delay?: number }) {
  const [cues, setCues] = useState<TextTrackCue[]>([]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const refresh = () => {
      const now = video.currentTime;
      const matchTime = now - delay;
      const active: TextTrackCue[] = [];
      for (const track of Array.from(video.textTracks)) {
        if (track.mode === "disabled" || !isCaptionTrack(track) || isHeld(track) || !track.cues) continue;
        cuesAt(track, track.cues, matchTime, active);
      }
      setCues((current) => (sameCues(current, active) ? current : active));
    };

    const events = ["timeupdate", "seeked", "play", "pause"] as const;
    events.forEach((name) => video.addEventListener(name, refresh));
    video.textTracks.addEventListener("change", refresh);
    video.textTracks.addEventListener("addtrack", refresh);
    video.textTracks.addEventListener("removetrack", refresh);
    const timer = setInterval(refresh, 250);
    refresh();
    return () => {
      events.forEach((name) => video.removeEventListener(name, refresh));
      video.textTracks.removeEventListener("change", refresh);
      video.textTracks.removeEventListener("addtrack", refresh);
      video.textTracks.removeEventListener("removetrack", refresh);
      clearInterval(timer);
    };
  }, [videoRef, delay]);

  return (
    <div className="tv-captions" data-testid="captions" style={{ "--caption-bottom": captionBottom(style) } as CSSProperties}>
      {cues.map((cue) => (
        <div className="tv-caption" data-testid="caption" key={cueKey(cue)} style={captionTextStyle(style)}>
          <CueText cue={cue} />
        </div>
      ))}
    </div>
  );
}

const KEEP_IN_THE_PAGE: Record<string, string> = {
  controlslist: "nodownload nofullscreen noremoteplayback",
  "webkit-playsinline": "",
  "x5-playsinline": "",
  "x5-video-player-type": "h5-page",
  "t7-video-player-type": "inline",
  "x-webkit-airplay": "deny",
};
type WebKitVideo = HTMLVideoElement & { webkitDisplayingFullscreen?: boolean; webkitExitFullscreen?: () => void };
function keepNativePlayerOut(video: HTMLVideoElement): () => void {
  for (const [name, value] of Object.entries(KEEP_IN_THE_PAGE)) video.setAttribute(name, value);
  video.playsInline = true;
  video.disablePictureInPicture = true;
  video.disableRemotePlayback = true;
  video.controls = false;

  const noControls = new MutationObserver(() => {
    if (video.controls) video.controls = false;
  });
  noControls.observe(video, { attributes: true, attributeFilter: ["controls"] });
  const leaveVideoFullscreen = () => {
    if (document.fullscreenElement === video) document.exitFullscreen().catch(() => {});
    const legacy = video as WebKitVideo;
    if (legacy.webkitDisplayingFullscreen) legacy.webkitExitFullscreen?.();
  };
  const noMenu = (event: Event) => event.preventDefault();
  video.addEventListener("webkitbeginfullscreen", leaveVideoFullscreen);
  video.addEventListener("contextmenu", noMenu);
  document.addEventListener("fullscreenchange", leaveVideoFullscreen);

  return () => {
    noControls.disconnect();
    video.removeEventListener("webkitbeginfullscreen", leaveVideoFullscreen);
    video.removeEventListener("contextmenu", noMenu);
    document.removeEventListener("fullscreenchange", leaveVideoFullscreen);
  };
}

function pressWhatOkPresses(): () => void {
  let down: KeyboardEvent | null = null;
  const onDown = (event: KeyboardEvent) => {
    const target = event.target;
    down = !event.repeat && actionForKey(event) === "select" && target instanceof HTMLElement && target.matches("button, a[href]") ? event : null;
  };
  const onTyped = () => {
    down = null;
  };
  const onUp = () => {
    const pressed = down;
    down = null;
    const target = pressed?.target;
    if (!pressed || pressed.defaultPrevented || !(target instanceof HTMLElement)) return;
    if (target.isConnected && document.activeElement === target) target.click();
  };
  window.addEventListener("keydown", onDown, true);
  window.addEventListener("keypress", onTyped, true);
  window.addEventListener("keyup", onUp, true);
  return () => {
    window.removeEventListener("keydown", onDown, true);
    window.removeEventListener("keypress", onTyped, true);
    window.removeEventListener("keyup", onUp, true);
  };
}

function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const granted = await navigator.wakeLock.request("screen");
        if (cancelled) void granted.release();
        else lock = granted;
      } catch {
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!lock || lock.released)) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

const SLOW_AFTER_MS = 10_000;
function useSlow(waiting: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!waiting) return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  return slow;
}

const DEVICE_KEY = "tv.deviceId";
const HUD_HIDE_MS = 2500;
const HUD_HOLD_MS = 5000;
const RESOLVING_TIMEOUT_MS = 45_000;
const NO_VIDEO_AFTER_LOOKUP_MS = 1500;
const LOOKUP_END_GRACE_MS = 250;
const SKIP_RUN_MS = 1200;
const PUT_AWAY_QUIET_MS = 600;

const menuBack = (menu: MenuKind | "party" | "partyInvite"): MenuKind | "party" | null =>
  menu === "partyInvite" ? "party" : menu === "party" ? null : pageBefore(menu);

export function Tv() {
  useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [linkCode] = useState(() => readPartyCode(location.search));
  const [unlocked, setUnlocked] = useState(!linkCode);
  const [welcoming, setWelcoming] = useState(!linkCode);
  const [asksToEnter] = useState(() => !linkCode && entersAtFirstPress());
  const [fsPrompt, setFsPrompt] = useState(false);
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const [muted, setMuted] = useState(false);
  const [connection, setConnection] = useState<SocketStatus>("connecting");
  const [paired, setPaired] = useState(false);
  const pairedRef = useRef(false);
  pairedRef.current = paired;
  const [following, setFollowing] = useState<string | null>(null);
  const followingRef = useRef<string | null>(null);
  followingRef.current = following;
  const [party, setParty] = useState<PartyView | null>(null);
  const partyRef = useRef<PartyView | null>(null);
  partyRef.current = party;
  const [hold, setHold] = useState<Hold | null>(null);
  const holdRef = useRef<Hold | null>(null);
  const [catchingUp, setCatchingUp] = useState(false);
  const admin = party?.role === "guest" && party.guests.some((guest) => guest.id === party.you && guest.admin === true);
  const [partyEnds, setPartyEnds] = useState<number | null>(null);
  const [partyError, setPartyError] = useState<{ id: number; text: string } | null>(null);
  const [partyJoinWith, setPartyJoinWith] = useState<string | null>(null);
  const invitedWithRef = useRef<string | null>(null);
  const [together, setTogether] = useState<string | null>(null);
  const leavingRef = useRef(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [control, setControl] = useState<Pairing | null>(null);
  const [player, setPlayer] = useState<PlayerState>(IDLE_STATE);
  const [currentMedia, setCurrentMedia] = useState<NormalizedMedia | null>(null);
  const [resolving, setResolving] = useState(false);
  const wasResolvingRef = useRef(false);
  const lookupEndTimerRef = useRef(0);
  const mediaBeforeLookupRef = useRef<NormalizedMedia | null>(null);
  const putOnAtOnceRef = useRef<NormalizedMedia | null>(null);
  const stuck = useSlow(isBusy(player, resolving));
  const [starting, setStartingNow] = useState<Starting | null>(null);
  const startingRef = useRef<Starting | null>(null);
  const setStarting = (next: Starting | null | ((before: Starting | null) => Starting | null)) => {
    const value = typeof next === "function" ? next(startingRef.current) : next;
    startingRef.current = value;
    setStartingNow(value);
  };
  const away = useSlow(connection === "connecting" || connection === "reconnecting");

  const [upNextCountdown, setUpNextCountdown] = useState<number | null>(null);
  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const [upNextHeld, setUpNextHeld] = useState(false);
  const [upNextTotal, setUpNextTotal] = useState(UP_NEXT_SECONDS);
  const [upNextFresh, setUpNextFresh] = useState(false);
  useEffect(() => {
    if (!upNextFresh) return;
    const timer = setTimeout(() => setUpNextFresh(false), FRESH_MS);
    return () => clearTimeout(timer);
  }, [upNextFresh]);
  const clearUpNext = () => {
    setUpNextCountdown(null);
    setUpNextHeld(false);
    setUpNextFresh(false);
  };
  const preloadedNextMediaRef = useRef<NormalizedMedia | null>(null);
  const [ended, setEnded] = useState(false);

  const [menu, setMenu] = useState<MenuKind | "party" | "partyInvite" | null>(null);
  const lookMenu = menu === "captions" || menu === "captionsMore";
  const openerRef = useRef<HTMLElement | null>(null);
  const openMenu = (kind: MenuKind | "party") => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && controlsRef.current?.contains(focused)) openerRef.current = focused;
    setMenu(kind);
  };
  const [screen, setScreen] = useState<"library" | "connect" | "party">("library");
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const [notice, setNotice] = useState<string | null>(null);
  const [leftParty, setLeftParty] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: number; text: string } | null>(null);
  const flashIdRef = useRef(0);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 4500);
    return () => clearTimeout(timer);
  }, [flash]);

  const [initialPrefs] = useState(() => parsePrefs(readStorage(PREFS_KEY)));
  const prefsRef = useRef<Prefs>(initialPrefs);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(() => resolveCaptionStyle(initialPrefs.captionStyle));
  const captionStyleRef = useRef(captionStyle);
  captionStyleRef.current = captionStyle;
  const [subtitleDelay, setSubtitleDelay] = useState<number>(() => initialPrefs.subtitleDelay ?? 0);
  const subtitleDelayRef = useRef(subtitleDelay);
  subtitleDelayRef.current = subtitleDelay;
  const subtitleSyncRef = useRef<boolean>(initialPrefs.subtitleSync ?? false);
  const subtitleSyncModeRef = useRef<SubtitleSyncMode>(initialPrefs.subtitleSyncMode ?? defaultSyncMode(thisDevice()));
  const republishRef = useRef<() => void>(() => {});
  const enhanceRef = useRef<PlayerState["enhance"]>(undefined);
  const appliedRef = useRef({ subtitles: false, audio: false });
  const playerRef = useRef<PlayerState>(IDLE_STATE);

  const account = useAccount();
  const syncNowRef = useRef(account.syncNow);
  syncNowRef.current = account.syncNow;
  const friends = useFriends();
  const friendsRef = useRef(friends);
  friendsRef.current = friends;
  const [accountView, setAccountView] = useState<AccountView | null>(null);
  const choosing = account.status === "ready" && account.choosing;
  const settingUp = account.status === "ready" && !choosing && Boolean(account.profile?.setup);
  const accountPage: AccountView | null = player.state === "idle" ? (choosing ? "profiles" : settingUp ? "setup" : accountView) : null;

  const { watched, settings } = useProfileData();
  const autoplay = settings.autoplayNext ?? true;
  const tapToPause = settings.tapToPause ?? false;
  const adaptiveQuality = settings.adaptiveQuality ?? true;
  const child = settings.child === true;
  const childRef = useRef(child);
  childRef.current = child;
  const holding = useProfileHold();
  useEffect(() => {
    if (following || !currentMedia || (player.state !== "playing" && player.state !== "paused") || player.buffering || !stateIsFor(currentMedia, player)) return;
    profileStore.playbackAt(currentMedia, player);
  }, [player, currentMedia, following]);

  const [toast, setToast] = useState<{ id: number; text: string; notice?: boolean; side?: "back" | "forward" } | null>(null);
  const toastIdRef = useRef(0);
  const skipRunRef = useRef({ total: 0, at: 0 });

  useWakeLock(unlocked);

  const currentMediaRef = useRef<NormalizedMedia | null>(null);
  currentMediaRef.current = currentMedia;
  const putMedia = (media: NormalizedMedia | null) => {
    currentMediaRef.current = media;
    setCurrentMedia(media);
  };
  playerRef.current = player;
  const upNextDismissedRef = useRef(false);
  upNextDismissedRef.current = upNextDismissed;
  const endingRef = useRef<Ending>({ ended: false });

  const [sourceIndex, setSourceIndex] = useState(0);
  const sourceIndexRef = useRef(0);
  const triedSourcesRef = useRef(new Set([0]));
  const resetSources = (initialIndex = 0) => {
    sourceIndexRef.current = initialIndex;
    triedSourcesRef.current = new Set([initialIndex]);
    setSourceIndex(initialIndex);
  };
  const loadSource = (index: number, manual: boolean) => {
    const media = currentMediaRef.current;
    const source = media ? sourcesOf(media)[index] : undefined;
    const engine = engineRef.current;
    if (!media || !source || (manual && index === sourceIndexRef.current)) return;
    const at = engine?.resumePoint() ?? playerRef.current.currentTime;
    const play = manual || (engine?.wantsPlay() ?? true);
    triedSourcesRef.current = manual ? new Set([index]) : triedSourcesRef.current.add(index);
    sourceIndexRef.current = index;
    setSourceIndex(index);
    resetApplied();
    void engine?.load(source.stream.url, source.stream.type, source.subtitles, at > 5 ? at : undefined, source.stream.directUrl);
    if (play) engine?.play();
  };

  useEffect(() => {
    const media = currentMediaRef.current;
    if (!media) return;
    const targetIdx = preferredSourceIndex(media, settings.animeAudio);
    if (targetIdx !== undefined && targetIdx !== sourceIndexRef.current) {
      loadSource(targetIdx, true);
    }
  }, [settings.animeAudio]);

  useEffect(() => {
    if (player.state !== "error") return;
    const media = currentMediaRef.current;
    if (!media) return;
    const sources = sourcesOf(media);
    const next = sources.findIndex((_, index) => !triedSourcesRef.current.has(index));
    if (next === -1) return;
    const failed = sources[sourceIndexRef.current];
    notify(t("notice.sourceFailed", { from: failed ? nameIn(sources, sourceIndexRef.current) : t("notice.thatSource"), to: nameIn(sources, next) }));
    loadSource(next, false);
  }, [player.state]);

  useEffect(() => {
    if (player.state !== "loading") return;
    const media = currentMediaRef.current;
    if (!media) return;
    const sources = sourcesOf(media);
    const next = sources.findIndex((_, index) => !triedSourcesRef.current.has(index));
    if (next === -1) return;

    const timer = window.setTimeout(() => {
      const curr = playerRef.current.state;
      if (curr === "loading") {
        const failed = sources[sourceIndexRef.current];
        notify(t("notice.sourceFailed", { from: failed ? nameIn(sources, sourceIndexRef.current) : t("notice.thatSource"), to: nameIn(sources, next) }));
        loadSource(next, false);
      }
    }, 45_000);

    return () => window.clearTimeout(timer);
  }, [player.state]);

  const autoSkip = settings.autoSkip ?? false;
  const skips = useSkipTimes(currentMedia, player.duration, sourceIndex, !following);
  const hasNext = Boolean(currentMedia?.series?.next);
  const nextFrom = nextButtonFrom(skips, player.duration, UP_NEXT_SECONDS);
  const nextFromRef = useRef(nextFrom);
  nextFromRef.current = nextFrom;

  const nextEpisodeUrl = currentMedia?.series?.next?.url;
  const nearEnd = nearTheEnd(player.currentTime, player.duration) || (player.duration > 30 && player.currentTime >= nextFrom - 30);
  useEffect(() => {
    const nextUrl = nextEpisodeUrl;
    if (!nextUrl || following || !nearEnd) {
      preloadedNextMediaRef.current = null;
      return;
    }

    let active = true;
    preloadedNextMediaRef.current = null;

    fetch(`/api/resolve?url=${encodeURIComponent(nextUrl)}`)
      .then((res) => res.json())
      .then(async (data: { status: string; media?: NormalizedMedia }) => {
        if (!active || data.status !== "success" || !data.media) return;
        preloadedNextMediaRef.current = data.media;
        if (data.media.stream.type !== "hls") return;

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
              fetch(firstSegmentUrl).catch(() => {});
            }
          }
        } catch {
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [nextEpisodeUrl, following, nearEnd]);

  const skipper = useSkipSegment({
    video: currentMedia ? `${currentMedia.stream.url}#${sourceIndex}` : undefined,
    skips,
    time: player.currentTime,
    duration: player.duration,
    playing: player.state === "playing" && !player.buffering,
    hasNext,
    enabled: !following && currentMedia !== null && (player.state === "playing" || player.state === "paused") && stateIsFor(currentMedia, player) && upNextCountdown === null,
    autoSkip,
    onSkipTo: (time) => engineRef.current?.seek(time),
  });
  const skipRef = useRef<SkipControl>(skipper);
  skipRef.current = skipper;
  const upNextOwnsKeys = upNextCountdown !== null && (!upNextHeld || upNextFresh);
  const upNextSeconds = upNextCountdown !== null && autoplay && !upNextHeld ? upNextCountdown : null;
  endingRef.current = {
    ended,
    upNext: following || upNextCountdown === null ? undefined : { seconds: upNextSeconds },
    skip: following || !skipper.view ? undefined : { kind: skipper.view.kind },
  };

  const triggerNextEpisode = () => {
    if (followingRef.current) return;
    clearUpNext();
    setUpNextDismissed(false);
    setEnded(false);
    const preloaded = preloadedNextMediaRef.current;
    const nextUrl = currentMediaRef.current?.series?.next?.url;

    if (preloaded && nextUrl) {
      putOnAtOnceRef.current = preloaded;
      putMedia(preloaded);
      profileStore.playbackStarted(preloaded);
      resetApplied();
      const startIdx = preferredSourceIndex(preloaded, settings.animeAudio) ?? 0;
      resetSources(startIdx);
      const startSource = sourcesOf(preloaded)[startIdx] ?? sourcesOf(preloaded)[0]!;
      engineRef.current?.load(startSource.stream.url, startSource.stream.type, startSource.subtitles, undefined, startSource.stream.directUrl);
      engineRef.current?.play();
      socketRef.current?.send({ type: "TV_PLAY_URL", url: nextUrl });
    } else if (nextUrl) {
      socketRef.current?.send({ type: "TV_NEXT_EPISODE" });
    }
  };

  const [controlsVisible, setControlsVisible] = useState(true);
  const visibleRef = useRef(true);
  visibleRef.current = controlsVisible;
  const upRef = useRef(true);
  const setUp = (up: boolean) => {
    upRef.current = up;
    setControlsVisible(up);
  };
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stickyRef = useRef(false);
  stickyRef.current = player.state !== "playing" || menu !== null;

  const putAwayAtRef = useRef(0);

  const wake = () => {
    setUp(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (stickyRef.current) return;
      if (controlsRef.current?.contains(document.activeElement)) {
        hideTimerRef.current = setTimeout(() => {
          if (!stickyRef.current) setUp(false);
        }, HUD_HOLD_MS);
      } else {
        setUp(false);
      }
    }, HUD_HIDE_MS);
  };

  const hideControls = () => {
    if (menu !== null || (player.state !== "playing" && player.state !== "paused")) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    putAwayAtRef.current = Date.now();
    setUp(false);
  };

  useEffect(() => {
    if (player.state === "playing" && menu === null) {
      wake();
    } else {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setUp(true);
    }
  }, [player.state, menu]);

  const focusPendingRef = useRef(false);
  const lastStepRef = useRef<{ from: HTMLElement; to: HTMLElement; action: "up" | "down" } | null>(null);
  useEffect(() => {
    if (!controlsVisible && controlsRef.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
    if (controlsVisible && focusPendingRef.current) {
      focusPendingRef.current = false;
      controlsRef.current?.querySelector<HTMLElement>("button")?.focus();
    }
  }, [controlsVisible]);
  const focusControls = () => {
    if (visibleRef.current) controlsRef.current?.querySelector<HTMLElement>("button")?.focus();
    else focusPendingRef.current = true;
  };

  useEffect(() => {
    if (menu !== null) return;
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected && controlsRef.current?.contains(opener)) opener.focus();
  }, [menu]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.detail === 0 || !(event.target instanceof Element)) return;
      const button = event.target.closest("button");
      if (button && controlsRef.current?.contains(button)) button.blur();
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => pressWhatOkPresses(), []);

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  const remember = (patch: Partial<Prefs>) => {
    prefsRef.current = { ...prefsRef.current, ...patch };
    writeStorage(PREFS_KEY, serializePrefs(prefsRef.current));
  };
  function resetApplied() {
    appliedRef.current = { subtitles: false, audio: false };
  }

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
    setToast({ id: toastIdRef.current, text: t("notice.delay", { value: formatDelay(clamped) }) });
  };
  const chooseSubtitleSync = (on: boolean) => {
    subtitleSyncRef.current = on;
    remember({ subtitleSync: on });
    engineRef.current?.setSubtitleSync(on);
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, text: t(on ? "notice.syncOn" : "notice.syncOff"), notice: true });
  };
  const chooseSubtitleSyncMode = (mode: SubtitleSyncMode) => {
    subtitleSyncModeRef.current = mode;
    remember({ subtitleSyncMode: mode });
    engineRef.current?.setSubtitleSyncMode(mode);
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, text: t(mode === "light" ? "notice.syncLight" : "notice.syncFull"), notice: true });
  };
  useEffect(() => republishRef.current(), [captionStyle, subtitleDelay]);
  useEffect(() => engineRef.current?.subtitleDelayChanged(), [subtitleDelay]);
  const streamUrl = currentMedia?.stream.url;
  const [enhanceHost, setEnhanceHost] = useState<HTMLDivElement | null>(null);
  const enhance = useEnhance({
    video: videoRef.current,
    host: enhanceHost,
    film: streamUrl,
    player,
    readable: engineRef.current?.pictureReadable() ?? false,
    say: (text) => {
      toastIdRef.current += 1;
      setToast({ id: toastIdRef.current, text, notice: true });
    },
  });
  enhanceRef.current = enhance.state;
  const chooseEnhanceRef = useRef(enhance.choose);
  chooseEnhanceRef.current = enhance.choose;
  const enhanceKey = JSON.stringify(enhance.state ?? null);
  useEffect(() => republishRef.current(), [enhanceKey]);
  useEffect(() => republishRef.current(), [streamUrl, sourceIndex]);
  useEffect(() => republishRef.current(), [ended, upNextCountdown, upNextHeld, autoplay, following, skipper.view?.kind]);

  useEffect(() => {
    if (player.state === "idle") resetApplied();
    if (player.state !== "paused") setEnded(false);
  }, [player.state]);

  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    const wanted = prefsRef.current;
    const subtitles = player.subtitles;
    if (!engine || !subtitles || applied.subtitles || subtitles.tracks.length === 0) return;
    applied.subtitles = true;
    const id = pickBaseSubtitleTrack(subtitles.tracks, wanted.subtitles, {
      chosen: settings.subtitleLanguages,
      only: settings.onlySubtitleLanguages,
      plainFirst: Boolean(currentMediaRef.current?.anime),
    });
    if (id !== undefined && id !== subtitles.current) engine.setSubtitle(id);
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

  const skip = (seconds: number) => {
    engineRef.current?.skip(seconds);
    const run = skipRunRef.current;
    const now = Date.now();
    run.total = now - run.at < SKIP_RUN_MS && Math.sign(run.total) === Math.sign(seconds) ? run.total + seconds : seconds;
    run.at = now;
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, text: `${run.total > 0 ? "+" : "−"}${Math.abs(run.total)}s`, side: run.total > 0 ? "forward" : "back" });
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.notice ? 1800 : 900);
    return () => clearTimeout(timer);
  }, [toast]);

  const notify = (text: string) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, text, notice: true });
  };

  useEffect(() => {
    if (player.state !== "playing" || followingRef.current) return;
    holdRef.current = null;
    setHold(null);
  }, [player.state]);
  useEffect(() => {
    if (following) return;
    holdRef.current = null;
    setHold(null);
    setCatchingUp(false);
  }, [following]);

  const lastPlayerRef = useRef<PlayerState>(IDLE_STATE);
  useEffect(() => {
    const change = describeChange(lastPlayerRef.current, player, noticeText);
    lastPlayerRef.current = player;
    if (change && !followingRef.current && !engineRef.current?.quiet()) notify(change);
  }, [player]);

  useEffect(() => {
    const video = videoRef.current!;
    video.setAttribute("referrerpolicy", "no-referrer");
    const publish = (state: PlayerState) => {
      const full = withTvState(state, captionStyleRef.current, currentMediaRef.current, sourceIndexRef.current, subtitleDelayRef.current, endingRef.current, enhanceRef.current);
      setPlayer(full);
      if (!followingRef.current) socketRef.current?.send({ type: "TV_STATE", state: full });
    };
    const follower = new Follower();
    const engine = new PlayerEngine(
      video,
      publish,
      () => {
        if (followingRef.current) return;
        if (currentMediaRef.current?.series?.next && !upNextDismissedRef.current) {
          setUpNextCountdown((prev) => (prev !== null && prev <= 5 ? prev : 5));
          setUpNextHeld(false);
        }
        setMenu(null);
        setEnded(true);
      },
    );
    engineRef.current = engine;
    engine.useSubtitleSync(
      () => import("../subsync/start").then((module) => module.startSync),
      () => subtitleDelayRef.current,
    );
    engine.setSubtitleSync(subtitleSyncRef.current);
    engine.setSubtitleSyncMode(subtitleSyncModeRef.current);
    republishRef.current = () => publish(engine.getState());

    let justOpened = true;
    const socket = connectSocket({
      hello: () => {
        const opened = justOpened;
        justOpened = false;
        return { type: "TV_HELLO", deviceId: readKept(DEVICE_KEY), ...(opened ? { opened } : {}) };
      },
      onStatus: setConnection,
      onMessage: (message) => {
        switch (message.type) {
          case "TV_WELCOME":
            writeKept(DEVICE_KEY, message.deviceId);
            setPaired(message.paired);
            followingRef.current = message.following ?? null;
            setFollowing(message.following ?? null);
            setPairing(toPairing(message.pairing));
            setControl(null);
            setParty(null);
            setPartyEnds(null);
            if (message.leftParty) setLeftParty(message.leftParty);
            if (!message.following) {
              const media = currentMediaRef.current;
              socketRef.current?.send({
                type: "TV_STATE",
                state: withTvState(engine.getState(), captionStyleRef.current, media, sourceIndexRef.current, subtitleDelayRef.current, endingRef.current, enhanceRef.current),
                ...(media ? { media } : {}),
              });
            }
            break;
          case "TV_CODE":
            if (message.control) setControl(toPairing(message.pairing));
            else setPairing(toPairing(message.pairing));
            break;
          case "TV_PAIRED":
            if (pairedRef.current || screenRef.current === "library") setFlash({ id: ++flashIdRef.current, text: t("tv.phoneJoined") });
            setPaired(true);
            setPairing(null);
            break;
          case "TV_FOLLOWING":
            followingRef.current = message.leader;
            invitedWithRef.current = null;
            setPaired(true);
            setPairing(null);
            setFollowing(message.leader);
            setPartyError(null);
            wasResolvingRef.current = false;
            setResolving(false);
            setStarting(null);
            setMenu(null);
            if (currentMediaRef.current) {
              putMedia(null);
              engine.stop();
            }
            break;
          case "TV_PARTY":
            setParty(message.party);
            setPartyEnds(message.party?.code ? Date.now() + message.party.code.expiresInMs : null);
            break;
          case "ERROR": {
            if (startingRef.current && !startingRef.current.heard) setStarting(null);
            const over = message.code === "INVALID_CODE" && invitedWithRef.current !== null;
            invitedWithRef.current = null;
            if (over) {
              void friendsRef.current.refresh();
              setPartyJoinWith(null);
              if (screenRef.current === "party") setScreen("library");
              setFlash({ id: ++flashIdRef.current, text: t("friends.partyGone") });
              break;
            }
            const text = socketError(message.code, message.message);
            if (screenRef.current === "party") setPartyError({ id: ++flashIdRef.current, text });
            else setFlash({ id: ++flashIdRef.current, text });
            break;
          }
          case "TV_SYNC": {
            const media = currentMediaRef.current;
            if (!media || (message.stream && message.stream !== media.stream.url)) break;
            const local = engine.getState();
            if (local.state !== "playing" && local.state !== "paused") break;
            const rate = local.playbackRate ?? 1;
            const step = follower.step(
              message,
              {
                playing: local.state === "playing",
                time: local.currentTime,
                rate,
                buffering: Boolean(local.buffering),
                ahead: Math.max(0, (local.bufferedEnd ?? local.currentTime) - local.currentTime),
              },
              performance.now() / 1000,
              (time) => engine.hasBuffered(time),
            );
            if (step.seek !== undefined) engine.seek(step.seek);
            if (Math.abs(step.rate - rate) > 0.001) engine.setPlaybackRate(step.rate);
            if (step.play !== (local.state === "playing")) {
              if (step.play) engine.play();
              else engine.pause();
            }
            const held: Hold | null = message.playing ? null : { by: message.by ?? null, waiting: message.waiting === true, ...(message.ended ? { ended: true } : {}) };
            if (!held && holdRef.current && !holdRef.current.waiting) {
              const line = resumeLine(message.by, partyRef.current);
              if (line) notify(line);
            }
            holdRef.current = held;
            setHold((before) => (sameHold(before, held) ? before : held));
            setCatchingUp(message.playing && (step.seek !== undefined || Math.abs(step.rate - message.rate) > 0.001));
            break;
          }
          case "TV_UNPAIRED":
            if (followingRef.current && !leavingRef.current) setFlash({ id: ++flashIdRef.current, text: t("party.ended") });
            leavingRef.current = false;
            setPaired(false);
            setFollowing(null);
            setPairing(toPairing(message.pairing));
            wasResolvingRef.current = false;
            setResolving(false);
            setStarting(null);
            setMenu(null);
            break;
          case "TV_RESOLVING":
            window.clearTimeout(lookupEndTimerRef.current);
            if (message.active) {
              if (!wasResolvingRef.current) mediaBeforeLookupRef.current = currentMediaRef.current;
              wasResolvingRef.current = true;
              setResolving(true);
              if (!followingRef.current && (playerRef.current.state === "idle" || startingRef.current)) {
                const hint = message.hint;
                setStarting((before) =>
                  before && before.loadedAt === null
                    ? { ...before, heard: true, title: before.title ?? hint?.title, art: before.art ?? hint?.backdrop ?? hint?.poster }
                    : startingFrom(hint, { heard: true }),
                );
              }
            } else lookupEndTimerRef.current = window.setTimeout(() => setResolving(false), LOOKUP_END_GRACE_MS);
            break;
          case "TV_CMD": {
            const { command } = message;
            if (command.type === "LOAD") {
              window.clearTimeout(lookupEndTimerRef.current);
              wasResolvingRef.current = false;
              setResolving(false);
              keepPageFor(command.media.page);
              const current = currentMediaRef.current;
              const isSameStream = current?.stream.url === command.media.stream.url;

              if (playerRef.current.state !== "error" && (isSameEpisode(current, command.media) || isSameStream)) {
                putMedia(command.media);
                return;
              }

              if (!followingRef.current && (startingRef.current || playerRef.current.state === "idle")) {
                const before = startingRef.current;
                setStarting({
                  since: before?.since ?? null,
                  loadedAt: performance.now(),
                  heard: true,
                  title: before?.title ?? command.media.title,
                  art: before?.art ?? command.media.backdrop ?? command.media.poster,
                  from: command.startAt ?? before?.from,
                });
              }
              putMedia(command.media);
              follower.reset();
              if (!followingRef.current) profileStore.playbackStarted(command.media);
              clearUpNext();
              setUpNextDismissed(false);
              resetApplied();
              const startIdx = preferredSourceIndex(command.media, settings.animeAudio) ?? 0;
              resetSources(startIdx);
              const startSource = sourcesOf(command.media)[startIdx] ?? sourcesOf(command.media)[0]!;
              void engine.load(startSource.stream.url, startSource.stream.type, startSource.subtitles, command.startAt, startSource.stream.directUrl);
            } else if (command.type === "PLAY") {
              engine.play();
              if (message.by) {
                holdRef.current = null;
                setHold(null);
                const line = resumeLine(message.by, partyRef.current);
                if (line) notify(line);
              }
            } else if (command.type === "PAUSE") {
              engine.pause();
              if (message.by) {
                holdRef.current = { by: message.by, waiting: false };
                setHold(holdRef.current);
              }
            } else if (command.type === "SEEK") engine.seek(command.time);
            else if (command.type === "SKIP") skip(command.seconds);
            else if (command.type === "STOP") {
              putMedia(null);
              clearUpNext();
              setResolving(false);
              setStarting(null);
              setMenu(null);
              engine.stop();
            } else if (command.type === "SET_QUALITY") chooseQuality(command.level);
            else if (command.type === "SET_ENHANCE") chooseEnhanceRef.current(command.mode);
            else if (command.type === "SET_SUBTITLE") chooseSubtitle(command.track);
            else if (command.type === "SET_SUBTITLE_DELAY") chooseSubtitleDelay(command.delay);
            else if (command.type === "SET_SUBTITLE_SYNC") {
              if (command.mode) chooseSubtitleSyncMode(command.mode);
              if (!command.mode || command.on !== subtitleSyncRef.current) chooseSubtitleSync(command.on);
            }
            else if (command.type === "SET_CAPTION_STYLE") changeCaptions(command.style);
            else if (command.type === "SET_SPEED") engine.setPlaybackRate(command.rate);
            else if (command.type === "SET_AUDIO") chooseAudio(command.track);
            else if (command.type === "SET_SOURCE") chooseSource(command.index);
            else if (command.type === "TOGGLE_FULLSCREEN") fullscreenFromPhone();
            else if (command.type === "NEXT_EPISODE") triggerNextEpisode();
            else if (command.type === "DISMISS_UP_NEXT") dismissUpNext();
            else if (command.type === "SKIP_SEGMENT") skipRef.current.skip();
            else if (command.type === "REFRESH_ACCOUNT") syncNowRef.current();
            if (command.type !== "LOAD" && command.type !== "STOP" && command.type !== "REFRESH_ACCOUNT") wake();
            break;
          }
        }
      },
    });
    socketRef.current = socket;

    const onFullscreenChange = () => {
      republishRef.current();
      setFullscreen(Boolean(document.fullscreenElement));
      if (document.fullscreenElement) setFsPrompt(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    const releaseVideo = keepNativePlayerOut(video);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      releaseVideo();
      socket.disconnect();
      engine.destroy();
    };
  }, []);

  const inParty = party !== null;
  useEffect(() => {
    engineRef.current?.setInParty(inParty);
  }, [inParty]);
  useEffect(() => {
    engineRef.current?.setAdaptive(adaptiveQuality);
  }, [adaptiveQuality]);

  useEffect(() => {
    if (!resolving) return;
    const timer = setTimeout(() => setResolving(false), RESOLVING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [resolving]);

  useEffect(() => {
    if (resolving) {
      setNotice(null);
      return;
    }
    if (!wasResolvingRef.current) return;
    wasResolvingRef.current = false;
    const before = mediaBeforeLookupRef.current;
    const timer = setTimeout(() => {
      if (startingRef.current?.loadedAt === null) setStarting(null);
      if (currentMediaRef.current !== before || (before && before === putOnAtOnceRef.current)) return;
      if (!before) return setNotice(t("notice.wouldntPlay"));
      if (videoRef.current?.ended) {
        setEnded(true);
        setFlash({ id: ++flashIdRef.current, text: t("notice.wouldntPlay") });
      } else notify(t("notice.wouldntPlay"));
    }, NO_VIDEO_AFTER_LOOKUP_MS);
    return () => clearTimeout(timer);
  }, [resolving]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!leftParty || !unlocked || welcoming) return;
    setNotice(t("party.leftGone", { name: leftParty }));
    setLeftParty(null);
  }, [leftParty, unlocked, welcoming]);

  useEffect(() => {
    const now = startingRef.current;
    if (!now || now.leaving || now.loadedAt === null) return;
    if (player.state === "loading" || player.buffering) return;
    if (player.state === "playing" || player.state === "paused") {
      if (player.state === "playing" && !followingRef.current) {
        const ms = (from: number) => Math.min(600_000, Math.round(Math.max(0, from)));
        socketRef.current?.send({ type: "TV_STARTED", ...(now.since !== null ? { lookupMs: ms(now.loadedAt - now.since) } : {}), loadMs: ms(performance.now() - now.loadedAt), ...engineRef.current?.startup() });
      }
      setStarting({ ...now, leaving: true });
    } else setStarting(null);
  }, [player.state, player.buffering]);
  const startingLeaves = starting?.leaving === true;
  useEffect(() => {
    if (!startingLeaves) return;
    const timer = setTimeout(() => setStarting((now) => (now?.leaving ? null : now)), STARTING_FADE_MS);
    return () => clearTimeout(timer);
  }, [startingLeaves]);
  const unheard = starting !== null && !starting.heard;
  useEffect(() => {
    if (!unheard) return;
    const timer = setTimeout(() => setStarting((now) => (now && !now.heard ? null : now)), UNHEARD_MS);
    return () => clearTimeout(timer);
  }, [unheard]);
  useEffect(() => {
    if (connection !== "open") setStarting((now) => (now && !now.heard ? null : now));
  }, [connection]);

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    notify(t(video.muted ? "notice.muted" : "notice.unmuted"));
  };

  const canFullscreen = offersFullscreen();
  const fullscreenFromPhone = () => {
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
    if (!canFullscreen) return;
    document.documentElement.requestFullscreen?.().catch(() => setFsPrompt(true));
  };
  const acceptFullscreenPrompt = () => {
    setFsPrompt(false);
    enterFullscreen();
  };
  useEffect(() => {
    if (!fsPrompt) return;
    const timer = setTimeout(() => setFsPrompt(false), 12_000);
    return () => clearTimeout(timer);
  }, [fsPrompt]);

  const countingDown = (player.state === "playing" && !player.buffering) || ended;
  const countSpeed = ended ? 1 : Math.min(4, Math.max(0.25, player.playbackRate || 1));
  useEffect(() => {
    if (upNextCountdown === null || !autoplay || upNextHeld) return;
    if (upNextCountdown <= 0) {
      triggerNextEpisode();
      return;
    }
    if (!countingDown) return;
    const timer = setTimeout(() => {
      setUpNextCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000 / countSpeed);
    return () => clearTimeout(timer);
  }, [upNextCountdown, autoplay, countingDown, upNextHeld, countSpeed]);

  const upNextLastTimeRef = useRef(0);
  useEffect(() => {
    const last = upNextLastTimeRef.current;
    upNextLastTimeRef.current = player.currentTime;
    if (player.state !== "playing" || !(player.duration > 30) || !currentMedia?.series?.next || following || upNextDismissed) return;
    const left = player.duration - player.currentTime;
    const lastSeconds = Math.min(UP_NEXT_SECONDS, Math.max(1, Math.ceil(left)));
    if (upNextCountdown === null) {
      if (player.currentTime < nextFrom) return;
      if (left <= UP_NEXT_SECONDS) {
        setUpNextTotal(UP_NEXT_SECONDS);
        setUpNextHeld(false);
        setUpNextCountdown(lastSeconds);
        return;
      }
      const playedInto = player.currentTime >= last && player.currentTime - last < 3 && player.currentTime - nextFrom < 4;
      const fills = playedInto && autoSkip && autoplay;
      setUpNextFresh(playedInto);
      setUpNextTotal(AUTO_SKIP_SECONDS);
      setUpNextHeld(!fills);
      setUpNextCountdown(AUTO_SKIP_SECONDS);
    } else if (upNextHeld && left <= UP_NEXT_SECONDS) {
      setUpNextTotal(UP_NEXT_SECONDS);
      setUpNextHeld(false);
      setUpNextCountdown(lastSeconds);
    }
  }, [player.currentTime, player.duration, player.state, currentMedia?.series?.next, following, upNextDismissed, upNextCountdown, upNextHeld, nextFrom, autoSkip, autoplay]);

  useEffect(() => {
    if (player.duration <= 0 || ended) return;
    if (upNextCountdown !== null && player.currentTime < nextFrom - 1) clearUpNext();
    if (upNextDismissed && player.currentTime < nextFrom - 5) setUpNextDismissed(false);
  }, [player.currentTime, player.duration, upNextDismissed, upNextCountdown, ended, nextFrom]);

  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(
      () => socketRef.current?.send({ type: "TV_NEW_CODE" }),
      Math.max(0, pairing.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pairing]);

  const showsControl = unlocked && paired && !following && !resolving && !accountPage && screen === "connect" && player.state === "idle";
  useEffect(() => {
    if (!showsControl) return setControl(null);
    if (connection !== "open") return;
    const timer = setTimeout(() => socketRef.current?.send({ type: "TV_NEW_CODE" }), control ? Math.max(1000, (control.expiresAt - Date.now()) / 2) : 0);
    return () => clearTimeout(timer);
  }, [showsControl, connection, control]);

  const profileName = account.me && account.profile ? account.profile.name : "";
  useEffect(() => {
    if (connection === "open") socketRef.current?.send({ type: "TV_NAME", name: profileName });
  }, [connection, profileName]);

  const profileId = account.me && account.profile ? account.profile.id : undefined;
  const friendsOn = friendChoices(settings).friends;
  useEffect(() => {
    if (connection !== "open") return;
    if (!profileId || !friendsOn) return void socketRef.current?.send({ type: "TV_PROFILE" });
    let stopped = false;
    friendsApi.screen(profileId).then(
      ({ proof }) => !stopped && socketRef.current?.send({ type: "TV_PROFILE", proof }),
      () => !stopped && socketRef.current?.send({ type: "TV_PROFILE" }),
    );
    return () => {
      stopped = true;
    };
  }, [connection, profileId, friendsOn]);

  const linkTriedRef = useRef(false);
  useEffect(() => {
    if (!linkCode || !unlocked || connection !== "open" || linkTriedRef.current || holding) return;
    linkTriedRef.current = true;
    history.replaceState(history.state, "", location.pathname);
    if (childRef.current) {
      setFlash({ id: ++flashIdRef.current, text: t("notice.childNoParty") });
      return;
    }
    invitedWithRef.current = linkCode;
    socketRef.current?.send({ type: "TV_PARTY_JOIN", code: linkCode });
  }, [linkCode, unlocked, connection, holding]);

  const partyShown = menu === "party" || menu === "partyInvite" || (screen === "party" && player.state === "idle");
  useEffect(() => {
    if (menu === "partyInvite" && !(party?.role === "host" && party.code)) setMenu("party");
  }, [menu, party]);
  useEffect(() => {
    if (party?.role !== "host") return;
    const left = partyEnds === null ? 0 : partyEnds - Date.now();
    if (partyShown) {
      const timer = setTimeout(() => socketRef.current?.send({ type: "TV_PARTY_OPEN" }), Math.max(500, left));
      return () => clearTimeout(timer);
    }
    if (party.guests.length > 0) return;
    const timer = setTimeout(() => setParty(null), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [party, partyEnds, partyShown]);

  const startParty = () => void socketRef.current?.send({ type: "TV_PARTY_OPEN" });
  const startTogether = (friend: string) => {
    setPartyError(null);
    setPartyJoinWith(null);
    invitedWithRef.current = null;
    setTogether(friend);
    setScreen("party");
    startParty();
  };
  useEffect(() => {
    if (!together || party?.role !== "host" || !party.code || (partyEnds ?? 0) <= Date.now()) return;
    setTogether(null);
    const code = party.code;
    const current = friendsRef.current;
    const name = nameOf(current.state?.friends ?? [], together);
    void current.send([together], { kind: "party", code: code.code, endsAt: partyEnds ?? Date.now() + code.expiresInMs }).then(
      async (answer) => {
        account.say(answer.sent.length > 0 ? t("friends.inviteSent", { names: name }) : t("friends.declined", { names: name }));
        await friendsRef.current.refresh();
      },
      (error: unknown) => account.say(describeError(error)),
    );
  }, [together, party, partyEnds]);
  const joinParty = (code: string) => {
    setPartyJoinWith(null);
    if (childRef.current) {
      setPartyError({ id: ++flashIdRef.current, text: t("notice.childNoParty") });
      return;
    }
    socketRef.current?.send({ type: "TV_PARTY_JOIN", code });
  };
  const removeFromParty = (id: string) => void socketRef.current?.send({ type: "TV_PARTY_REMOVE", id });
  const setAdmin = (id: string, on: boolean) => void socketRef.current?.send({ type: "TV_PARTY_ADMIN", id, admin: on });
  const steer = (command: PartyCommand) => void socketRef.current?.send({ type: "TV_PARTY_CMD", command });
  const playOrPause = () => {
    if (!following) togglePlay();
    else if (admin) steer({ type: player.state === "playing" ? "PAUSE" : "PLAY" });
  };
  const skipHere = (seconds: number) => {
    if (!following) skip(seconds);
    else if (admin) steer({ type: "SKIP", seconds });
  };
  const endParty = () => void socketRef.current?.send({ type: "TV_PARTY_CLOSE" });
  useEffect(() => {
    if (admin) wake();
  }, [admin]);

  const togglePlay = () => (player.state === "playing" ? engineRef.current?.pause() : engineRef.current?.play());
  const dismissUpNext = () => {
    clearUpNext();
    setUpNextDismissed(true);
  };
  const playEpisode = (url: string, options: PlayOptions = {}) => {
    setMenu(null);
    clearUpNext();
    setUpNextDismissed(false);
    if (playerRef.current.state === "idle" && !followingRef.current && connection === "open") setStarting(startingFrom(options.hint, { from: options.startAt }));
    socketRef.current?.send({ type: "TV_PLAY_URL", url, ...(options.startAt ? { startAt: options.startAt } : {}), ...(options.hint ? { hint: options.hint } : {}) });
  };
  const leaveParty = () => {
    leavingRef.current = true;
    setMenu(null);
    engineRef.current?.stop();
    putMedia(null);
    socketRef.current?.send({ type: "TV_UNPAIR" });
  };
  useEffect(() => {
    if (!child || (!following && party?.role !== "host")) return;
    if (following) leaveParty();
    else endParty();
    if (screenRef.current === "party") setScreen("library");
    setFlash({ id: ++flashIdRef.current, text: t("notice.childNoParty") });
  }, [child, following, party?.role]); // eslint-disable-line react-hooks/exhaustive-deps
  const stopPlayback = () => {
    putMedia(null);
    clearUpNext();
    engineRef.current?.stop();
  };
  const leaveFilm = () => {
    stopPlayback();
    setScreen("library");
  };
  const chooseQuality = (level: number) => {
    const media = currentMediaRef.current;
    const all = media ? sourcesOf(media) : [];
    const { qualities } = sourceMenus(all);
    if (!qualities.includes(sourceIndexRef.current)) return void engineRef.current?.setQuality(level);
    const auto = qualities.find((index) => isAutoQuality(all[index]!.quality));
    loadSource(level >= FILE_QUALITY ? level - FILE_QUALITY : (auto ?? qualities[0]!), true);
  };
  const chooseSource = (place: number) => {
    const media = currentMediaRef.current;
    const menus = sourceMenus(media ? sourcesOf(media) : []);
    const index = menus.sources[place];
    if (index === undefined) return;
    loadSource(index === 0 && menus.qualities.includes(sourceIndexRef.current) ? sourceIndexRef.current : index, true);
  };
  const cycleSubtitles = () => {
    const subtitles = playerRef.current.subtitles;
    if (subtitles && subtitles.tracks.length > 0) chooseSubtitle(subtitles.current + 1 >= subtitles.tracks.length ? -1 : subtitles.current + 1);
  };
  const cancelLoad = () => {
    wasResolvingRef.current = false;
    setResolving(false);
    setStarting(null);
    putMedia(null);
    clearUpNext();
    setMenu(null);
    engineRef.current?.stop();
    resetSources();
    if (!followingRef.current) socketRef.current?.send({ type: "TV_CANCEL" });
  };
  const goToPrevious = () => {
    const previous = previousEpisode(currentMediaRef.current?.series);
    if (previous) playEpisode(previous.url);
  };

  const finished = ended && !following && !resolving && upNextCountdown === null && player.state === "paused" && player.duration > 0 && player.currentTime >= player.duration - 1.5;
  const watchAgain = () => {
    setEnded(false);
    engineRef.current?.seek(0);
    engineRef.current?.play();
  };

  const untriedSource = currentMedia ? sourcesOf(currentMedia).some((_, index) => !triedSourcesRef.current.has(index)) : false;
  const failed = player.state === "error" && !isBlocked(player) && !following && !resolving && !untriedSource;
  useEffect(() => {
    if (failed) setMenu(null);
  }, [failed]);
  const retryPlayback = () => {
    const engine = engineRef.current;
    if (!currentMedia || !engine) return;
    const at = engine.resumePoint();
    const page = currentMedia.page;
    if (player.error === PlayerError.SourceUnavailable && page && !followingRef.current) {
      const { poster, backdrop, year } = currentMedia;
      playEpisode(page, { ...(at > 5 ? { startAt: at } : {}), hint: { poster, backdrop, year } });
      return;
    }
    const startIdx = preferredSourceIndex(currentMedia, settings.animeAudio) ?? 0;
    const source = sourcesOf(currentMedia)[startIdx] ?? sourcesOf(currentMedia)[0];
    if (!source) return;
    resetApplied();
    resetSources(startIdx);
    void engine.load(source.stream.url, source.stream.type, source.subtitles, at > 5 ? at : undefined, source.stream.directUrl);
    engine.play();
  };

  const lostConnection = failed && player.error === PlayerError.ConnectionLost;
  const retryRef = useRef(retryPlayback);
  retryRef.current = retryPlayback;
  const connectionRetriesRef = useRef(0);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const reopened = connection === "open" && !wasOpenRef.current;
    wasOpenRef.current = connection === "open";
    if (!lostConnection || connection !== "open" || connectionRetriesRef.current >= 3) return;
    const timer = setTimeout(
      () => {
        connectionRetriesRef.current += 1;
        retryRef.current();
      },
      reopened ? 0 : 4000,
    );
    return () => clearTimeout(timer);
  }, [connection, lostConnection]);
  useEffect(() => {
    if (player.state === "playing") connectionRetriesRef.current = 0;
  }, [player.state]);
  const refused = failed && player.error === PlayerError.SourceUnavailable;
  const lookedAgainRef = useRef<string | null>(null);
  useEffect(() => {
    const page = currentMediaRef.current?.page;
    if (!refused || !page || lookedAgainRef.current === page) return;
    lookedAgainRef.current = page;
    retryRef.current();
  }, [refused]);
  useEffect(() => {
    if (player.state === "playing") lookedAgainRef.current = null;
  }, [player.state]);
  useEffect(() => {
    if (connection === "replaced") engineRef.current?.pause();
  }, [connection]);

  useEffect(() => {
    if (!unlocked) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const action = actionForKey(event);
      if (!action) return;
      const engine = engineRef.current;
      const overlayWasVisible = visibleRef.current;
      wake();

      if (accountPage) return;

      if (action === "browse") {
        if (!following && !resolving && player.state === "idle") setScreen("library");
        event.preventDefault();
        return;
      }

      if (fsPrompt && (action === "select" || action === "back")) {
        if (action === "select") acceptFullscreenPrompt();
        else setFsPrompt(false);
        event.preventDefault();
        return;
      }

      if (finished || failed) {
        if (action === "fullscreen") toggleFullscreen();
        return;
      }

      if (menu) {
        if (action === "back") setMenu(menuBack(menu));
        else if (action === "up" || action === "down" || action === "left" || action === "right") moveInMenu(menuRef.current, action);
        else return;
        event.preventDefault();
        return;
      }

      if (action === "back" && upNextOwnsKeys) {
        dismissUpNext();
        event.preventDefault();
        return;
      }
      if (action === "back" && !following && skipRef.current.back()) {
        event.preventDefault();
        return;
      }

      if (!engine || player.state === "idle") return;

      if (stuck && !following && (action === "select" || action === "back")) {
        cancelLoad();
        event.preventDefault();
        return;
      }

      const row = controlsRef.current;
      const focused = document.activeElement as HTMLElement | null;
      const pill = document.querySelector<HTMLElement>(".tv .hud-skip");
      if (pill && focused && pill.contains(focused)) {
        if (action === "select") return;
        const buttons = [...pill.querySelectorAll<HTMLElement>("button")];
        if (action === "left" || action === "right") buttons[buttons.indexOf(focused) + (action === "right" ? 1 : -1)]?.focus();
        else if (action === "down") focusControls();
        else if (action === "back" || action === "up") focused.blur();
        if (action === "left" || action === "right" || action === "down" || action === "back" || action === "up") {
          event.preventDefault();
          return;
        }
      }
      if (row && focused && row.contains(focused)) {
        if (action === "left" || action === "right" || action === "up" || action === "down") {
          const buttons = [...row.querySelectorAll<HTMLElement>("button:not(:disabled)")];
          let next = buttons[pickInRows(buttons.map((button) => button.getBoundingClientRect()), buttons.indexOf(focused), action)];
          const vertical = action === "up" || action === "down";
          const left = lastStepRef.current;
          if (next && vertical && left && left.to === focused && left.action !== action && buttons.includes(left.from)) next = left.from;
          lastStepRef.current = next && vertical ? { from: focused, to: next, action } : null;
          if (next) next.focus();
          else if (action === "up") {
            const pillButton = pill?.querySelector<HTMLElement>("button");
            if (pillButton) pillButton.focus();
            else focused.blur();
          }
          event.preventDefault();
          return;
        }
        if (action === "back") {
          focused.blur();
          event.preventDefault();
          return;
        }
        if (action === "select") return;
      }

      if (following) {
        const steering = admin ? partyCommandForKey(action, player.state === "playing", Boolean(currentMedia?.series?.next)) : null;
        if (isBlocked(player) && (action === "select" || action === "playpause" || action === "play")) engine.play();
        else if (steering) steer(steering);
        else if (action === "up" || action === "down") focusControls();
        else if (action === "back") {
          if (overlayWasVisible) leaveRef.current?.focus();
        }
        else if (action === "captions") cycleSubtitles();
        else if (action === "mute") toggleMute();
        else if (action === "fullscreen") toggleFullscreen();
        event.preventDefault();
        return;
      }

      switch (action) {
        case "select":
        case "playpause":
          if (upNextOwnsKeys) triggerNextEpisode();
          else if (action === "select" && skipRef.current.press()) break;
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
          focusControls();
          break;
        case "next":
          if (currentMedia?.series?.next) triggerNextEpisode();
          break;
        case "previous":
          goToPrevious();
          break;
        case "captions":
          cycleSubtitles();
          break;
        case "mute":
          toggleMute();
          break;
        case "fullscreen":
          toggleFullscreen();
          break;
        case "stop":
          stopPlayback();
          break;
        case "back":
          if (overlayWasVisible) stopPlayback();
          break;
        case "up":
          pill?.querySelector<HTMLElement>("button")?.focus();
          break;
        default:
          break;
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [unlocked, player, upNextCountdown, upNextOwnsKeys, currentMedia?.series?.next, menu, paired, resolving, fsPrompt, following, admin, accountPage, stuck, finished, failed]);

  const libraryShows = player.state === "idle" && !accountPage && !resolving && !following && screen === "library";
  useEffect(() => {
    if (!libraryShows) setWelcoming(false);
  }, [libraryShows]);

  const showVideo = player.state !== "idle";
  const startingShown = unlocked && starting !== null && !following && !accountPage;
  const startingWaits = startingShown && !starting.leaving;
  const filmIsOn = showVideo && !finished && !failed;

  const hosting = party?.role === "host" && party.guests.length > 0;
  useBackWhile(browserBack() && unlocked && showVideo, () => {
    if (menu) setMenu(menuBack(menu));
    else if (upNextOwnsKeys) dismissUpNext();
    else if (!following && skipRef.current.back()) return;
    else if (following) pressAgain("exit.leaveParty") && leaveParty();
    else if (stuck) cancelLoad();
    else if (hosting) pressAgain("exit.stopParty") && leaveFilm();
    else leaveFilm();
  });

  const [boosting, setBoosting] = useState(false);
  const holdPicture = (): boolean => {
    const engine = engineRef.current;
    if (!engine || playerRef.current.state !== "playing") return false;
    if (party?.role === "host" && party.guests.length > 0) return false;
    if (followingRef.current) return false;
    engine.boost(HOLD_SPEED);
    setBoosting(true);
    return true;
  };
  const releasePicture = () => {
    engineRef.current?.unboost();
    setBoosting(false);
  };
  useEffect(() => {
    if (boosting && player.state !== "playing") releasePicture();
  }, [boosting, player.state]);

  const tapPicture = (kind: PointerKind, wasVisible: boolean) => {
    if (!tapToPause) return wasVisible ? hideControls() : wake();
    wake();
    if (kind === "mouse" || wasVisible) playOrPause();
  };
  const doubleTapPicture = (side: Side) => {
    if (side !== "middle") skipHere(side === "back" ? -SKIP_SECONDS : SKIP_SECONDS);
    else if (canFullscreen) toggleFullscreen();
  };

  const takesTaps = unlocked && showVideo && !finished && !failed && menu === null;
  const picture = usePictureGestures({
    enabled: takesTaps,
    source: currentMedia?.stream.url ?? "",
    controlsUp: () => upRef.current,
    actions: { tap: tapPicture, doubleTap: doubleTapPicture, hold: holdPicture, release: releasePicture },
  });
  const touch = useTouchUi();

  useLandscapeWhile(fullscreen && showVideo && !finished);

  const series = currentMedia?.series;
  const next = series?.next;
  const previous = previousEpisode(series);
  const rawTitle = currentMedia?.title || APP_NAME;
  const mainTitle = series && rawTitle.includes("·") ? rawTitle.split("·")[0]!.trim() : rawTitle;
  const shownMain = useShown(currentMedia?.page ? { url: currentMedia.page, title: mainTitle } : null).title || mainTitle;
  const seasonLink = useMemo(
    () => (series ? (groupBySeason(series.episodes ?? []).find((group) => group.season === series.season)?.episodes[0]?.url ?? currentMedia?.page) : undefined),
    [series, currentMedia?.page],
  );
  const episodeDetails = useEpisodeDetails(seasonLink, series?.season);
  const episodeTitle = playingEpisodeName(series, series ? episodeDetails?.get(series.episode)?.title : undefined);

  return (
    <main
      className="tv"
      data-testid="tv"
      data-state={player.state}
      data-time={player.currentTime.toFixed(1)}
      data-error={player.error ?? ""}
      data-hud={controlsVisible ? "visible" : "hidden"}
      data-touch={touch || undefined}
      onMouseMove={() => {
        if (picture.echoOfTouch() || Date.now() - putAwayAtRef.current < PUT_AWAY_QUIET_MS) return;
        wake();
      }}
      onClick={(event) => {
        const zone = takesTaps ? zoneOf(event.target) : null;
        if (!zone || (zone === "bar" && picture.kindRef.current === "mouse")) return wake();
        if (typeof PointerEvent === "undefined") tapPicture("mouse", upRef.current);
      }}
      onPointerDown={picture.onPointerDown}
      onDoubleClick={(event) => {
        if (typeof PointerEvent === "undefined" && zoneOf(event.target) === "picture") toggleFullscreen();
      }}
      onContextMenu={(event) => {
        if (isPicture(event.target) && picture.kindRef.current === "touch") event.preventDefault();
      }}
    >
      <video ref={videoRef} className="tv-video" data-picture preload="auto" style={{ display: showVideo ? "block" : "none" }} playsInline />
      <div ref={setEnhanceHost} className="tv-enhance-layer" style={{ display: showVideo ? "block" : "none" }} />

      {showVideo && !lookMenu && <Captions videoRef={videoRef} style={captionStyle} delay={subtitleDelay} />}

      {startingShown && <StartingFilm starting={starting} stuck={stuck} onCancel={cancelLoad} />}

      {!unlocked && <TvLocked onUnlock={() => setUnlocked(true)} />}

      {unlocked && !showVideo && !accountPage && !startingShown && (resolving || (screen === "connect" && !following)) && (
        <TvIdle
          paired={paired}
          pairing={pairing}
          control={control}
          resolving={resolving}
          stuck={stuck}
          onCancel={cancelLoad}
          onDisconnect={() => socketRef.current?.send({ type: "TV_UNPAIR" })}
          onBack={() => setScreen("library")}
        />
      )}

      {unlocked && !showVideo && !accountPage && !resolving && !startingShown && (following || screen === "party") && (
        <PartyPage
          party={party}
          following={following}
          fullscreen={fullscreen}
          onFullscreen={canFullscreen ? toggleFullscreen : null}
          error={partyError}
          joinWith={partyJoinWith}
          codeEndsAt={partyEnds}
          onStart={startParty}
          onJoin={joinParty}
          onRemove={removeFromParty}
          onAdmin={setAdmin}
          onEnd={endParty}
          onLeave={leaveParty}
          onBack={() => {
            setPartyJoinWith(null);
            setScreen("library");
          }}
        />
      )}

      {unlocked && !showVideo && !accountPage && !resolving && !startingShown && !following && screen === "library" && (
        <TvBrowse
          onPlay={playEpisode}
          onSignIn={() => setAccountView("signin")}
          onSettings={() => setAccountView("panel")}
          onConnect={() => setScreen("connect")}
          onParty={() => {
            setPartyError(null);
            setPartyJoinWith(null);
            invitedWithRef.current = null;
            setScreen("party");
          }}
          onJoinParty={(code) => {
            setPartyError(null);
            setPartyJoinWith(code);
            invitedWithRef.current = code;
            setScreen("party");
          }}
          onStartTogether={startTogether}
          connected={paired}
          partySize={party ? party.guests.length + 1 : 0}
          notice={notice}
          quiet={welcoming}
        />
      )}

      {unlocked && accountPage && <TvAccount view={accountPage} forced={choosing} onView={setAccountView} />}

      {unlocked && account.message && !(account.message.news === "info" && filmIsOn) && (
        <p
          className={account.message.news && filmIsOn ? "tv-note" : "tv-toast"}
          role="status"
          key={account.message.id}
          data-testid="tv-account-toast"
        >
          {account.message.news && filmIsOn && <UsersIcon />}
          {account.message.news && filmIsOn ? <span>{account.message.text}</span> : account.message.text}
        </p>
      )}

      {unlocked && (!showVideo || finished) && flash && (
        <p className="tv-toast" role="status" key={`flash-${flash.id}`} data-testid="tv-flash">
          {flash.text}
        </p>
      )}

      <EdgeScrollHint />

      {unlocked && showVideo && following && <FollowStatus player={player} onPlay={() => engineRef.current?.play()} />}

      {unlocked && showVideo && finished && (
        <EndCard
          title={shownMain}
          subTitle={series ? t("player.seasonEpisode", { season: series.season, episode: series.episode }) : ""}
          page={currentMedia?.page}
          hasNext={Boolean(next)}
          onNext={triggerNextEpisode}
          onAgain={watchAgain}
          onLibrary={() => {
            stopPlayback();
            setScreen("library");
          }}
          onPlay={playEpisode}
        />
      )}

      {unlocked && showVideo && failed && (
        <ErrorCard
          title={shownMain}
          message={friendlyError(player.error)}
          onRetry={retryPlayback}
          onLibrary={() => {
            stopPlayback();
            setScreen("library");
          }}
          onReport={() => reportWontPlay(friendlyError(player.error))}
        />
      )}

      {unlocked && showVideo && !finished && !failed && (
        <Hud
          visible={controlsVisible && !lookMenu && !startingWaits}
          hideWait={startingWaits}
          player={player}
          title={shownMain}
          subTitle={series ? t("player.seasonEpisode", { season: series.season, episode: series.episode }) : ""}
          badge={series ? `S${series.season}:E${series.episode}` : ""}
          episodeName={episodeTitle}
          nextLabel={next ? episodeLabel(next) : null}
          prevLabel={previous ? episodeLabel(previous) : null}
          sourceLabel={player.sources ? (player.sources.labels[player.sources.current] ?? null) : null}
          episodeCount={series?.episodes?.length ?? 0}
          resolving={resolving}
          toast={toast}
          upNext={
            upNextCountdown !== null && next
              ? {
                  seconds: upNextSeconds,
                  total: upNextTotal,
                  fresh: !upNextHeld || upNextFresh,
                  label: next.title || t("player.seasonEpisode", { season: next.season, episode: next.episode }),
                }
              : null
          }
          skip={following ? null : skipper.view}
          onSkipPart={() => skipRef.current.skip()}
          onDismissSkip={() => skipRef.current.dismiss()}
          controlsRef={controlsRef}
          onToggle={playOrPause}
          onSkip={skipHere}
          onSeekTo={(time) => (following ? admin && steer({ type: "SEEK", time }) : engineRef.current?.seek(time))}
          onScrub={wake}
          onNext={() => (following ? admin && steer({ type: "NEXT_EPISODE" }) : triggerNextEpisode())}
          onPrevious={goToPrevious}
          onDismissUpNext={dismissUpNext}
          onOpenMenu={openMenu}
          partySize={party ? party.guests.length + 1 : 0}
          onParty={child ? null : () => openMenu("party")}
          muted={muted}
          onMute={toggleMute}
          onFullscreen={canFullscreen ? toggleFullscreen : null}
          onStop={() => (following ? admin && steer({ type: "STOP" }) : stopPlayback())}
          stuck={stuck}
          onCancel={cancelLoad}
          touch={touch}
          boosting={boosting}
          heldLine={holdLine(hold, party, following)}
          follow={following ? { host: following, catchingUp, admin, leaveRef, onLeave: leaveParty } : undefined}
        />
      )}

      {unlocked && showVideo && (menu === "party" || menu === "partyInvite") && (
        <PartyPanel
          party={party}
          following={following}
          rootRef={menuRef}
          inviting={menu === "partyInvite"}
          codeEndsAt={partyEnds}
          onInviting={(on) => setMenu(on ? "partyInvite" : "party")}
          onClose={() => setMenu(null)}
          onStart={startParty}
          onRemove={removeFromParty}
          onAdmin={setAdmin}
          onEnd={endParty}
          onLeave={leaveParty}
        />
      )}

      {unlocked && showVideo && menu && menu !== "party" && menu !== "partyInvite" && (
        <TvMenu
          kind={menu}
          player={player}
          series={series}
          show={currentMedia ? seriesKeyOf(currentMedia) : undefined}
          watched={watched}
          captionStyle={captionStyle}
          subtitleDelay={subtitleDelay}
          onSubtitleDelay={chooseSubtitleDelay}
          onSubtitleSync={chooseSubtitleSync}
          onSubtitleSyncMode={chooseSubtitleSyncMode}
          rootRef={menuRef}
          onClose={() => setMenu(null)}
          onSubtitle={chooseSubtitle}
          onAudio={chooseAudio}
          onSpeed={(rate) => engineRef.current?.setPlaybackRate(rate)}
          onQuality={chooseQuality}
          onEnhance={enhance.choose}
          onSource={(index) => {
            setMenu(null);
            chooseSource(index);
          }}
          onCaption={changeCaptions}
          onKind={setMenu}
          onEpisode={playEpisode}
        />
      )}

      {unlocked && fsPrompt && (
        <button className="tv-fs-prompt" data-testid="fs-prompt" onClick={acceptFullscreenPrompt}>
          <FullscreenIcon /> {t("tv.fsPrompt")}
        </button>
      )}

      {unlocked && (connection === "replaced" || away) && (
        <div className="tv-banner" data-testid="tv-banner">
          {connection === "replaced" ? t("tv.bannerReplaced") : connection === "connecting" ? t("tv.connecting") : t("tv.bannerReconnecting")}
        </div>
      )}

      {unlocked && welcoming && <TvWelcome ask={asksToEnter} onDone={() => setWelcoming(false)} />}
    </main>
  );
}

const sourceName = (source: PlayableSource, index: number) => source.label ?? t("player.sourceN", { n: index + 1 });

const FILE_QUALITY = 1000;
const isAutoQuality = (quality: string | undefined) => /auto/i.test(quality ?? "");
const qualityLabel = (name: string): string => (/^\d{3,4}p?$/.test(name) ? `${parseInt(name, 10)}p` : name);

function nameIn(all: readonly PlayableSource[], index: number): string {
  const source = all[index]!;
  const menus = sourceMenus(all);
  if (menus.qualities.includes(index) && source.quality && !isAutoQuality(source.quality)) return qualityLabel(source.quality);
  const place = menus.sources.indexOf(index);
  return sourceName(source, place >= 0 ? place : index);
}

function pickersOf(media: NormalizedMedia, sourceIndex: number): Pick<PlayerState, "sources" | "quality"> {
  const all = sourcesOf(media);
  const menus = sourceMenus(all);
  const inQualities = menus.qualities.includes(sourceIndex);
  const levels = menus.qualities
    .filter((index) => !isAutoQuality(all[index]!.quality))
    .map((index) => {
      const name = all[index]!.quality!;
      const height = /^\d{3,4}p?$/.test(name) ? parseInt(name, 10) : /^2k$/i.test(name) ? 1440 : /^4k$/i.test(name) ? 2160 : undefined;
      return { id: FILE_QUALITY + index, label: qualityLabel(name), ...(height ? { height } : {}) };
    });
  return {
    ...(menus.sources.length > 1
      ? { sources: { labels: menus.sources.map((index, place) => sourceName(all[index]!, place)), current: Math.max(0, menus.sources.indexOf(inQualities ? 0 : sourceIndex)) } }
      : {}),
    ...(inQualities && levels.length > 0
      ? { quality: { levels, current: isAutoQuality(all[sourceIndex]!.quality) ? -1 : FILE_QUALITY + sourceIndex, ...(levels.length === menus.qualities.length ? { auto: false } : {}) } }
      : {}),
  };
}

interface Ending {
  ended: boolean;
  upNext?: { seconds: number | null } | undefined;
  skip?: { kind: "intro" | "recap" | "credits" } | undefined;
}

const withTvState = (state: PlayerState, captionStyle: CaptionStyle, media: NormalizedMedia | null, sourceIndex: number, subtitleDelay: number, ending: Ending, enhance: PlayerState["enhance"]): PlayerState => ({
  ...state,
  ...(enhance && state.state !== "idle" ? { enhance } : {}),
  ...(media && state.state !== "idle" ? { stream: media.stream.url } : {}),
  ...(media && state.state !== "idle" ? pickersOf(media, sourceIndex) : {}),
  fullscreen: Boolean(document.fullscreenElement),
  captionStyle,
  subtitleDelay,
  ...(ending.ended && state.state === "paused" ? { ended: true } : {}),
  ...(ending.upNext && state.state !== "idle" ? { upNext: ending.upNext } : {}),
  ...(ending.skip && state.state !== "idle" ? { skip: ending.skip } : {}),
});

function toPairing(info: { code: string; expiresInMs: number } | null): Pairing | null {
  return info ? { code: info.code, expiresAt: Date.now() + info.expiresInMs } : null;
}
