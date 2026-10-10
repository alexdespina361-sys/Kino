import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { CaptionStyle } from "../../shared";
import { captionBottom, captionTextStyle } from "../shared/captionCss";

/** One subtitle line as markup: <i>, <b> and the like from the file are kept, nothing else gets through. */
function CueText({ cue }: { cue: TextTrackCue }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const vtt = cue as Partial<VTTCue>;
    node.replaceChildren(vtt.getCueAsHTML ? vtt.getCueAsHTML() : document.createTextNode(vtt.text ?? ""));
  }, [cue]);
  return <span ref={ref} className="tv-caption-text" />;
}

/** The subtitle tracks the app offers. (Closed captions embedded in a stream have kind "captions" and are not part of the menus.) */
const isCaptionTrack = (track: TextTrack) => track.kind === "subtitles";
const sameCues = (a: TextTrackCue[], b: TextTrackCue[]) => a.length === b.length && a.every((cue, i) => cue === b[i]);

/**
 * Draws the subtitles that are on right now. The tracks stay "hidden" (loaded, but not painted by the browser), so this
 * is the only thing the viewer sees, and the style settings apply the same way on every TV browser.
 */
export function Captions({ videoRef, style, delay = 0 }: { videoRef: RefObject<HTMLVideoElement | null>; style: CaptionStyle; delay?: number }) {
  const [cues, setCues] = useState<TextTrackCue[]>([]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // The cues that cover the playhead, found by time rather than read from `activeCues`: a hidden track only updates that
    // list as the video plays, so a track switched on while paused (or just loaded) would otherwise show nothing.
    const refresh = () => {
      const now = video.currentTime;
      const matchTime = now - delay;
      const active: TextTrackCue[] = [];
      for (const track of Array.from(video.textTracks)) {
        if (track.mode === "disabled" || !isCaptionTrack(track)) continue;
        for (const cue of Array.from(track.cues ?? [])) if (cue.startTime <= matchTime && matchTime < cue.endTime) active.push(cue);
      }
      setCues((current) => (sameCues(current, active) ? current : active));
    };

    const events = ["timeupdate", "seeked", "play", "pause"] as const;
    events.forEach((name) => video.addEventListener(name, refresh));
    video.textTracks.addEventListener("change", refresh);
    video.textTracks.addEventListener("addtrack", refresh);
    video.textTracks.addEventListener("removetrack", refresh);
    // Cues of a track that has just finished loading arrive without any event, so look now and then too.
    const timer = setInterval(refresh, 250);
    refresh();
    return () => {
      events.forEach((name) => video.removeEventListener(name, refresh));
      video.textTracks.removeEventListener("change", refresh);
      video.textTracks.removeEventListener("addtrack", refresh);
      video.textTracks.removeEventListener("removetrack", refresh);
      clearInterval(timer);
    };
  }, [videoRef, delay]);

  return (
    <div className="tv-captions" data-testid="captions" style={{ "--caption-bottom": captionBottom(style) } as CSSProperties}>
      {cues.map((cue) => (
        <div className="tv-caption" data-testid="caption" key={`${cue.startTime}-${cue.id}`} style={captionTextStyle(style)}>
          <CueText cue={cue} />
        </div>
      ))}
    </div>
  );
}
