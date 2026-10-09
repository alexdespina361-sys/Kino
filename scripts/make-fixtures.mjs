// Regenerates the local test media in ./fixtures (needs ffmpeg on PATH). The outputs are committed,
// so tests and CI do NOT need ffmpeg; run `pnpm fixtures` only if you want to change them.
//
// Codec note: VP9 (not H.264) so the Chromium bundled with Playwright can decode it.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const SECONDS = 30;
const video = ["-f", "lavfi", "-i", `testsrc2=size=320x180:rate=15:duration=${SECONDS}`];
const audio = ["-f", "lavfi", "-i", `sine=frequency=440:duration=${SECONDS}`];
const vp9 = ["-c:v", "libvpx-vp9", "-b:v", "150k", "-deadline", "realtime", "-cpu-used", "8", "-g", "60", "-pix_fmt", "yuv420p"];

const ffmpeg = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });

// 1. Progressive MP4 (video + audio, seekable via range requests).
ffmpeg([...video, ...audio, ...vp9, "-c:a", "libopus", "-b:a", "32k", "-shortest", "-movflags", "+faststart", "fixtures/sample.mp4"]);

// 2. HLS (fMP4 segments, 4s each, video only).
rmSync("fixtures/hls", { recursive: true, force: true });
mkdirSync("fixtures/hls", { recursive: true });
ffmpeg([
  ...video, ...vp9, "-an",
  "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
  "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4",
  "-hls_segment_filename", "fixtures/hls/seg_%03d.m4s",
  "-master_pl_name", "master.m3u8",
  "fixtures/hls/stream.m3u8",
]);

console.log("fixtures written to ./fixtures");
