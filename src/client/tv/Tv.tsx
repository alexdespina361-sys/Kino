import { useEffect, useMemo, useRef, useState } from "react";
import {
  describeChange,
  episodeLabel,
  formatDelay,
  groupBySeason,
  IDLE_STATE,
  isSameEpisode,
  playingEpisodeName,
  previousEpisode,
  resolveCaptionStyle,
  seriesKeyOf,
  sourcesOf,
  stateIsFor,
  type CaptionStyle,
  type NormalizedMedia,
  type PartyCommand,
  type PartyView,
  type PlayableSource,
  type PlayerState,
} from "../../shared";
import { useAccount } from "../account/AccountProvider";
import { describeError } from "../account/errors";
import { profileStore, useProfileData } from "../account/store";
import { nameOf } from "../friends/entries";
import { useFriends } from "../friends/FriendsProvider";
import { t, useT } from "../i18n";
import { useEpisodeDetails } from "../shared/episodeDetails";
import { formatClock, readStorage, writeStorage } from "../shared/format";
import { readKept, writeKept } from "../shared/kept";
import { canFullscreen as offersFullscreen, enterFullscreen, entersAtFirstPress, toggleFullscreen, useLandscapeWhile } from "../shared/fullscreen";
import { Back10Icon, Forward10Icon, FullscreenIcon, MutedIcon, NextIcon, PauseIcon, PlayIcon, StopIcon, SubtitlesIcon, UsersIcon, VolumeIcon } from "../shared/icons";
import { readPartyCode } from "../shared/launch";
import { APP_NAME } from "../shared/Logo";
import { connectSocket, type Socket, type SocketStatus } from "../shared/socket";
import { useSlow, useWaking } from "../shared/useSlow";
import { friendlyError, noticeText, socketError } from "../shared/words";
import { TvAccount, type AccountView } from "./Account";
import { Captions } from "./Captions";
import { PlayerEngine } from "./engine";
import { pickInRows } from "./dpad";
import { HOLD_SPEED, isPicture, usePictureGestures, useTouchUi, type PointerKind, type Side } from "./gestures";
import { EndCard, ErrorCard, FollowStatus, hasTracks, Hud, isBlocked, isBusy, UP_NEXT_SECONDS } from "./Hud";
import { TvIdle, TvLocked, TvWelcome, type Pairing } from "./Idle";
import { keepPageFor, TvBrowse, type PlayOptions } from "./Browse";
import { actionForKey, partyCommandForKey, SKIP_SECONDS } from "./keys";
import { moveInMenu, TvMenu, type MenuKind } from "./Menu";
import { keepNativePlayerOut } from "./nativePlayer";
import { pressWhatOkPresses } from "./okPress";
import { PartyPage, PartyPanel } from "./Party";
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
/** The overlay fades out this long after the last key press, but only while a video is actually playing. */
const HUD_HIDE_MS = 2500;
/** ...and this much longer while the remote rests on one of its buttons. */
const HUD_HOLD_MS = 5000;
/** A lookup that never reports back (lost message, dead server) must not leave the TV spinning forever. */
const RESOLVING_TIMEOUT_MS = 45_000;
/** The video follows the end of a lookup straight away; if none has by then, the lookup failed. */
const NO_VIDEO_AFTER_LOOKUP_MS = 1500;
/** The end of a lookup and the video it found are two messages; the library is not shown again between them, so this long is waited for the second. */
const LOOKUP_END_GRACE_MS = 250;
/** Skips pressed within this long of each other count as one run in the "+30s" flash. */
const SKIP_RUN_MS = 1200;
/** A click that puts the controls away is not undone by the mouse settling for this long. */
const PUT_AWAY_QUIET_MS = 600;

