import { useEffect, useMemo, useRef, useState } from "react";
import {
  episodeName,
  groupBySeason,
  isCurrentEpisode,
  PLAYBACK_SPEEDS,
  type PlayerState,
  type SeriesInfo,
} from "../../shared";
import { CheckIcon } from "../shared/icons";
import { ChoiceList, Sheet, type Choice } from "./Sheet";

interface Close {
  onClose: () => void;
}

export function SpeedSheet({ player, onPick, onClose }: Close & { player: PlayerState; onPick: (rate: number) => void }) {
  const rate = player.playbackRate ?? 1;
  const choices: Choice[] = PLAYBACK_SPEEDS.map((value) => ({
    key: value,
    label: value === 1 ? "Normal" : `${value}×`,
    active: Math.abs(rate - value) < 0.01,
    testId: `speed-${value}`,
    pick: () => onPick(value),
  }));
  return (
    <Sheet title="Playback speed" onClose={onClose} testId="speed-sheet">
      <ChoiceList choices={choices} />
    </Sheet>
  );
}

export function QualitySheet({ player, onPick, onClose }: Close & { player: PlayerState; onPick: (level: number) => void }) {
  const quality = player.quality;
  const levels = [...(quality?.levels ?? [])].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const choices: Choice[] = [
    { key: -1, label: "Auto", active: quality?.current === -1, testId: "quality--1", pick: () => onPick(-1) },
    ...levels.map((level) => ({
      key: level.id,
      label: level.label,
      active: quality?.current === level.id,
      testId: `quality-${level.id}`,
      pick: () => onPick(level.id),
    })),
  ];
  return (
    <Sheet title="Quality" onClose={onClose} testId="quality-sheet">
      <ChoiceList choices={choices} />
    </Sheet>
  );
}

export function TracksSheet({
  player,
  onSubtitle,
  onAudio,
  onClose,
}: Close & { player: PlayerState; onSubtitle: (track: number) => void; onAudio: (track: number) => void }) {
  const subtitles = player.subtitles;
  const audio = player.audio;
  const subtitleChoices: Choice[] = [
    { key: -1, label: "Off", active: (subtitles?.current ?? -1) === -1, testId: "subtitle--1", pick: () => onSubtitle(-1) },
    ...(subtitles?.tracks ?? []).map((track) => ({
      key: track.id,
      label: track.label,
      active: subtitles?.current === track.id,
      testId: `subtitle-${track.id}`,
      pick: () => onSubtitle(track.id),
    })),
  ];
  const audioChoices: Choice[] = (audio?.tracks ?? []).map((track) => ({
    key: track.id,
    label: track.label,
    active: audio?.current === track.id,
    testId: `audio-${track.id}`,
    pick: () => onAudio(track.id),
  }));

  return (
    <Sheet title="Audio & subtitles" onClose={onClose} testId="tracks-sheet">
      {audioChoices.length > 1 && (
        <>
          <h3 className="sheet-section">Audio</h3>
          <ChoiceList choices={audioChoices} />
        </>
      )}
      <h3 className="sheet-section">Subtitles</h3>
      <ChoiceList choices={subtitleChoices} />
      <p className="muted small">The TV remembers your choice for the next video. Subtitle size is in the TV's menu.</p>
    </Sheet>
  );
}

/** Every episode the source knows about, by season. The one playing is marked; tap any other to jump there. */
export function EpisodesSheet({
  series,
  onPlay,
  onClose,
}: Close & { series: SeriesInfo; onPlay: (url: string) => void }) {
  const groups = useMemo(() => groupBySeason(series.episodes ?? []), [series.episodes]);
  const [season, setSeason] = useState(() => (groups.some((g) => g.season === series.season) ? series.season : groups[0]?.season));
  const shown = groups.find((group) => group.season === season) ?? groups[0];
  const listRef = useRef<HTMLUListElement>(null);

  // Open on the episode you're watching, not at the top of a 24-episode season.
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "center" });
  }, [season]);

  return (
    <Sheet title="Episodes" onClose={onClose} testId="episodes-sheet">
      {groups.length > 1 && (
        <div className="seasons" role="tablist" aria-label="Seasons">
          {groups.map((group) => (
            <button
              key={group.season}
              role="tab"
              aria-selected={group.season === shown?.season}
              className={`season ${group.season === shown?.season ? "active" : ""}`}
              data-testid={`season-${group.season}`}
              onClick={() => setSeason(group.season)}
            >
              Season {group.season}
            </button>
          ))}
        </div>
      )}
      {groups.length === 1 && shown && <h3 className="sheet-section">Season {shown.season}</h3>}
      <ul className="episodes" ref={listRef}>
        {shown?.episodes.map((episode) => {
          const now = isCurrentEpisode(series, episode);
          return (
            <li key={`${episode.season}-${episode.episode}`}>
              <button
                className={`episode ${now ? "now" : ""}`}
                aria-current={now}
                data-testid="episode"
                data-season={episode.season}
                data-episode={episode.episode}
                onClick={() => !now && onPlay(episode.url)}
              >
                <span className="episode-no">{episode.episode}</span>
                <span className="episode-title">{episodeName(episode)}</span>
                {now && (
                  <span className="episode-now">
                    <CheckIcon /> Now playing
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

export function MenuSheet({
  tvName,
  online,
  onDisconnect,
  onClose,
}: Close & { tvName: string; online: boolean; onDisconnect: () => void }) {
  return (
    <Sheet title={tvName} onClose={onClose} testId="menu-sheet">
      <p className="muted">{online ? "Connected" : "This TV is offline right now."}</p>
      <button className="btn btn-danger btn-block" data-testid="disconnect" onClick={onDisconnect}>
        Disconnect from this TV
      </button>
      <p className="muted small">
        The TV shows a new code so you (or someone else) can connect again. Your recently played list stays on this phone.
      </p>
    </Sheet>
  );
}
