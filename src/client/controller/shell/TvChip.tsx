import { useT } from "../../i18n";
import { ChevronIcon, TvIcon } from "../../shared/icons";

export function TvChip({ name, party, ok, status, onClick }: { name: string; party: number; ok: boolean; status: string; onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" className="top-tv tv-chip" aria-label={`${name}${party > 0 ? ` +${party}` : ""} ${status}, ${t("phone.tvMenu")}`} data-testid="menu" onClick={onClick}>
      <TvIcon />
      <span className="top-name">
        <span className="top-line">
          <span className="tv-name" data-testid="tv-name">
            {name}
          </span>
          {party > 0 && (
            <>
              {" "}
              <span className="party-count" data-testid="party-count">
                +{party}
              </span>
            </>
          )}
        </span>{" "}
        <span className={`tv-status ${ok ? "ok" : "bad"}`} data-testid="tv-online">
          {status}
        </span>
      </span>
      <ChevronIcon className="tv-chip-more" />
    </button>
  );
}