export function Tv() {
  useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /** The link of a watch party (its QR code) was opened on this screen: its code is tried once the page is unlocked, then taken out of the address. */
  const [linkCode] = useState(() => readPartyCode(location.search));
  /**
   * A screen opens straight on the library; the first thing pressed there is the press the browser wants before it lets a page play
   * video with sound. Only a screen opened by a party's link starts locked: the host's video plays on it without anyone choosing
   * anything, so it asks for that press first.
   */
  const [unlocked, setUnlocked] = useState(!linkCode);
  /** The welcome over the library while it fills in, until it has faded. A party's link brings a guest straight to the party, not to a welcome. */
  const [welcoming, setWelcoming] = useState(!linkCode);
  /** The welcome waits for a press, with a button that goes full screen, when the first press would (a screen opened by a party's link was pressed already). */
  const [asksToEnter] = useState(() => !linkCode && entersAtFirstPress());
  /** Shown when the phone asked for full screen but the browser wants a press on the TV itself. */
  const [fsPrompt, setFsPrompt] = useState(false);
  /** Whether the page is full screen right now (a button says which way it goes). */
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  /** This screen's own sound, off or on: nobody else's business, so it is not in the state the phone sees, nor is it kept for next time. */
  const [muted, setMuted] = useState(false);
  const [connection, setConnection] = useState<SocketStatus>("connecting");
  const [paired, setPaired] = useState(false);
  const pairedRef = useRef(false);
  pairedRef.current = paired;
  /** The name of the TV this one watches along with. Such a TV plays what that one plays and has no controls of its own. */
  const [following, setFollowing] = useState<string | null>(null);
  const followingRef = useRef<string | null>(null);
  followingRef.current = following;
  /** The watch party this TV is in, as host or as guest, and when the code that lets others in stops working. */
  const [party, setParty] = useState<PartyView | null>(null);
  /** The host made this screen an admin: the film's playback is its to steer too (the host's screen carries it out for everyone, see TV_PARTY_CMD). */
  const admin = party?.role === "guest" && party.guests.some((guest) => guest.id === party.you && guest.admin === true);
  const [partyEnds, setPartyEnds] = useState<number | null>(null);
  /** Why the code just typed on the party page was refused. `id` changes with each refusal. */
  const [partyError, setPartyError] = useState<{ id: number; text: string } | null>(null);
  /** The code of a party a friend invited this TV to, which the party page opens on joining. */
  const [partyJoinWith, setPartyJoinWith] = useState<string | null>(null);
  /** The code an invitation or a link sent this TV to join with: if that is refused it is not a mistyped code but a party that is over. */
  const invitedWithRef = useRef<string | null>(null);
  /** A friend who asked to watch together: they are invited once the party this TV starts has a code. */
  const [together, setTogether] = useState<string | null>(null);
  /** This TV is leaving a party by choice, so being taken out of it a moment later is not news. */
  const leavingRef = useRef(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  /** Once a phone is connected: the code that lets another one in, while the page that shows it is open. */
  const [control, setControl] = useState<Pairing | null>(null);
  const [player, setPlayer] = useState<PlayerState>(IDLE_STATE);
  const [currentMedia, setCurrentMedia] = useState<NormalizedMedia | null>(null);
  const [resolving, setResolving] = useState(false);
  /** A lookup is under way (or has just ended), so its end with no video after it means it failed. */
  const wasResolvingRef = useRef(false);
  /** The wait (see `LOOKUP_END_GRACE_MS`) after the server said a lookup ended. */
  const lookupEndTimerRef = useRef(0);
  /** What was on when that lookup began: a lookup that ends with the same video still on has failed. */
  const mediaBeforeLookupRef = useRef<NormalizedMedia | null>(null);
  /** The next episode that was put on at once, from what was loaded ahead: its own lookup only confirms it, so that one failing says nothing. */
  const putOnAtOnceRef = useRef<NormalizedMedia | null>(null);
  /** Waiting for a picture (a lookup, loading, filling up) for too long: a way out is offered. */
  const stuck = useSlow(isBusy(player, resolving));
  /** The server has not answered for a while: say why that can be, instead of "Reconnecting…" alone. */
  const waking = useWaking(connection);

  // Netflix Up Next Countdown & Preload State
  const [upNextCountdown, setUpNextCountdown] = useState<number | null>(null);
  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const preloadedNextMediaRef = useRef<NormalizedMedia | null>(null);
  /** The video played to its end (anything that moves the picture on clears it). With nothing following by itself, the end card is shown. */
  const [ended, setEnded] = useState(false);

  // Audio / subtitles / speed / quality / episodes picker, and the watch party over a film (with its page for choosing the friends to invite)
  const [menu, setMenu] = useState<MenuKind | "party" | "partyInvite" | null>(null);
  /** The control that opened the menu, which gets the focus back when it closes, so Back never leaves the remote with nothing selected. */
  const openerRef = useRef<HTMLElement | null>(null);
  const openMenu = (kind: MenuKind | "party") => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && controlsRef.current?.contains(focused)) openerRef.current = focused;
    setMenu(kind);
  };
  /** What the TV shows while nothing plays: the library, the page for connecting a phone, or the watch party. */
  const [screen, setScreen] = useState<"library" | "connect" | "party">("library");
  const screenRef = useRef(screen);
  screenRef.current = screen;
  /** Said on the library when a title that was just chosen would not play. */
  const [notice, setNotice] = useState<string | null>(null);
  /** A line said over the library for a moment ("A phone is connected."). */
  const [flash, setFlash] = useState<{ id: number; text: string } | null>(null);
  const flashIdRef = useRef(0);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 4500);
    return () => clearTimeout(timer);
  }, [flash]);

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

  // Who is watching: the account page (sign in, profiles, settings) takes the place of the start screens, never of a video.
  const account = useAccount();
  const syncNowRef = useRef(account.syncNow);
  syncNowRef.current = account.syncNow; // (the phone can ask for it: devices of the account were signed out)
  const friends = useFriends();
  const friendsRef = useRef(friends);
  friendsRef.current = friends;
  const [accountView, setAccountView] = useState<AccountView | null>(null);
  /** Signed in, and nobody has been picked on this TV yet: that question comes first. */
  const choosing = account.status === "ready" && account.choosing;
  const accountPage: AccountView | null = player.state === "idle" ? (choosing ? "profiles" : accountView) : null;

  // What the profile in use has watched: it marks the episode list, and every few seconds of playback is added to it.
  const { watched, settings } = useProfileData();
  /** Whether the next episode follows by itself (the profile's choice); off, the Up Next card waits for OK. */
  const autoplay = settings.autoplayNext ?? true;
  /** Whether a tap or click on the picture pauses it (the profile's choice); off, it only shows or hides the controls. */
  const tapToPause = settings.tapToPause ?? false;
  useEffect(() => {
    // (A screen that watches along shows the host's video: it is the host's to continue, not an entry in this profile's row, with a place and an address that are the host's.)
    if (following || !currentMedia || (player.state !== "playing" && player.state !== "paused") || player.buffering || !stateIsFor(currentMedia, player)) return;
    profileStore.playbackAt(currentMedia, player);
  }, [player, currentMedia, following]);

  // Brief "+10s" flash after a skip, from the remote or the phone
  const [toast, setToast] = useState<{ id: number; text: string; notice?: boolean; side?: "back" | "forward" } | null>(null);
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
  /** What the phone is told about the end of the picture: that it came, and whether the next episode starts by itself (and in how long). */
  const endingRef = useRef<Ending>({ ended: false });
  endingRef.current = { ended, upNext: following || upNextCountdown === null ? undefined : { seconds: autoplay ? upNextCountdown : null } };

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
    const failed = sources[sourceIndexRef.current];
    notify(t("notice.sourceFailed", { from: failed ? sourceName(failed, sourceIndexRef.current) : t("notice.thatSource"), to: sourceName(sources[next]!, next) }));
    loadSource(next, false);
  }, [player.state]);

  const triggerNextEpisode = () => {
    if (followingRef.current) return; // the TV being followed picks what comes next
    setUpNextCountdown(null);
    setUpNextDismissed(false);
    setEnded(false);
    const preloaded = preloadedNextMediaRef.current;
    const nextUrl = currentMediaRef.current?.series?.next?.url;

    if (preloaded && nextUrl) {
      putOnAtOnceRef.current = preloaded;
      setCurrentMedia(preloaded);
      profileStore.playbackStarted(preloaded);
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
  /** Whether the controls are up or on their way up or down: what a tap should take them to be, a moment after the change (`visibleRef` is what has been drawn). */
  const upRef = useRef(true);
  const setUp = (up: boolean) => {
    upRef.current = up;
    setControlsVisible(up);
  };
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Paused, loading, failed, or a menu open: the overlay stays put.
  const stickyRef = useRef(false);
  stickyRef.current = player.state !== "playing" || menu !== null;

  /** When a tap last put the controls away: a mouse that is only settling after the click does not bring them straight back. */
  const putAwayAtRef = useRef(0);

  /** Show the overlay and start the countdown to hiding it again. */
  const wake = () => {
    setUp(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (stickyRef.current) return;
      if (controlsRef.current?.contains(document.activeElement)) {
        // The remote is resting on a button: whoever is choosing gets a little longer than whoever is just watching.
        hideTimerRef.current = setTimeout(() => {
          if (!stickyRef.current) setUp(false);
        }, HUD_HOLD_MS);
      } else {
        setUp(false);
      }
    }, HUD_HIDE_MS);
  };

  /** Put the overlay away now (a tap on the picture), unless something needs it: a menu is open, or the picture is neither playing nor held. */
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

  // A hidden overlay must not keep keyboard focus, or OK would press a button nobody can see.
  // Down on a hidden one wakes it and lands on its first button, which can only be focused once it shows (see `focusControls`).
  const focusPendingRef = useRef(false);
  /** The last step the arrows made between rows of the controls, so a step back lands where it came from. */
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

  // A closed menu hands the focus back to the button that opened it (if that is still there to take it).
  useEffect(() => {
    if (menu !== null) return;
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected && controlsRef.current?.contains(opener)) opener.focus();
  }, [menu]);

  // A control that a hand pressed (a mouse, a finger) does not keep the focus: the focus on the controls is the remote's, and it changes what the keys do
  // (the arrows walk the buttons instead of skipping, OK presses that button again instead of pausing). A key that clicks a button has no click count.
  // Before the button's own handler (capture), so a menu it opens has no focused opener to hand the focus back to, and while its icon is still there to be found.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.detail === 0 || !(event.target instanceof Element)) return;
      const button = event.target.closest("button");
      if (button && controlsRef.current?.contains(button)) button.blur();
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  // OK presses the button that has the focus even where the browser does not (see okPress.ts).
  useEffect(() => pressWhatOkPresses(), []);

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
    setToast({ id: toastIdRef.current, text: t("notice.delay", { value: formatDelay(clamped) }) });
  };
  useEffect(() => republishRef.current(), [captionStyle, subtitleDelay]); // the phone's sheet shows what the TV really uses
  const streamUrl = currentMedia?.stream.url;
  useEffect(() => republishRef.current(), [streamUrl, sourceIndex]); // a state names its media and source, and those can change without the video doing so
  useEffect(() => republishRef.current(), [ended, upNextCountdown, autoplay, following]); // the phone follows the end of the picture and the countdown to the next episode

  useEffect(() => {
    if (player.state === "idle") resetApplied();
    if (player.state !== "paused") setEnded(false); // the end card lasts as long as the picture stays on the last frame
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
    setToast({ id: toastIdRef.current, text: `${run.total > 0 ? "+" : "−"}${Math.abs(run.total)}s`, side: run.total > 0 ? "forward" : "back" });
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
    const change = describeChange(lastPlayerRef.current, player, noticeText);
    lastPlayerRef.current = player;
    if (change && !followingRef.current) notify(change); // a follower is nudged in speed all the time; that is not news
  }, [player]);

  /* ------------------------------ wiring ------------------------------ */

  useEffect(() => {
    const video = videoRef.current!;
    const publish = (state: PlayerState) => {
      const full = withTvState(state, captionStyleRef.current, currentMediaRef.current, sourceIndexRef.current, subtitleDelayRef.current, endingRef.current);
      setPlayer(full);
      if (!followingRef.current) socketRef.current?.send({ type: "TV_STATE", state: full }); // a follower has no phone to tell
    };
    // The leader's last position was this long ago (see TV_SYNC); a jump too soon after another would only chase a picture still filling.
    let lastSeekAt = 0;
    const engine = new PlayerEngine(
      video,
      publish,
      () => {
        // The next episode follows (the Up Next card counts down), or there is nothing after this and the end card says so.
        if (followingRef.current) return; // a screen that watches along waits for what the host does
        if (currentMediaRef.current?.series?.next && !upNextDismissedRef.current) {
          setUpNextCountdown((prev) => (prev !== null && prev <= 5 ? prev : 5));
        }
        setMenu(null);
        setEnded(true);
      },
    );
    engineRef.current = engine;
    republishRef.current = () => publish(engine.getState());

    // Only the first hello of this page says it has just been opened: a socket that reconnects, or says hello again when the page comes back to the front, belongs to a page that has been on.
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
            setParty(null); // a party this TV is in is sent right after
            setPartyEnds(null);
            if (!message.following) {
              const media = currentMediaRef.current;
              // (What it has on goes along, for a server that has forgotten: see `TV_STATE.media`.)
              socketRef.current?.send({
                type: "TV_STATE",
                state: withTvState(engine.getState(), captionStyleRef.current, media, sourceIndexRef.current, subtitleDelayRef.current, endingRef.current),
                ...(media ? { media } : {}),
              });
            }
            break;
          case "TV_CODE":
            if (message.control) setControl(toPairing(message.pairing));
            else setPairing(toPairing(message.pairing));
            break;
          case "TV_PAIRED":
            // The first phone changes the page by itself; one that joins later (or any, over the library) is told in a line.
            if (pairedRef.current || screenRef.current === "library") setFlash({ id: ++flashIdRef.current, text: t("tv.phoneJoined") });
            setPaired(true);
            setPairing(null);
            break;
          case "TV_FOLLOWING":
            // A party took this TV in (a phone added it, or its code was typed here): what this TV was doing stops, and the video comes from the host.
            followingRef.current = message.leader;
            invitedWithRef.current = null;
            setPaired(true);
            setPairing(null);
            setFollowing(message.leader);
            setPartyError(null);
            wasResolvingRef.current = false;
            setResolving(false);
            setMenu(null);
            if (currentMediaRef.current) {
              setCurrentMedia(null);
              engine.stop();
            }
            break;
          case "TV_PARTY":
            setParty(message.party);
            setPartyEnds(message.party?.code ? Date.now() + message.party.code.expiresInMs : null);
            break;
          case "ERROR": {
            // Mostly a party code that would not do (wrong, out of date, a full party): said on the party page, or over the library.
            // (One that an invitation or a link brought was good when the friend made it: that it is refused now means the party is over. That is said over the friends' page,
            // which is looked at again: the invitation is a question there now, whether to ask for another.)
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
            // The phone forgot this TV (it already told us to STOP), or the party ended or sent it away: back to showing a fresh code.
            if (followingRef.current && !leavingRef.current) setFlash({ id: ++flashIdRef.current, text: t("party.ended") });
            leavingRef.current = false;
            setPaired(false);
            setFollowing(null);
            setPairing(toPairing(message.pairing));
            wasResolvingRef.current = false; // a lookup cut short by this is not a failed one
            setResolving(false);
            setMenu(null);
            break;
          case "TV_RESOLVING":
            window.clearTimeout(lookupEndTimerRef.current);
            if (message.active) setResolving(true);
            else lookupEndTimerRef.current = window.setTimeout(() => setResolving(false), LOOKUP_END_GRACE_MS);
            break;
          case "TV_CMD": {
            const { command } = message;
            if (command.type === "LOAD") {
              window.clearTimeout(lookupEndTimerRef.current);
              wasResolvingRef.current = false; // a video followed the lookup, so it did not fail (and stopping it a moment later is not that)
              setResolving(false);
              keepPageFor(command.media.page); // the library comes back to a show's page only if it is that show that plays
              const current = currentMediaRef.current;
              const isSameStream = current?.stream.url === command.media.stream.url;

              if (isSameEpisode(current, command.media) || isSameStream) {
                setCurrentMedia(command.media);
                return;
              }

              setCurrentMedia(command.media);
              if (!followingRef.current) profileStore.playbackStarted(command.media); // it moves to the front of "Continue watching" at once (not for a screen that watches along)
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
            else if (command.type === "DISMISS_UP_NEXT") dismissUpNext();
            else if (command.type === "REFRESH_ACCOUNT") syncNowRef.current();
            // Anything the phone does should be visible on the TV for a moment.
            if (command.type !== "LOAD" && command.type !== "STOP" && command.type !== "REFRESH_ACCOUNT") wake();
            break;
          }
        }
      },
    });
    socketRef.current = socket;

    // The phone shows whether the TV is full screen, so tell it whenever that changes (Esc, the HUD button, the OK prompt).
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

  // Safety net for TV_RESOLVING { active: true } without a matching end.
  useEffect(() => {
    if (!resolving) return;
    const timer = setTimeout(() => setResolving(false), RESOLVING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [resolving]);

  // The server only tells a phone when a lookup fails; here the end of the lookup with no video following it is the tell.
  useEffect(() => {
    if (resolving) {
      if (!wasResolvingRef.current) mediaBeforeLookupRef.current = currentMediaRef.current;
      wasResolvingRef.current = true;
      setNotice(null);
      return;
    }
    if (!wasResolvingRef.current) return;
    wasResolvingRef.current = false;
    const before = mediaBeforeLookupRef.current;
    const timer = setTimeout(() => {
      if (currentMediaRef.current !== before || (before && before === putOnAtOnceRef.current)) return; // a video followed (or was on already)
      if (!before) return setNotice(t("notice.wouldntPlay"));
      // Something was on when the pick was made (an episode chosen from the player, the next one): it carries on, or if it had ended its end card comes back, and a line says why nothing changed.
      if (videoRef.current?.ended) {
        setEnded(true);
        setFlash({ id: ++flashIdRef.current, text: t("notice.wouldntPlay") }); // (the controls, and their lines, give way to the end card)
      } else notify(t("notice.wouldntPlay"));
    }, NO_VIDEO_AFTER_LOOKUP_MS);
    return () => clearTimeout(timer);
  }, [resolving]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    notify(t(video.muted ? "notice.muted" : "notice.unmuted"));
  };

  /** Phones in some browsers (iPhone's) have no full screen to offer a page, and then no button for it either. (The first press on a screen takes it full screen by itself: see `setUpFullscreen`.) */
  const canFullscreen = offersFullscreen();
  /**
   * From the phone. Leaving is always allowed; going in is refused unless the TV page just got a click or key press,
   * so then the TV asks for one (OK on its remote) instead of failing without a word.
   */
  const fullscreenFromPhone = () => {
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
    if (!canFullscreen) return; // (a browser that is never asked: see fullscreen.ts)
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

  // Up Next Countdown interval. A profile that plays the next episode only on request gets the card without a countdown.
  // The count waits while the picture is paused or filling: it is the end of the episode that it counts down to.
  const countingDown = player.state === "playing" || ended;
  useEffect(() => {
    if (upNextCountdown === null || !autoplay) return;
    if (upNextCountdown <= 0) {
      triggerNextEpisode();
      return;
    }
    if (!countingDown) return;
    const timer = setTimeout(() => {
      setUpNextCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [upNextCountdown, autoplay, countingDown]);

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
      setUpNextCountdown(Math.min(UP_NEXT_SECONDS, Math.max(1, Math.ceil(player.duration - player.currentTime)))); // never more than is left
    }
  }, [player.currentTime, player.duration, player.state, currentMedia?.series?.next, following, upNextDismissed, upNextCountdown]);

  // Winding back to before its time takes the card away (it comes again on the way to the end), and turning it down is for this pass
  // only: wind back to well before its time (or watch again) and it comes again.
  useEffect(() => {
    if (player.duration <= 0 || ended) return;
    if (upNextCountdown !== null && player.currentTime < player.duration - UP_NEXT_SECONDS - 1) setUpNextCountdown(null);
    if (upNextDismissed && player.currentTime < player.duration - UP_NEXT_SECONDS - 5) setUpNextDismissed(false);
  }, [player.currentTime, player.duration, upNextDismissed, upNextCountdown, ended]);

  // Ask for a fresh code when the displayed one expires
  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(
      () => socketRef.current?.send({ type: "TV_NEW_CODE" }),
      Math.max(0, pairing.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pairing]);

  // The page of a TV with a phone shows the code that lets another phone in. Asking for it is what keeps it good, so it is asked for
  // while that page is open and again well before it runs out; when the page closes the code is forgotten.
  const showsControl = unlocked && paired && !following && !resolving && !accountPage && screen === "connect" && player.state === "idle";
  useEffect(() => {
    if (!showsControl) return setControl(null);
    if (connection !== "open") return;
    const timer = setTimeout(() => socketRef.current?.send({ type: "TV_NEW_CODE" }), control ? Math.max(1000, (control.expiresAt - Date.now()) / 2) : 0);
    return () => clearTimeout(timer);
  }, [showsControl, connection, control]);

  /* ----------------------------- watch party ----------------------------- */

  // What this screen is called on a party's list: the profile in use, else the TV's own name (the empty name).
  const profileName = account.me && account.profile ? account.profile.name : "";
  useEffect(() => {
    if (connection === "open") socketRef.current?.send({ type: "TV_NAME", name: profileName });
  }, [connection, profileName]);

  const linkTriedRef = useRef(false);
  useEffect(() => {
    if (!linkCode || !unlocked || connection !== "open" || linkTriedRef.current) return;
    linkTriedRef.current = true;
    history.replaceState(null, "", location.pathname);
    invitedWithRef.current = linkCode;
    socketRef.current?.send({ type: "TV_PARTY_JOIN", code: linkCode });
  }, [linkCode, unlocked, connection]);

  // The code that lets others into a party lasts ten minutes. While it is on screen it is renewed; a party nobody came to goes away with it.
  const partyShown = menu === "party" || menu === "partyInvite" || (screen === "party" && player.state === "idle");
  // The page for choosing friends belongs to a party this screen hosts, with a code to tell them: without that (the party ended) it is the panel again.
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
  /** A friend asked to watch together: a party is started (the one that is on carries on) and they are invited to it as soon as it has a code. */
  const startTogether = (friend: string) => {
    setPartyError(null);
    setPartyJoinWith(null);
    invitedWithRef.current = null;
    setTogether(friend);
    setScreen("party");
    startParty();
  };
  useEffect(() => {
    // (A code this screen still shows but that has run out is not used: the renewal that is on its way brings a new one, and this looks again.)
    if (!together || party?.role !== "host" || !party.code || (partyEnds ?? 0) <= Date.now()) return;
    setTogether(null);
    const code = party.code;
    const current = friendsRef.current;
    const name = nameOf(current.state?.friends ?? [], together);
    void current.send([together], { kind: "party", code: code.code, endsAt: partyEnds ?? Date.now() + code.expiresInMs }).then(
      async (answer) => {
        account.say(answer.sent.length > 0 ? t("friends.inviteSent", { names: name }) : t("friends.declined", { names: name }));
        await friendsRef.current.refresh(); // (the server takes the request away once they are invited)
      },
      (error: unknown) => account.say(describeError(error)),
    );
  }, [together, party, partyEnds]);
  const joinParty = (code: string) => {
    setPartyJoinWith(null); // (an invitation's code is used once: the next time the page asks for a code it starts empty)
    socketRef.current?.send({ type: "TV_PARTY_JOIN", code });
  };
  const removeFromParty = (id: string) => void socketRef.current?.send({ type: "TV_PARTY_REMOVE", id });
  const setAdmin = (id: string, on: boolean) => void socketRef.current?.send({ type: "TV_PARTY_ADMIN", id, admin: on });
  const steer = (command: PartyCommand) => void socketRef.current?.send({ type: "TV_PARTY_CMD", command });
  const endParty = () => void socketRef.current?.send({ type: "TV_PARTY_CLOSE" });
  // Being made an admin shows the buttons that come with it.
  useEffect(() => {
    if (admin) wake();
  }, [admin]);

  /* --------------------------- remote control --------------------------- */

  const togglePlay = () => (player.state === "playing" ? engineRef.current?.pause() : engineRef.current?.play());
  const dismissUpNext = () => {
    setUpNextCountdown(null);
    setUpNextDismissed(true);
  };
  /**
   * Pick an episode from the list, or a title from the library: the server looks it up like any link, the TV shows the spinner
   * meanwhile. `startAt` resumes a title left unfinished; `hint` carries the picture and year the library already knows.
   */
  const playEpisode = (url: string, options: PlayOptions = {}) => {
    setMenu(null);
    setUpNextCountdown(null);
    setUpNextDismissed(false);
    socketRef.current?.send({ type: "TV_PLAY_URL", url, ...(options.startAt ? { startAt: options.startAt } : {}), ...(options.hint ? { hint: options.hint } : {}) });
  };
  /** A TV that watches along stops, and goes back to being on its own. */
  const leaveParty = () => {
    leavingRef.current = true;
    setMenu(null);
    engineRef.current?.stop();
    setCurrentMedia(null);
    socketRef.current?.send({ type: "TV_UNPAIR" });
  };
  /** Stop what plays and go back to the library. A host that does takes the video from its guests too (the server tells them). */
  const stopPlayback = () => {
    setCurrentMedia(null);
    setUpNextCountdown(null);
    engineRef.current?.stop();
  };
  /** The next subtitle track, and off after the last. Works for a TV that watches along too: what is read is its own choice. */
  const cycleSubtitles = () => {
    const subtitles = playerRef.current.subtitles;
    if (subtitles && subtitles.tracks.length > 0) chooseSubtitle(subtitles.current + 1 >= subtitles.tracks.length ? -1 : subtitles.current + 1);
  };
  /**
   * Whoever is at the TV stopped waiting for a video that will not start (a lookup that never answers, a stream that never loads):
   * it is forgotten, the TV is back where it was, and the server drops a late answer instead of starting the film after all.
   * A TV that watches along only stops looking at the wait; what plays is up to the TV it follows.
   */
  const cancelLoad = () => {
    wasResolvingRef.current = false; // giving up is not a lookup that failed: no "wouldn't play" notice
    setResolving(false);
    setCurrentMedia(null);
    setUpNextCountdown(null);
    setMenu(null);
    engineRef.current?.stop();
    if (!followingRef.current) socketRef.current?.send({ type: "TV_CANCEL" });
  };
  const goToPrevious = () => {
    const previous = previousEpisode(currentMediaRef.current?.series);
    if (previous) playEpisode(previous.url);
  };

  /** The video is over and nothing follows it by itself: the end card is up. */
  const finished = ended && !following && !resolving && upNextCountdown === null && player.state === "paused" && player.duration > 0 && player.currentTime >= player.duration - 1.5;
  /** Once more from the start. */
  const watchAgain = () => {
    setEnded(false);
    engineRef.current?.seek(0);
    engineRef.current?.play();
  };

  /** Every source of the video has failed (a failing one hands over to the next, which is not yet a failure): the controls are of no use, so a card with a way on takes their place. */
  const untriedSource = currentMedia ? sourcesOf(currentMedia).some((_, index) => !triedSourcesRef.current.has(index)) : false;
  const failed = player.state === "error" && !isBlocked(player) && !following && !resolving && !untriedSource;
  useEffect(() => {
    if (failed) setMenu(null);
  }, [failed]);
  /** From the first source again, as the first time: a failure is sometimes only a bad moment. */
  const retryPlayback = () => {
    const source = currentMedia ? sourcesOf(currentMedia)[0] : undefined;
    if (!source) return;
    resetApplied();
    resetSources();
    void engineRef.current?.load(source.stream.url, source.stream.type, source.subtitles);
    engineRef.current?.play();
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

      if (accountPage) return; // the account pages walk and close themselves (Account.tsx)

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
        // The end card and the error card walk their own buttons and leave on Back (see EndCard, ErrorCard); full screen is still the page's.
        if (action === "fullscreen") toggleFullscreen();
        return;
      }

      if (menu) {
        // The picker owns the keys; OK presses the focused option itself.
        if (action === "back") setMenu(menu === "captions" ? "tracks" : menu === "partyInvite" ? "party" : null); // the caption style is a page of the audio and subtitles menu, the friends to invite a page of the party's
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

      // Waiting for a video: the library and the other pages walk their own buttons (see Browse.tsx, Idle.tsx).
      if (!engine || player.state === "idle") return;

      // A video that will not start: OK or Back gives up on it, whether or not the controls are up.
      if (stuck && !following && (action === "select" || action === "back")) {
        cancelLoad();
        event.preventDefault();
        return;
      }

      const row = controlsRef.current;
      const focused = document.activeElement as HTMLElement | null;
      if (row && focused && row.contains(focused)) {
        if (action === "left" || action === "right" || action === "up" || action === "down") {
          // The arrows walk the controls the way they are laid out: along a row, and between rows. Past the edge nothing moves,
          // except out of the controls, which is the way the bar lies (up from the player's, down from a follower's at the top).
          const buttons = [...row.querySelectorAll<HTMLElement>("button:not(:disabled)")];
          let next = buttons[pickInRows(buttons.map((button) => button.getBoundingClientRect()), buttons.indexOf(focused), action)];
          const vertical = action === "up" || action === "down";
          // Down and straight back Up (or the other way) returns to the button it left, not to the one nearest above it.
          const left = lastStepRef.current;
          if (next && vertical && left && left.to === focused && left.action !== action && buttons.includes(left.from)) next = left.from;
          lastStepRef.current = next && vertical ? { from: focused, to: next, action } : null;
          if (next) next.focus();
          else if (action === (following ? "down" : "up")) focused.blur();
          event.preventDefault();
          return;
        }
        if (action === "back") {
          focused.blur();
          event.preventDefault();
          return;
        }
        if (action === "select") return; // press the focused button
      }

      if (following) {
        // Watching along: no playback keys (the host has them), just the buttons on the bar (Down, then OK), subtitles and full screen.
        // The one exception is the press the browser wants before it plays: OK is that, and starts the video.
        // An admin has the playback keys too: they ask the host's screen, which does it for everyone.
        const steering = admin ? partyCommandForKey(action, player.state === "playing", Boolean(currentMedia?.series?.next)) : null;
        if (isBlocked(player) && (action === "select" || action === "playpause" || action === "play")) engine.play();
        else if (steering) steer(steering);
        else if (action === "up" || action === "down") (controlsRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? controlsRef.current?.querySelector<HTMLElement>("button"))?.focus(); // the bar is at the top, yet Down was always the way in
        else if (action === "captions") cycleSubtitles();
        else if (action === "mute") toggleMute();
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
          focusControls(); // wakes the overlay too, and lands on its first button
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
          // Back leaves the video for the library: the first press shows the controls, a second one leaves.
          if (overlayWasVisible) stopPlayback();
          break;
        default: // "up": nothing to do beyond showing the overlay
          break;
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [unlocked, player, upNextCountdown, currentMedia?.series?.next, menu, paired, resolving, fsPrompt, following, admin, accountPage, stuck, finished, failed]);

  // The welcome belongs to the library: whatever takes the screen over (a phone sent something to play, a party, a page) ends it.
  const libraryShows = player.state === "idle" && !accountPage && !resolving && !following && screen === "library";
  useEffect(() => {
    if (!libraryShows) setWelcoming(false);
  }, [libraryShows]);

  /* ------------------------------ the picture under a hand ------------------------------ */

  const showVideo = player.state !== "idle";

  /** A finger is held on the picture and it plays faster for as long as it stays. */
  const [boosting, setBoosting] = useState(false);
  const holdPicture = (): boolean => {
    const engine = engineRef.current;
    if (!engine || playerRef.current.state !== "playing") return false; // (a hold means nothing to a picture that is not moving)
    if (party?.role === "host" && party.guests.length > 0) return false; // (nor to one that others follow: they would be told the speed that was chosen, and fall behind)
    engine.boost(HOLD_SPEED);
    setBoosting(true);
    return true;
  };
  const releasePicture = () => {
    engineRef.current?.unboost();
    setBoosting(false);
  };
  useEffect(() => {
    if (boosting && player.state !== "playing") releasePicture(); // the picture stopped, or ended, under the finger
  }, [boosting, player.state]);

  /**
   * One tap or click on the picture: it shows or hides the controls. (With the profile's choice it pauses and plays instead, as a click
   * always did; then a finger on controls that are away only brings them up, so reaching for them does not pause the film.)
   */
  const tapPicture = (kind: PointerKind, wasVisible: boolean) => {
    if (!tapToPause) return wasVisible ? hideControls() : wake();
    wake();
    if (kind === "mouse" || wasVisible) togglePlay();
  };
  /** Two taps in a row: a side skips that way (and shows nothing of the controls, as the two buttons under it would), the middle goes full screen. */
  const doubleTapPicture = (side: Side) => {
    if (side !== "middle") skip(side === "back" ? -SKIP_SECONDS : SKIP_SECONDS);
    else if (canFullscreen) toggleFullscreen();
  };

  /** Whether a hand's taps on the picture are the picture's: a video, with nobody's card or menu over it, and nobody else's to control. */
  const takesTaps = unlocked && showVideo && !following && !finished && !failed && menu === null;
  const picture = usePictureGestures({
    enabled: takesTaps,
    source: currentMedia?.stream.url ?? "",
    controlsUp: () => upRef.current,
    actions: { tap: tapPicture, doubleTap: doubleTapPicture, hold: holdPicture, release: releasePicture },
  });
  const touch = useTouchUi();

  // Full screen on a phone is landscape for as long as a video is on, and the phone is let go of the moment it is not (nor is it held for the card at a film's end).
  useLandscapeWhile(fullscreen && showVideo && !finished);

  // Series details
  const series = currentMedia?.series;
  const next = series?.next;
  const previous = previousEpisode(series);
  const rawTitle = currentMedia?.title || APP_NAME;
  const mainTitle = series && rawTitle.includes("·") ? rawTitle.split("·")[0]!.trim() : rawTitle;
  // What the episode is called, asked of the library the way the Episodes list asks (by the first episode of its season), so the two share one answer.
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
      onMouseMove={() => {
        // (The browser's echo of a finger is no mouse, and nor is one that is only settling after the click that put the controls away.)
        if (picture.echoOfTouch() || Date.now() - putAwayAtRef.current < PUT_AWAY_QUIET_MS) return;
        wake();
      }}
      onClick={(event) => {
        if (!(takesTaps && isPicture(event.target))) return wake();
        if (typeof PointerEvent === "undefined") tapPicture("mouse", upRef.current); // (a browser from before pointer events sends the click and nothing else)
      }}
      onPointerDown={picture.onPointerDown}
      onDoubleClick={(event) => {
        if (isPicture(event.target) && picture.kindRef.current === "mouse") toggleFullscreen(); // (a finger's double tap was dealt with already)
      }}
      onContextMenu={(event) => {
        if (isPicture(event.target) && picture.kindRef.current === "touch") event.preventDefault(); // (a hold is no request for a menu)
      }}
    >
      <video ref={videoRef} className="tv-video" data-picture preload="auto" style={{ display: showVideo ? "block" : "none" }} playsInline />

      {showVideo && menu !== "captions" && <Captions videoRef={videoRef} style={captionStyle} delay={subtitleDelay} />}

      {/* Only a party's link starts here. Pressing OK is also the first press, which takes the page full screen. */}
      {!unlocked && <TvLocked onUnlock={() => setUnlocked(true)} />}

      {unlocked && !showVideo && !accountPage && (resolving || (screen === "connect" && !following)) && (
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

      {unlocked && !showVideo && !accountPage && !resolving && (following || screen === "party") && (
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

      {unlocked && !showVideo && !accountPage && !resolving && !following && screen === "library" && (
        <TvBrowse
          onPlay={playEpisode}
          onAccount={() => setAccountView(account.me ? "panel" : "signin")}
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
        />
      )}

      {unlocked && accountPage && <TvAccount view={accountPage} forced={choosing} onView={setAccountView} />}

      {unlocked && account.message && (
        <p className="tv-toast" role="status" key={account.message.id} data-testid="tv-account-toast">
          {account.message.text}
        </p>
      )}

      {unlocked && (!showVideo || finished) && flash && (
        <p className="tv-toast" role="status" key={`flash-${flash.id}`} data-testid="tv-flash">
          {flash.text}
        </p>
      )}

      {unlocked && showVideo && following && <FollowStatus player={player} onPlay={() => engineRef.current?.play()} />}

      {unlocked && showVideo && following && (
        <div className="tv-follow" ref={controlsRef}>
          <div className="tv-follow-bar" data-testid="tv-follow-bar">
            <span>
              {t("tv.following", { name: following })}
              {player.state === "paused" && !(player.duration > 0 && player.currentTime >= player.duration - 1.5) && ` · ${t("hud.paused")}`}
            </span>
            {hasTracks(player) && (
              <button onClick={() => openMenu("tracks")} data-testid="tv-audio-sub-btn">
                <SubtitlesIcon /> {t("player.audioSubtitles")}
              </button>
            )}
            <button onClick={toggleMute} aria-pressed={muted} data-testid="tv-mute-btn">
              {muted ? <MutedIcon /> : <VolumeIcon />} {t(muted ? "hud.unmute" : "hud.mute")}
            </button>
            <button onClick={() => openMenu("party")} data-testid="tv-party-btn">
              <UsersIcon /> {party ? t("party.size", { count: party.guests.length + 1 }) : t("party.rail")}
            </button>
            {canFullscreen && (
              <button onClick={toggleFullscreen} data-testid="tv-fullscreen-btn">
                <FullscreenIcon /> {t(fullscreen ? "remote.exitFullscreen" : "remote.fullscreen")}
              </button>
            )}
            <button onClick={leaveParty} data-testid="tv-leave">
              {t("tv.leave")}
            </button>
          </div>
          {/* An admin steers the film: these ask the host's screen, which does it for everyone (this one follows it, as always). */}
          {admin && (
            <div className="tv-follow-bar tv-follow-admin" data-testid="tv-admin-bar" role="group" aria-label={t("party.admin")}>
              <button onClick={() => steer({ type: "SKIP", seconds: -SKIP_SECONDS })} title={t("hud.backTip", { n: SKIP_SECONDS })} aria-label={t("hud.back", { n: SKIP_SECONDS })} data-testid="tv-admin-back">
                <Back10Icon />
              </button>
              <button
                onClick={() => steer({ type: player.state === "playing" ? "PAUSE" : "PLAY" })}
                title={t("hud.playTip")}
                aria-label={t(player.state === "playing" ? "hud.pause" : "hud.play")}
                data-testid="tv-admin-play"
                data-autofocus
              >
                {player.state === "playing" ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button onClick={() => steer({ type: "SKIP", seconds: SKIP_SECONDS })} title={t("hud.forwardTip", { n: SKIP_SECONDS })} aria-label={t("hud.forward", { n: SKIP_SECONDS })} data-testid="tv-admin-forward">
                <Forward10Icon />
              </button>
              {next && (
                <button onClick={() => steer({ type: "NEXT_EPISODE" })} title={t("hud.nextTip")} aria-label={`${t("hud.nextEpisode")}: ${episodeLabel(next)}`} data-testid="tv-admin-next">
                  <NextIcon />
                </button>
              )}
              <button onClick={() => steer({ type: "STOP" })} title={t("hud.stopTip")} aria-label={t("hud.stop")} data-testid="tv-admin-stop">
                <StopIcon />
              </button>
            </div>
          )}
        </div>
      )}

      {unlocked && showVideo && finished && (
        <EndCard
          title={mainTitle}
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
          title={mainTitle}
          message={friendlyError(player.error)}
          onRetry={retryPlayback}
          onLibrary={() => {
            stopPlayback();
            setScreen("library");
          }}
        />
      )}

      {unlocked && showVideo && !following && !finished && !failed && (
        <Hud
          visible={controlsVisible && menu !== "captions"}
          player={player}
          title={mainTitle}
          subTitle={series ? t("player.seasonEpisode", { season: series.season, episode: series.episode }) : ""}
          badge={series ? `S${series.season}:E${series.episode}` : ""}
          episodeName={episodeTitle}
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
                  seconds: autoplay ? upNextCountdown : null,
                  label: next.title || t("player.seasonEpisode", { season: next.season, episode: next.episode }),
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
          onOpenMenu={openMenu}
          partySize={party ? party.guests.length + 1 : 0}
          onParty={() => openMenu("party")}
          muted={muted}
          onMute={toggleMute}
          onFullscreen={canFullscreen ? toggleFullscreen : null}
          onStop={stopPlayback}
          stuck={stuck}
          onCancel={cancelLoad}
          touch={touch}
          boosting={boosting}
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
          <FullscreenIcon /> {t("tv.fsPrompt")}
        </button>
      )}

      {unlocked && connection !== "open" && (
        <div className="tv-banner" data-testid="tv-banner">
          {connection === "replaced" ? t("tv.bannerReplaced") : waking ? t("server.waking") : connection === "connecting" ? t("tv.connecting") : t("tv.bannerReconnecting")}
        </div>
      )}

      {unlocked && welcoming && <TvWelcome ask={asksToEnter} onDone={() => setWelcoming(false)} />}
    </main>
  );
}

/** What a source is called on screen: the name it came with, or its place in the list. */
const sourceName = (source: PlayableSource, index: number) => source.label ?? t("player.sourceN", { n: index + 1 });

/** What the TV knows that the video doesn't: which media this is, whether it is full screen, and how subtitles look. */
/** The end of the picture, as the TV knows it: it played to the end, and the next episode is counting down (null: it waits to be asked for). */
interface Ending {
  ended: boolean;
  upNext?: { seconds: number | null } | undefined;
}

const withTvState = (state: PlayerState, captionStyle: CaptionStyle, media: NormalizedMedia | null, sourceIndex: number, subtitleDelay: number, ending: Ending): PlayerState => ({
  ...state,
  ...(media && state.state !== "idle" ? { stream: media.stream.url } : {}),
  ...(media && state.state !== "idle" && sourcesOf(media).length > 1
    ? { sources: { labels: sourcesOf(media).map(sourceName), current: sourceIndex } }
    : {}),
  fullscreen: Boolean(document.fullscreenElement),
  captionStyle,
  subtitleDelay,
  ...(ending.ended && state.state === "paused" ? { ended: true } : {}),
  ...(ending.upNext && state.state !== "idle" ? { upNext: ending.upNext } : {}),
});

function toPairing(info: { code: string; expiresInMs: number } | null): Pairing | null {
  return info ? { code: info.code, expiresAt: Date.now() + info.expiresInMs } : null;
}
