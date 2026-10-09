import { useEffect, useState, type Ref } from "react";
import {
  episodeName,
  groupBySeason,
  isCurrentEpisode,
  PLAYBACK_SPEEDS,
  type PlayerState,
  type SeriesInfo,
} from "../../shared";
import { CheckIcon, CloseIcon } from "../shared/icons";
import { SUBTITLE_FONT_SIZE, SUBTITLE_SIZES, type SubtitleSize } from "./prefs";

export type MenuKind = "tracks" | "speed" | "quality" | "episodes";

interface Option {
  key: string | number;
  label: string;
  active: boolean;
  pick: () => void;
}
interface Column {
  title: string;
  options: Option[];
}

interface MenuProps {
  kind: MenuKind;
  player: PlayerState;
  series: SeriesInfo | undefined;
  subtitleSize: SubtitleSize;
  rootRef: Ref<HTMLDivElement>;
  onClose: () => void;
  onSubtitle: (track: number) => void;
  onAudio: (track: number) => void;
  onSpeed: (rate: number) => void;
  onQuality: (level: number) => void;
  onSize: (size: SubtitleSize) => void;
  onEpisode: (url: string) => void;
}

const TITLES: Record<MenuKind, string> = {
  tracks: "Audio & Subtitles",
  speed: "Playback speed",
  quality: "Quality",
  episodes: "Episodes",
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function columnsFor(p: MenuProps, season: number | undefined, setSeason: (season: number) => void): Column[] {
  const { player, kind } = p;

  if (kind === "speed") {
    const rate = player.playbackRate ?? 1;
    return [
      {
        title: "Speed",
        options: PLAYBACK_SPEEDS.map((value) => ({
          key: value,
          label: value === 1 ? "Normal" : `${value}×`,
          active: Math.abs(rate - value) < 0.01,
          pick: () => p.onSpeed(value),
        })),
      },
    ];
  }

  if (kind === "quality") {
    const quality = player.quality;
    const levels = [...(quality?.levels ?? [])].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    return [
      {
        title: "Quality",
        options: [
          { key: -1, label: "Auto", active: quality?.current === -1, pick: () => p.onQuality(-1) },
          ...levels.map((level) => ({
            key: level.id,
            label: level.label,
            active: quality?.current === level.id,
            pick: () => p.onQuality(level.id),
          })),
        ],
      },
    ];
  }

  if (kind === "episodes") {
    const series = p.series;
    const groups = groupBySeason(series?.episodes ?? []);
    const shown = groups.find((group) => group.season === season) ?? groups[0];
    if (!series || !shown) return [];
    const columns: Column[] = [];
    if (groups.length > 1) {
      columns.push({
        title: "Seasons",
        options: groups.map((group) => ({
          key: group.season,
          label: `Season ${group.season}`,
          active: group.season === shown.season,
          pick: () => setSeason(group.season),
        })),
      });
    }
    columns.push({
      title: groups.length > 1 ? `Season ${shown.season}` : "Episodes",
      options: shown.episodes.map((episode) => {
        const current = isCurrentEpisode(series, episode);
        return {
          key: `${episode.season}-${episode.episode}`,
          label: `${episode.episode}. ${episodeName(episode)}`,
          active: current,
          // Picking what is already playing just closes the list.
          pick: () => (current ? p.onClose() : p.onEpisode(episode.url)),
        };
      }),
    });
    return columns;
  }

  const audio = player.audio?.tracks ?? [];
  const subtitles = player.subtitles;
  return [
    {
      title: "Audio",
      options: audio.length
        ? audio.map((track) => ({
            key: track.id,
            label: track.label,
            active: player.audio?.current === track.id,
            pick: () => p.onAudio(track.id),
          }))
        : [{ key: "default", label: "Default", active: true, pick: () => {} }],
    },
    {
      title: "Subtitles",
      options: [
        { key: -1, label: "Off", active: (subtitles?.current ?? -1) === -1, pick: () => p.onSubtitle(-1) },
        ...(subtitles?.tracks ?? []).map((track) => ({
          key: track.id,
          label: track.label,
          active: subtitles?.current === track.id,
          pick: () => p.onSubtitle(track.id),
        })),
      ],
    },
    {
      title: "Subtitle size",
      options: SUBTITLE_SIZES.map((size) => ({
        key: size,
        label: capitalize(size),
        active: p.subtitleSize === size,
        pick: () => p.onSize(size),
      })),
    },
  ];
}

/** Audio / subtitles / speed / quality / episodes picker. Every option is a real button so the remote's arrows and OK just work. */
export function TvMenu(props: MenuProps) {
  const [season, setSeason] = useState<number | undefined>(props.series?.season);
  const columns = columnsFor(props, season, setSeason);

  // Start on whatever is selected now (the episode you're watching, the current language), so OK changes nothing by accident.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-tv-menu]");
    const actives = root?.querySelectorAll<HTMLElement>("[data-active='true']");
    const start = props.kind === "episodes" ? actives?.[actives.length - 1] : actives?.[0];
    (start ?? root?.querySelector<HTMLElement>("[data-opt]"))?.focus();
  }, [props.kind]);

  return (
    <div className="tv-menu-backdrop" onClick={props.onClose}>
      <div
        className="tv-menu"
        ref={props.rootRef}
        data-tv-menu
        role="dialog"
        aria-modal="true"
        aria-label={TITLES[props.kind]}
        data-testid="audio-subtitles-modal"
        data-kind={props.kind}
        data-cols={columns.length}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tv-menu-top">
          <h2>{TITLES[props.kind]}</h2>
          <button className="tv-btn tv-btn-icon" onClick={props.onClose} aria-label="Close" title="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="tv-menu-cols">
          {columns.map((column, col) => (
            <div className="tv-menu-col" key={column.title}>
              <h3>{column.title}</h3>
              <div className="tv-opts" role="listbox" aria-label={column.title}>
                {column.options.map((option) => (
                  <button
                    key={option.key}
                    className="tv-opt"
                    data-opt
                    data-col={col}
                    data-active={option.active}
                    role="option"
                    aria-selected={option.active}
                    onClick={option.pick}
                  >
                    <span>{option.label}</span>
                    {option.active && <CheckIcon />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {props.kind === "tracks" && (
          // The same look and size the real subtitles get, so a size can be judged before it is chosen.
          <div className="tv-sub-preview" data-testid="subtitle-preview" aria-hidden="true">
            <span style={{ fontSize: SUBTITLE_FONT_SIZE[props.subtitleSize] }}>This is how your subtitles will look</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Arrow-key navigation inside the menu: up/down within a column, left/right across columns. */
export function moveInMenu(root: HTMLElement | null, direction: "up" | "down" | "left" | "right"): void {
  if (!root) return;
  const options = [...root.querySelectorAll<HTMLElement>("[data-opt]")];
  const current = options.find((option) => option === document.activeElement);
  if (!current) {
    (options.find((option) => option.dataset.active === "true") ?? options[0])?.focus();
    return;
  }

  const col = Number(current.dataset.col);
  const inColumn = (c: number) => options.filter((option) => Number(option.dataset.col) === c);
  const mine = inColumn(col);
  const row = mine.indexOf(current);

  if (direction === "up" || direction === "down") {
    mine[Math.max(0, Math.min(mine.length - 1, row + (direction === "down" ? 1 : -1)))]?.focus();
    return;
  }
  const other = inColumn(col + (direction === "right" ? 1 : -1));
  // Land on what is selected over there (the current episode, the current subtitle), else on the same row.
  (other.find((option) => option.dataset.active === "true") ?? other[Math.min(row, other.length - 1)])?.focus();
}
