import type { ReactNode } from "react";
import type { Command, NormalizedMedia, PlayerState, TvInfo } from "../../shared";
import { friendlyError, hostOf } from "../shared/format";
import {
  Back10Icon,
  ChevronIcon,
  Forward10Icon,
  FullscreenIcon,
  LinkIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
  SubtitlesIcon,
} from "../shared/icons";
import { SeekBar } from "./SeekBar";

export type SheetKind = "link" | "menu" | "tracks" | "speed" | "quality" | "episodes";

interface RemoteProps {
  tv: TvInfo;
  /** The phone is connected to the server and the TV is connected to the server. */
  online: boolean;
  media: NormalizedMedia;
  player: PlayerState;
  send: (command: Command) => void;
  onStop: () => void;
  onNext: () => void;
  onOpen: (sheet: SheetKind) => void;
}

function stateLabel(player: PlayerState, tvName: string): string {
  if (player.state === "error") return friendlyError(player.error);
  if (player.state === "loading") return "Loading…";
  if (player.buffering) return "Buffering…";
  if (player.state === "playing") return `Playing on ${tvName}`;
  if (player.state === "paused") return "Paused";
  return "";
}

function Chip({ icon, label, value, onClick, testId }: { icon?: ReactNode; label: string; value: string; onClick: () => void; testId: string }) {
  return (
    <button className="chip" onClick={onClick} data-testid={testId}>
      {icon}
      <span className="chip-text">
        <small>{label}</small>
        <b>{value}</b>
      </span>
      <ChevronIcon />
    </button>
  );
}

/** The remote: what's playing, a seek bar, transport buttons, and the extras that apply to this video. */
export function Remote({ tv, online, media, player, send, onStop, onNext, onOpen }: RemoteProps) {
  const series = media.series;
  const rawTitle = media.title ?? hostOf(media.stream.url) ?? media.stream.url;
  const title = series && rawTitle.includes("·") ? rawTitle.split("·")[0]!.trim() : rawTitle;
  const playing = player.state === "playing";
  const busy = player.state === "loading" || (player.state !== "error" && Boolean(player.buffering));

  const subtitleName = player.subtitles
    ? (player.subtitles.tracks.find((track) => track.id === player.subtitles?.current)?.label ?? "Off")
    : "";
  const hasTracks = Boolean(player.subtitles?.tracks.length) || (player.audio?.tracks.length ?? 0) > 1;
  const qualityName =
    player.quality && player.quality.current !== -1
      ? (player.quality.levels.find((level) => level.id === player.quality?.current)?.label ?? "HD")
      : "Auto";
  const next = series?.next;

  return (
    <>
      <section className="now-playing">
        {series && (
          <div className="episode-line">
            <span className="badge">
              S{series.season}:E{series.episode}
            </span>
            <span>
              Season {series.season}, Episode {series.episode}
            </span>
          </div>
        )}
        <h2 data-testid="media-title">{title}</h2>
        <p className={`state ${player.state === "error" ? "bad" : ""}`} data-testid="player-state" data-state={player.state}>
          {busy && <span className="spinner" />}
          {stateLabel(player, tv.name)}
          {player.state === "error" && player.error && <small> ({player.error})</small>}
        </p>
      </section>

      <SeekBar
        currentTime={player.currentTime}
        duration={player.duration}
        buffered={player.bufferedEnd}
        onSeek={(time) => send({ type: "SEEK", time })}
      />

      <div className="transport">
        <button
          className="round"
          onClick={() => send({ type: "SKIP", seconds: -10 })}
          disabled={!online}
          aria-label="Back 10 seconds"
        >
          <Back10Icon />
        </button>
        {playing ? (
          <button className="round big" data-testid="pause" onClick={() => send({ type: "PAUSE" })} disabled={!online} aria-label="Pause">
            <PauseIcon />
          </button>
        ) : (
          <button className="round big" data-testid="play" onClick={() => send({ type: "PLAY" })} disabled={!online} aria-label="Play">
            <PlayIcon />
          </button>
        )}
        <button
          className="round"
          onClick={() => send({ type: "SKIP", seconds: 10 })}
          disabled={!online}
          aria-label="Forward 10 seconds"
        >
          <Forward10Icon />
        </button>
      </div>

      {next && (
        <button className="btn btn-red btn-block" data-testid="next-episode" onClick={onNext} disabled={!online}>
          <NextIcon /> Next episode
          <small>{next.title || `S${next.season}:E${next.episode}`}</small>
        </button>
      )}

      <div className="chips">
        {series?.episodes && series.episodes.length > 1 && (
          <Chip testId="chip-episodes" label="Episodes" value={`${series.episodes.length} in list`} onClick={() => onOpen("episodes")} />
        )}
        {hasTracks && (
          <Chip
            testId="chip-tracks"
            icon={<SubtitlesIcon />}
            label="Subtitles"
            value={subtitleName || "Audio"}
            onClick={() => onOpen("tracks")}
          />
        )}
        <Chip testId="chip-speed" label="Speed" value={`${player.playbackRate ?? 1}×`} onClick={() => onOpen("speed")} />
        {player.quality && player.quality.levels.length > 1 && (
          <Chip testId="chip-quality" label="Quality" value={qualityName} onClick={() => onOpen("quality")} />
        )}
      </div>

      <div className="actions">
        <button className="btn btn-danger" data-testid="stop" onClick={onStop}>
          <StopIcon /> Stop
        </button>
        <button className="btn" data-testid="fullscreen" onClick={() => send({ type: "TOGGLE_FULLSCREEN" })} disabled={!online}>
          <FullscreenIcon /> Fullscreen
        </button>
        <button className="btn" data-testid="change-video" onClick={() => onOpen("link")}>
          <LinkIcon /> New link
        </button>
      </div>
    </>
  );
}
