"""
Kino ASR benchmark: speech to timed subtitles, measured the way a viewer feels it (see docs/subtitle-fixer.md, "Generation").

One stream, batch size 1, 30 s chunks in order, as a request at a playback position would be served:
  - load:          time to load the model (once per server start, not per request)
  - first 30 s:    time from the request to subtitles for the first 30 s of sound (the first chunk, cold)
  - 3 minutes:     time until 0-180 s is covered
  - speed:         seconds of sound per second of work over the whole clip (above 1 = faster than playback)
  - words:         WER (English) / CER (Japanese) against the clip's own reference text
  - timing:        how far each reference line's first word lands from the reference line's start
  - peak VRAM, and a few reference/recognised lines side by side

Clips (fetched inside the notebook, never through our servers; both may be shared):
  - English: "Tears of Steel" (CC BY 3.0, (CC) Blender Foundation | mango.blender.org), the whole 12-minute film: dialogue under music and
    action, with its official English subtitles as the reference (a subtitle file, not a verbatim transcript: WER is an upper bound).
  - Japanese: FLEURS ja_jp test (CC BY 4.0, Google), clips joined to ~3 minutes with 0.6 s gaps: READ speech, so it says nothing about anime.
    The joins are known exactly, so its timing reference is exact.

Engines are behind `Engine` (load / transcribe one chunk / unload): Qwen3-ASR (0.6B, 1.7B) with Qwen3-ForcedAligner-0.6B for word times, and
faster-whisper large-v3-turbo as a baseline. `BENCH_FAKE=1` runs everything with a stand-in engine on a local clip (no GPU, no downloads).
"""
from __future__ import annotations

import csv
import difflib
import gc
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import time
import unicodedata
import urllib.request
from dataclasses import dataclass

import numpy as np

SR = 16000
CHUNK_S = 30.0
CUT = os.environ.get("BENCH_CUT", "fixed")  # "fixed": every 30 s; "pause": at the quietest 20 ms between 10 and 20 s along
OUT = os.environ.get("BENCH_OUT", "/kaggle/working")
WORK = os.environ.get("BENCH_WORK", "/kaggle/temp" if os.path.isdir("/kaggle") else os.path.join(OUT, "work"))
FAKE = os.environ.get("BENCH_FAKE") == "1"

TOS_FILM = "https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov"
TOS_SRT = "https://download.blender.org/demo/movies/ToS/subtitles/TOS-en.srt"
FLEURS = "https://huggingface.co/datasets/google/fleurs/resolve/main/data/ja_jp"
JA_SECONDS = 180.0

RESULTS_PATH = os.path.join(OUT, "results.json")
results: dict = {"started": time.strftime("%Y-%m-%d %H:%M:%S"), "chunk_s": CHUNK_S, "runs": [], "notes": []}


def save() -> None:
    os.makedirs(OUT, exist_ok=True)
    with open(RESULTS_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)


def log(*parts) -> None:
    print(*parts, flush=True)


# ------------------------------------------------------------------------------------------------ media

def fetch(url: str, name: str) -> str:
    os.makedirs(WORK, exist_ok=True)
    path = os.path.join(WORK, name)
    if not os.path.exists(path):
        t = time.time()
        req = urllib.request.Request(url, headers={"User-Agent": "kino-asr-bench"})
        with urllib.request.urlopen(req, timeout=120) as res, open(path + ".part", "wb") as f:
            while True:
                block = res.read(1 << 20)
                if not block:
                    break
                f.write(block)
        os.replace(path + ".part", path)
        log(f"fetched {name}: {os.path.getsize(path) / 1e6:.1f} MB in {time.time() - t:.1f} s")
    return path


