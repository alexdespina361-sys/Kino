import type { NormalizedMedia, StreamType, SubtitleTrack } from "../../shared";

export type ResolveResult =
  | { status: "success"; media: NormalizedMedia; resolver: string }
  | { status: "unsupported"; reason: string }
  | { status: "temporary_failure"; reason: string }
  | { status: "invalid_url" };

export type ResolveFn = (url: string, isPrefetch?: boolean) => Promise<ResolveResult>;

/** One way of turning a URL into playable media. The generic resolver is a list of these. */
export interface Resolver {
  id: string;
  resolve(url: URL): Promise<ResolveResult>;
}

/** A resolver that knows one site (or family of sites) well. Looked up by domain before the generic path. */
export interface SiteAdapter extends Resolver {
  domains: string[];
}

export interface Candidate {
  url: string;
  type: StreamType;
  /** Which extraction strategy produced it, e.g. "html5-video". */
  strategy: string;
  /** 0..1, how sure we are this is the main video. Deterministic per strategy. */
  confidence: number;
  subtitles?: SubtitleTrack[];
}

export const UNSUPPORTED_MESSAGE = "Couldn't find a compatible video source. This website is currently unsupported.";
