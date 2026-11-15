import { OFFICIAL_PATH, type OfficialOfferLine } from "../../shared";

/** What a browser sends with `keepalive` (a page that is closing) is 64 KB at most, for all such requests at once. */
const KEEPALIVE_MAX = 60_000;

/**
 * Sends the server the times the aligner found for subtitle track `id` of the video (see `shared/official.ts`): the track is named by its
 * link, the one the server listed it under. Nothing comes of a failure; a Kino Official file is never offered as one.
 */
export function offerOfficial(video: HTMLVideoElement, id: number, offer: { duration: number; lines: OfficialOfferLine[] }, last: boolean): void {
  const textTrack = video.textTracks[id];
  const element = textTrack ? Array.from(video.querySelectorAll("track")).find((each) => each.track === textTrack) : undefined;
  if (!element?.src) return;
  let track: string;
  try {
    const url = new URL(element.src);
    if (url.origin !== location.origin) return;
    track = url.pathname + url.search;
  } catch {
    return;
  }
  if (track.startsWith(OFFICIAL_PATH)) return;
  const body = JSON.stringify({ v: 1, track, duration: offer.duration, lines: offer.lines });
  void fetch("/api/official/offer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: last && body.length <= KEEPALIVE_MAX,
  }).catch(() => undefined);
}
