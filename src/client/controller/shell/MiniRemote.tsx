import type { NormalizedMedia, PlayerState } from "../../../shared";
import { useT } from "../../i18n";
import { PauseIcon, PlayIcon } from "../../shared/icons";
import { Poster } from "../../shared/Poster";
import { mediaTitle, stateLabel } from "../Remote";

/**
 * What is playing on the TV, on every page of the phone while the remote is not the page: its picture, its name, how it is doing, and a button that
 * plays or pauses it (R4). A tap on the rest of it opens the remote. A thin line along its top edge says how far the film has got.
 */
export function MiniRemote({ media, player, tvName, online, onOpen, onToggle }: { media: NormalizedMedia; player: PlayerState; tvName: string; online: boolean; onOpen: () => void; onToggle: () => void }) {
  const t = useT();
  const title = mediaTitle(media);
  const playing = player.state === "playing";
  const loading = player.state === "loading";
  const progress = player.duration > 0 ? Math.min(1, Math.max(0, player.currentTime / player.duration)) : 0;
  return (
    <div className="mini-remote" data-testid="mini-remote" data-state={player.state}>
      <span className="mini-progress" aria-hidden="true">
        <i style={{ width: `${Math.round(progress * 1000) / 10}%` }} />
      </span>
      <button type="button" className="mini-open" data-testid="playing-bar" aria-label={`${t("remote.open")}: ${title}`} onClick={onOpen}>
        <Poster className="mini-art" title={title} image={media.poster ?? media.backdrop} />
        <span className="mini-text">
          <b className="mini-title">{title}</b>
          <span className="mini-state" data-testid="mini-state">
            {stateLabel(player, tvName)}
          </span>
        </span>
      </button>
      <button type="button" className="mini-toggle" data-testid={playing ? "mini-pause" : "mini-play"} aria-label={playing ? t("hud.pause") : t("hud.play")} disabled={!online || loading} onClick={onToggle}>
        {loading ? <span className="spinner" /> : playing ? <PauseIcon /> : <PlayIcon />}
      </button>
    </div>
  );
}