def pcm_of(path_or_bytes, start: float | None = None, seconds: float | None = None) -> np.ndarray:
    """Mono 16 kHz float32 sound, through ffmpeg."""
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error"]
    if start is not None:
        cmd += ["-ss", str(start)]
    if seconds is not None:
        cmd += ["-t", str(seconds)]
    data = None
    if isinstance(path_or_bytes, (bytes, bytearray)):
        cmd += ["-i", "pipe:0"]
        data = bytes(path_or_bytes)
    else:
        cmd += ["-i", path_or_bytes]
    cmd += ["-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "pipe:1"]
    out = subprocess.run(cmd, input=data, capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).copy()


@dataclass
class Cue:
    start: float
    end: float
    text: str


def parse_time(t: str) -> float:
    h, m, s = t.strip().replace(",", ".").split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def parse_srt(text: str) -> list[Cue]:
    cues = []
    for block in re.split(r"\r?\n\s*\r?\n", text.replace("﻿", "").strip()):
        lines = [l for l in block.splitlines() if l.strip()]
        for i, line in enumerate(lines):
            m = re.match(r"\s*(\d+:\d+:\d+[.,]\d+)\s*-->\s*(\d+:\d+:\d+[.,]\d+)", line)
            if m:
                words = re.sub(r"<[^>]+>|\{[^}]+\}", "", " ".join(lines[i + 1:])).strip()
                if words:
                    cues.append(Cue(parse_time(m.group(1)), parse_time(m.group(2)), words))
                break
    return cues


def srt_time(t: float) -> str:
    ms = max(0, int(round(t * 1000)))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def write_srt(cues: list[Cue], path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for n, c in enumerate(cues, 1):
            f.write(f"{n}\n{srt_time(c.start)} --> {srt_time(c.end)}\n{c.text}\n\n")


def frame_rms(pcm: np.ndarray, frame: int = 320) -> np.ndarray:
    """Loudness of each 20 ms."""
    usable = len(pcm) // frame * frame
    return np.sqrt((pcm[:usable].reshape(-1, frame) ** 2).mean(axis=1)) if usable else np.zeros(0)


def speech_onset(pcm: np.ndarray) -> float:
    """
    Where a recording's speech starts: the first 100 ms louder than 3x the recording's own quiet level (its 10th percentile) and 15% of
    its loudest, less 40 ms. (Version 2 used "the first 20 ms above 5% of the loudest", which fired on the background noise before the
    speech in 9 of the 15 FLEURS lines and made every engine look 1-2 s late. This rule, checked line by line against faster-whisper's
    word times, which are independent of it: all 14 lines within 0.3 s, Whisper consistently ~0.17 s early; 2.5-3x and 10-20% agree.)
    """
    rms = frame_rms(pcm)
    if not len(rms):
        return 0.0
    smooth = np.convolve(rms, np.ones(5) / 5, mode="same")
    loud = np.nonzero(smooth > max(3 * float(np.percentile(rms, 10)), 0.15 * float(smooth.max())))[0]
    return float(max(0, loud[0] - 2)) * 0.02 if len(loud) else 0.0


@dataclass
class Clip:
    name: str
    lang: str  # "en" | "ja"
    pcm: np.ndarray
    ref: list[Cue]
    exact_timing: bool


def english_clip() -> Clip:
    if FAKE:
        audio, srt = os.environ["BENCH_EN_AUDIO"], os.environ["BENCH_EN_SRT"]
    else:
        audio, srt = fetch(TOS_FILM, "tos_720p.mov"), fetch(TOS_SRT, "TOS-en.srt")
    with open(srt, encoding="utf-8", errors="replace") as f:
        ref = parse_srt(f.read())
    return Clip("local test clip (en)" if FAKE else "Tears of Steel (en, film)", "en", pcm_of(audio), ref, exact_timing=False)


def japanese_clip() -> Clip | None:
    if FAKE:
        return None
    tsv = fetch(f"{FLEURS}/test.tsv", "fleurs_ja_test.tsv")
    texts: dict[str, str] = {}
    with open(tsv, encoding="utf-8") as f:
        for row in csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            names = [i for i, v in enumerate(row) if v.endswith(".wav")]
            if names and names[0] + 1 < len(row):
                texts[os.path.basename(row[names[0]])] = row[names[0] + 1]
    # (The archive is read as it comes and left once there is enough: ~3 minutes is a few percent of it.)
    pieces, ref, at, gap, used = [], [], 0.0, 0.6, set()
    req = urllib.request.Request(f"{FLEURS}/audio/test.tar.gz", headers={"User-Agent": "kino-asr-bench"})
    with urllib.request.urlopen(req, timeout=120) as res, tarfile.open(fileobj=res, mode="r|gz") as tar:
        for member in tar:
            name = os.path.basename(member.name)
            # (FLEURS has the same sentence read by several people: each sentence once.)
            if not member.isfile() or name not in texts or texts[name] in used:
                continue
            used.add(texts[name])
            pcm = pcm_of(tar.extractfile(member).read())
            if len(pcm) < SR:
                continue
            ref.append(Cue(at + speech_onset(pcm), at + len(pcm) / SR, texts[name]))
            pieces += [pcm, np.zeros(int(gap * SR), dtype=np.float32)]
            at += len(pcm) / SR + gap
            if at >= JA_SECONDS:
                break
    # (Line starts are where each recording's speech begins, found by loudness: exact to ~0.1 s, not to the frame.)
    return Clip("FLEURS ja_jp test, joined (read speech)", "ja", np.concatenate(pieces), ref, exact_timing=True)


# ------------------------------------------------------------------------------------------------ scoring

def tokens(text: str, lang: str) -> list[str]:
    text = unicodedata.normalize("NFKC", text).lower()
    if lang == "ja":
        return [ch for ch in text if unicodedata.category(ch)[0] in "LN"]
    text = re.sub(r"[’']", "", text)
    return re.findall(r"[a-z0-9]+", text)


def edits(a: list[str], b: list[str]) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]


@dataclass
class Word:
    text: str
    start: float
    end: float


def score(clip: Clip, words: list[Word], upto: float) -> dict:
    ref = [c for c in clip.ref if c.start < upto]
    ref_tokens, cue_first = [], []
    for c in ref:
        cue_first.append(len(ref_tokens))
        ref_tokens += tokens(c.text, clip.lang)
    hyp_tokens, hyp_time = [], []
    for w in words:
        for t in tokens(w.text, clip.lang):
            hyp_tokens.append(t)
            hyp_time.append(w.start)
    error = edits(ref_tokens, hyp_tokens) / max(1, len(ref_tokens))
    # Timing: the reference line's first token, where it was matched in the recognised text.
    where: dict[int, int] = {}
    for block in difflib.SequenceMatcher(None, ref_tokens, hyp_tokens, autojunk=False).get_matching_blocks():
        for k in range(block.size):
            where[block.a + k] = block.b + k
    offsets = [hyp_time[where[i]] - c.start for i, c in zip(cue_first, ref) if i in where]
    off = np.abs(np.array(offsets)) if offsets else np.array([])
    examples = []
    for c in ref[:: max(1, len(ref) // 8)][:8]:
        heard = " ".join(w.text for w in words if c.start - 0.5 <= w.start < c.end + 0.5).strip()
        examples.append({"at": round(c.start, 1), "reference": c.text, "recognised": heard})
    return {
        ("cer" if clip.lang == "ja" else "wer"): round(error, 3),
        "ref_tokens": len(ref_tokens),
        "lines_timed": f"{len(offsets)}/{len(ref)}",
        "start_error_median_s": round(float(np.median(off)), 2) if len(off) else None,
        "start_within_0_3s": round(float(np.mean(off <= 0.3)), 2) if len(off) else None,
        "start_within_1s": round(float(np.mean(off <= 1.0)), 2) if len(off) else None,
        "examples": examples,
    }


def cues_of(words: list[Word], lang: str) -> list[Cue]:
    """Lines for the screen from timed words: a new line after a pause, a sentence end, 6 s or ~42 characters."""
    cues: list[Cue] = []
    joiner = "" if lang == "ja" else " "
    limit = 22 if lang == "ja" else 42
    for w in words:
        last = cues[-1] if cues else None
        if last and w.start - last.end < 0.6 and w.end - last.start < 6 and len(last.text) + len(w.text) < limit and not re.search(r"[.!?。！？]$", last.text):
            last.text += joiner + w.text
            last.end = w.end
        else:
            cues.append(Cue(w.start, max(w.end, w.start + 0.3), w.text))
    for c in cues:
        c.end = max(c.end, c.start + 0.8)
    return cues


# ------------------------------------------------------------------------------------------------ engines

LANG_NAME = {"en": "English", "ja": "Japanese"}


class Engine:
    name = "engine"

    def load(self) -> None: ...

    def transcribe(self, pcm: np.ndarray, lang: str) -> list[Word]:
        raise NotImplementedError

    def unload(self) -> None:
        gc.collect()
        try:
            import torch

            torch.cuda.empty_cache()
        except Exception:
            pass


class FakeEngine(Engine):
    """Stands in for a model on the local test: says the reference words of the chunk, 0.1 s late, without its first word."""

    name = "fake"

    def __init__(self, clip: Clip):
        self.clip = clip
        self.at = 0.0

    def transcribe(self, pcm, lang):
        start, end = self.at, self.at + len(pcm) / SR
        self.at = end
        out = []
        for c in self.clip.ref:
            if start <= c.start < end:
                parts = c.text.split()
                step = (c.end - c.start) / max(1, len(parts))
                out += [Word(p, c.start - start + 0.1 + k * step, c.start - start + 0.1 + (k + 1) * step) for k, p in enumerate(parts) if k or len(out) % 3]
        time.sleep(0.01)
        return out


def torch_dtype():
    import torch

    return torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16


class QwenEngine(Engine):
    def __init__(self, model_id: str, context: str = ""):
        self.model_id = model_id
        self.name = model_id.split("/")[-1] + " + ForcedAligner-0.6B"
        self.shown = False
        # Text the model is told before it listens (Qwen3-ASR's system prompt): names and terms to expect, e.g. a title's cast.
        self.context = context

    def load(self):
        from qwen_asr import Qwen3ASRModel

        dtype = torch_dtype()
        self.model = Qwen3ASRModel.from_pretrained(
            self.model_id,
            dtype=dtype,
            device_map="cuda:0",
            max_inference_batch_size=1,
            max_new_tokens=512,
            forced_aligner="Qwen/Qwen3-ForcedAligner-0.6B",
            forced_aligner_kwargs=dict(dtype=dtype, device_map="cuda:0"),
        )
        results["notes"].append(f"{self.name}: dtype {dtype}")

    def transcribe(self, pcm, lang):
        r = self.model.transcribe(audio=(pcm, SR), language=LANG_NAME[lang], return_time_stamps=True, context=self.context)[0]
        words = stamp_words(r.time_stamps, len(pcm) / SR, self)
        if not words and r.text.strip():
            words = [Word(r.text.strip(), 0.0, len(pcm) / SR)]
        return words

    def unload(self):
        self.model = None
        super().unload()


def stamp_words(stamps, length: float, engine=None) -> list[Word]:
    """Qwen3-ForcedAligner's items as words, in seconds from the start of a piece `length` seconds long."""
    items = list(getattr(stamps, "items", None) or stamps or [])
    if items and isinstance(items[0], (list, tuple)) and not hasattr(items[0], "start_time"):
        items = [x for group in items for x in group]
    if engine is not None and not getattr(engine, "shown", True):
        engine.shown = True
        results["notes"].append(f"{engine.name}: first raw stamp {items[0]!r}"[:300] if items else f"{engine.name}: no stamps")
    words = []
    for x in items:
        get = (lambda k: x.get(k)) if isinstance(x, dict) else (lambda k: getattr(x, k, None))
        text, s, e = get("text"), get("start_time"), get("end_time")
        if text is None or s is None or e is None:
            continue
        words.append(Word(str(text), float(s), float(e)))
    # (Seconds or milliseconds is not written down: a stamp past the chunk's length is taken as milliseconds.)
    if words and max(w.end for w in words) > length * 1.5:
        words = [Word(w.text, w.start / 1000, w.end / 1000) for w in words]
    return words


class WhisperEngine(Engine):
    name = "faster-whisper large-v3-turbo (fp16, beam 5, word times)"

    def load(self):
        from faster_whisper import WhisperModel

        self.model = WhisperModel("large-v3-turbo", device="cuda", compute_type="float16")

    def transcribe(self, pcm, lang):
        segments, _ = self.model.transcribe(pcm, language=lang, beam_size=5, word_timestamps=True, vad_filter=False, condition_on_previous_text=False)
        return [Word(w.word.strip(), w.start, w.end) for s in segments for w in (s.words or []) if w.word.strip()]

    def unload(self):
        self.model = None
        super().unload()


# ------------------------------------------------------------------------------------------------ the run

def peak_vram_reset():
    try:
        import torch

        torch.cuda.reset_peak_memory_stats()
    except Exception:
        pass


def peak_vram_gb():
    try:
        import torch

        return round(torch.cuda.max_memory_allocated() / 1e9, 2)
    except Exception:
        return None


def pieces_of(pcm: np.ndarray) -> list[tuple[int, int]]:
    if CUT != "pause":
        step = int(CHUNK_S * SR)
        return [(at, min(at + step, len(pcm))) for at in range(0, len(pcm), step)]
    out, at, lo, hi = [], 0, 10 * SR, 20 * SR
    while at < len(pcm):
        if len(pcm) - at <= hi:
            out.append((at, len(pcm)))
            break
        rms = frame_rms(pcm[at + lo: at + hi])
        cut = at + lo + int(np.argmin(rms)) * 320 + 160
        out.append((at, cut))
        at = cut
    return out


def run(engine: Engine, clip: Clip) -> dict:
    """One engine on one clip, chunk by chunk from the start, as one viewer's request would be served."""
    name = f"{engine.name}, cut {'at pauses' if CUT == 'pause' else 'every 30 s'}"
    run = {"engine": name, "clip": clip.name, "audio_s": round(len(clip.pcm) / SR, 1)}
    words: list[Word] = []
    t0 = time.time()
    for n, (at, end) in enumerate(pieces_of(clip.pcm)):
        offset = at / SR
        words += [Word(w.text, w.start + offset, w.end + offset) for w in engine.transcribe(clip.pcm[at:end], clip.lang)]
        done = time.time() - t0
        if n == 0:
            run["first_piece_s"] = round(done, 2)
        if end / SR >= 30 and "first_30s_s" not in run:
            run["first_30s_s"] = round(done, 2)
        if end / SR >= 180 and "first_3min_s" not in run:
            run["first_3min_s"] = round(done, 2)
    total = time.time() - t0
    run["total_s"] = round(total, 1)
    run["x_realtime"] = round(len(clip.pcm) / SR / total, 1)
    run["peak_vram_gb"] = peak_vram_gb()
    run.update(score(clip, words, upto=len(clip.pcm) / SR))
    stem = re.sub(r"[^a-z0-9]+", "-", f"{name}-{clip.lang}".lower()).strip("-")
    write_srt(cues_of(words, clip.lang), os.path.join(OUT, f"{stem}.srt"))
    run["srt"] = f"{stem}.srt"
    return run


def bench(make_engines, clips) -> None:
    for make in make_engines:
        engine = None
        try:
            engine = make()
            peak_vram_reset()
            t = time.time()
            engine.load()
            if not isinstance(engine, FakeEngine):
                engine.transcribe(np.zeros(5 * SR, dtype=np.float32) + np.float32(1e-4), clips[0].lang)
            load_s = round(time.time() - t, 1)
            for clip in clips:
                try:
                    peak_vram_reset()
                    r = run(engine, clip)
                    r["load_s"] = load_s
                    results["runs"].append(r)
                    log(json.dumps({k: v for k, v in r.items() if k != "examples"}, ensure_ascii=False))
                except Exception as error:  # noqa: BLE001 (one clip failing must not end the others)
                    results["runs"].append({"engine": getattr(engine, "name", "?"), "clip": clip.name, "error": repr(error)[:500]})
                    log("FAILED", clip.name, repr(error)[:500])
                save()
        except Exception as error:  # noqa: BLE001
            results["runs"].append({"engine": getattr(engine, "name", str(make)), "error": repr(error)[:500]})
            log("FAILED to load", repr(error)[:500])
            save()
        finally:
            if engine:
                engine.unload()


def summary() -> str:
    rows = ["| engine | clip | load s (incl. warm-up) | first 30 s | 3 min | x realtime | WER/CER | start error (median) | within 0.3 s / 1 s | VRAM GB |", "|---|---|---|---|---|---|---|---|---|---|"]
    for r in results["runs"]:
        if "error" in r:
            rows.append(f"| {r['engine']} | {r.get('clip', '-')} | failed: {r['error'][:80]} |||||||")
            continue
        err = r.get("wer", r.get("cer"))
        rows.append(
            f"| {r['engine']} | {r['clip']} | {r['load_s']} | {r['first_30s_s']} s | {r.get('first_3min_s', '-')} s | {r['x_realtime']} | {err} | {r['start_error_median_s']} s | {r['start_within_0_3s']} / {r['start_within_1s']} | {r['peak_vram_gb']} |"
        )
    return "\n".join(rows)


def main(which: str) -> None:
    clips = [english_clip()]
    ja = japanese_clip()
    if ja:
        clips.append(ja)
    for c in clips:
        results["notes"].append(f"clip {c.name}: {len(c.pcm) / SR:.0f} s, {len(c.ref)} reference lines")
    if FAKE:
        bench([lambda: FakeEngine(clips[0])], clips)
    elif which == "qwen":
        bench([lambda: QwenEngine("Qwen/Qwen3-ASR-0.6B"), lambda: QwenEngine("Qwen/Qwen3-ASR-1.7B")], clips)
    elif which == "qwen-1.7b":
        bench([lambda: QwenEngine("Qwen/Qwen3-ASR-1.7B")], clips)
    elif which == "whisper":
        bench([WhisperEngine], clips)
    save()
    print(summary())


if __name__ == "__main__":
    if os.path.exists(RESULTS_PATH):
        with open(RESULTS_PATH, encoding="utf-8") as f:
            results = json.load(f)
    main(sys.argv[1] if len(sys.argv) > 1 else "qwen")
