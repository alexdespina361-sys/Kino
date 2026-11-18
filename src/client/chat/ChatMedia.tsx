import { useMemo, useState } from "react";
import type { ChatLine } from "../../shared";
import { useProfileData } from "../account/store";
import { Sheet } from "../controller/Sheet";
import { useLanguage, useT } from "../i18n";
import { ChevronLeftIcon } from "../shared/icons";
import { BackButton, Screen } from "../tv/Idle";
import type { PersonalLines } from "./ChatLines";
import { mediaOf, type ChatMedia } from "./search";
import { dayOf, stampOf } from "./state";

export function MediaGrid({ lines, name, now, personal, onShow, nav = false }: { lines: readonly ChatLine[]; name: string; now: number; personal?: PersonalLines | undefined; onShow: (id: number) => void; nav?: boolean }) {
  const t = useT();
  const child = useProfileData().settings.child === true;
  const media = useMemo(() => mediaOf(lines).filter((item) => !(child && item.kind === "gif")), [lines, child]);
  if (media.length === 0) {
    return (
      <p className="chat-note chat-media-none" data-testid="chat-media-none">
        {t("chat.mediaNone")}
      </p>
    );
  }
  return (
    <ul className="chat-media" data-testid="chat-media">
      {media.map((item) => (
        <li key={item.id}>
          <MediaTile item={item} name={name} now={now} personal={personal} onShow={onShow} nav={nav} />
        </li>
      ))}
    </ul>
  );
}

function MediaTile({ item, name, now, personal, onShow, nav }: { item: ChatMedia; name: string; now: number; personal?: PersonalLines | undefined; onShow: (id: number) => void; nav: boolean }) {
  const t = useT();
  const language = useLanguage();
  const [failed, setFailed] = useState(false);
  const src = item.kind === "personal" ? (personal ? personal.src(item.sticker) : null) : item.src;
  const what = item.kind === "gif" ? t("chat.gifAlt") : t("chat.quoteSticker");
  const when = [dayOf(item.at, now, language), stampOf(item.at, language)].filter(Boolean).join(" ");
  const label = item.mine ? t("chat.mediaItemMine", { what, when }) : t("chat.mediaItem", { what, name, when });
  const gone = !src || failed;
  return (
    <button
      type="button"
      className="chat-media-tile"
      data-kind={item.kind}
      data-gone={gone ? "true" : undefined}
      onClick={() => onShow(item.id)}
      aria-label={gone ? `${t("chat.mediaGone")}, ${when}` : label}
      title={gone ? t("chat.mediaGone") : label}
      {...(nav ? { "data-nav": true } : {})}
      data-testid="chat-media-tile"
    >
      {!gone && <img src={src} alt="" loading="lazy" decoding="async" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    </button>
  );
}

export function ChatMediaTv({ lines, name, now, personal, narrow, onShow, onBack }: { lines: readonly ChatLine[]; name: string; now: number; personal?: PersonalLines | undefined; narrow: boolean; onShow: (id: number) => void; onBack: () => void }) {
  const t = useT();
  const title = t("chat.mediaTitle", { name });
  return (
    <Screen key="media" testId="tv-chat-media" compact focus={!narrow} onBack={onBack} {...(narrow ? { className: "tv-chat-screen tv-gif-screen tv-media-screen" } : {})}>
      {narrow ? (
        <div className="tv-gif-head">
          <button type="button" className="tv-chat-headback" onClick={onBack} aria-label={t("common.back")} title={t("common.back")} data-nav data-testid="tv-chat-media-back">
            <ChevronLeftIcon />
          </button>
          <h1 className="tv-sticker-title">{title}</h1>
        </div>
      ) : (
        <h1 className="tv-headline tv-headline-small">{title}</h1>
      )}
      <div className="tv-chat-media-list" data-testid="tv-chat-media-list">
        <MediaGrid
          lines={lines}
          name={name}
          now={now}
          personal={personal}
          nav
          onShow={(id) => {
            onBack();
            onShow(id);
          }}
        />
      </div>
      {!narrow && <BackButton onClick={onBack} testId="tv-chat-media-back" />}
    </Screen>
  );
}

export function ChatMediaSheet({ lines, name, now, personal, onShow, onClose }: { lines: readonly ChatLine[]; name: string; now: number; personal?: PersonalLines | undefined; onShow: (id: number) => void; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet title={t("chat.mediaTitle", { name })} onClose={onClose} testId="chat-media-sheet">
      <MediaGrid
        lines={lines}
        name={name}
        now={now}
        personal={personal}
        onShow={(id) => {
          onClose();
          onShow(id);
        }}
      />
    </Sheet>
  );
}
