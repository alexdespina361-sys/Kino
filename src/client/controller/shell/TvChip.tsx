import { useT } from "../../i18n";
import { ChevronIcon, TvIcon } from "../../shared/icons";

/**
 * The TV this phone controls, as the top of every page of the phone has it: its name, how it is doing (in words, with the dot: never a colour alone), and how many
 * more TVs watch along. It is one button, and what it opens is the TV's menu (it stands where the "..." button stood: nothing that opens a menu is left without a name).
 */
export function TvChip({ name, party, ok, status, onClick }: { name: string; party: number; ok: boolean; status: string; onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" className="top-tv tv-chip" aria-label={`${t("phone.tvMenu")}: ${name}, ${status}`} data-testid="menu" onClick={onClick}>
      <TvIcon />
      <span className="top-name">
        <span className="top-line">
          <span className="tv-name" data-testid="tv-name">
            {name}
          </span>
          {party > 0 && (
            <span className="party-count" data-testid="party-count">
              +{party}
            </span>
          )}
        </span>
        <span className={`tv-status ${ok ? "ok" : "bad"}`} data-testid="tv-online">
          {status}
        </span>
      </span>
      <ChevronIcon className="tv-chip-more" />
    </button>
  );
}
