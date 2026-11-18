import { OFFICIAL_PATH, type OfficialOfferLine } from "../../shared";

const KEEPALIVE_MAX = 60_000;

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
