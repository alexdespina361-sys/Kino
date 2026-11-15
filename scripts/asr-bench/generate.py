"""
Kino subtitle generation, prototype (Workflow B), and its test on film-like and old-film-like sound. See docs/subtitle-fixer.md, "Generation".

The pipeline (one viewer's request, piece by piece from the start):
  1. voice detector (Silero v5) over the sound;
  2. cut into 10-20 s pieces in the longest stretch without speech (no sound is ever left out: the pieces cover everything);
  3. speech to text (Qwen3-ASR) and word times (Qwen3-ForcedAligner) on each piece;
  4. check: a word that starts where the voice detector hears no speech starts at the first moment inside it where it does (the aligner
     sometimes stretches a line's first word back over silence); words still in silence are marked unsure;
  5. second listener: where faster-whisper heard words, Qwen gave none, and the sound is above its noise floor, Qwen listens to that
     stretch alone; if it still hears nothing, Whisper's words are used there, marked;
  6. lines from the word times by plain rules, written as SRT.

Commands (each in its own process, so one model's dependencies cannot break another's):
  python generate.py prepare            clips (FLEURS en/ja, CC BY 4.0) clean, mixed with Tears of Steel's music and effects (CC BY 3.0),
                                        and an "old film" version; plus the speech isolated by DBS-TIGER-DnR and Demucs. Saved in WORK/gen.
  python generate.py run whisper        faster-whisper on every prepared sound (its words are the second listener's)
  python generate.py run qwen           the whole pipeline with Qwen3-ASR-1.7B on every prepared sound (+ one run with names as context)
  python generate.py run musci          Musci-ASR-2.4B (English only) + the same aligner, same pieces
  python generate.py replay             CPU only: the pipeline's checks and lines on saved word times (GEN_REPLAY_DIR), no models
Results: OUT/gen-results.json (appended), one SRT per run, a table printed at the end of each command.
"""
from __future__ import annotations

import difflib
import json
import os
import re
import sys
import time
import unicodedata

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # (bench.py beside it, also under python -I)
import bench  # noqa: E402
from bench import SR, Cue, Word

GEN = os.path.join(bench.WORK, "gen")
RESULTS = os.path.join(bench.OUT, "gen-results.json")
EN_SECONDS = float(os.environ.get("GEN_EN_SECONDS", "480"))
JA_SECONDS = float(os.environ.get("GEN_JA_SECONDS", "360"))
FILM_SNR_DB = 0.0  # speech against the film's music and effects, over the whole clip: an action scene, not a quiet one
OLD_SNR_DB = 5.0  # the old film: music a little lower, then a narrow band, hum and hiss
MUSCI = ("Musci-research/Musci-ASR-2.4B", "18dd8264a5e7b79057b6a04ecfc7a03251d232e4")  # the revision whose code was read
QWEN = "Qwen/Qwen3-ASR-1.7B"


def log(*parts) -> None:
    print(*parts, flush=True)


# ------------------------------------------------------------------------------------------------ voice detector

def vad_track(pcm: np.ndarray) -> np.ndarray:
    """
    Speech probability per 10 ms: Silero v5 (the model the site runs in the browser), 32 ms steps held for their 10 ms slots. Run from the
    ONNX file inside the silero-vad package with onnxruntime, so neither torchaudio nor the package's own imports are needed.
    """
    import importlib.util

    import onnxruntime as ort

    path = os.environ.get("GEN_SILERO_ONNX")
    if not path:
        spec = importlib.util.find_spec("silero_vad")  # (finds the package without running it)
        path = os.path.join(list(spec.submodule_search_locations)[0], "data", "silero_vad.onnx")
    if path not in _MODELS:
        _MODELS[path] = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    sess = _MODELS[path]
    x = np.pad(np.ascontiguousarray(pcm, dtype=np.float32), (0, (-len(pcm)) % 512))
    state, ctx, sr = np.zeros((2, 1, 128), np.float32), np.zeros((1, 64), np.float32), np.array(SR, dtype=np.int64)
    steps = np.zeros(len(x) // 512, dtype=np.float32)
    for k in range(len(steps)):
        inp = np.concatenate([ctx, x[None, k * 512: (k + 1) * 512]], axis=1)
        out, state = sess.run(None, {"input": inp, "state": state, "sr": sr})
        ctx = inp[:, -64:]
        steps[k] = float(out.reshape(-1)[0])
    # (32 ms steps to 10 ms values exactly as the site does it, src/client/subsync/silero.ts resampleProbability.)
    x = np.arange(len(pcm) // 160) * 0.01 / 0.032 - 0.5
    a = np.clip(np.floor(x), 0, len(steps) - 1).astype(int)
    z = np.minimum(len(steps) - 1, a + 1)
    f = np.maximum(0, x - a)
    return (steps[a] * (1 - f) + steps[z] * f).astype(np.float32)


def p_at(p: np.ndarray, t: float) -> float:
    return float(p[min(len(p) - 1, max(0, int(t * 100)))]) if len(p) else 0.0


def first_speech(p: np.ndarray, a: float, b: float, th: float = 0.5) -> float | None:
    i0, i1 = max(0, int(a * 100)), min(len(p), int(b * 100) + 1)
    idx = np.nonzero(p[i0:i1] >= th)[0]
    return (i0 + int(idx[0])) / 100 if len(idx) else None


# ------------------------------------------------------------------------------------------------ pieces

def pieces(pcm: np.ndarray, p: np.ndarray, lo: float = 10.0, hi: float = 20.0) -> list[tuple[float, float]]:
    """10-20 s pieces covering all the sound, cut in the middle of the longest stretch the voice detector calls quiet (else the quietest 20 ms)."""
    total = len(pcm) / SR
    out, at = [], 0.0
    while total - at > hi:
        a, b = int((at + lo) * 100), int((at + hi) * 100)
        quiet = np.append(p[a:b] < 0.3, False)
        best, best_len, run = None, 0, None
        for i, q in enumerate(quiet):
            if q and run is None:
                run = i
            elif not q and run is not None:
                if i - run > best_len:
                    best, best_len = (run + i) // 2, i - run
                run = None
        if best is not None and best_len >= 10:
            cut = (a + best) / 100
        else:
            rms = bench.frame_rms(pcm[int((at + lo) * SR): int((at + hi) * SR)])
            cut = at + lo + float(np.argmin(rms)) * 0.02 + 0.01 if len(rms) else at + hi
        out.append((at, cut))
        at = cut
    out.append((at, total))
    return out


# ------------------------------------------------------------------------------------------------ the checks

MIN_MOVE_S = 0.25  # (smaller moves only trade the aligner's error for the voice detector's: with the official ONNX file, moving every
#                     word by its first frame over 0.5 put six correct starts 60-130 ms late; the misses this is for are 1.5-8 s)


def fix_stretched(words: list[Word], p: np.ndarray) -> tuple[list[Word], dict]:
    """A word starting where no speech is heard starts at the first moment inside it where it is; words with no speech in them are counted."""
    out, moved, unsure = [], 0, 0
    for w in words:
        if p_at(p, w.start) < 0.5:
            s = first_speech(p, w.start, w.end)
            if s is not None and s >= w.start + MIN_MOVE_S:
                out.append(Word(w.text, s, max(w.end, s + 0.02)))
                moved += 1
                continue
            if s is None:
                unsure += 1
        out.append(w)
    return out, {"moved": moved, "in_silence": unsure}


def missed_stretches(qwen: list[Word], whisper: list[Word], lang: str) -> list[tuple[float, float, list[Word]]]:
    """
    Stretches where Whisper heard words and Qwen gave none within 0.5 s. (No loudness gate here: the sentence Qwen dropped in the first
    measurement is a recording ~40 dB quieter than the others, below any floor. Whether there is speech is asked of the voice detector
    once the stretch is raised to normal loudness, in generate().)
    """
    if not whisper:
        return []
    starts = np.array(sorted(q.start for q in qwen)) if qwen else np.zeros(0)
    ends = np.array(sorted(q.end for q in qwen)) if qwen else np.zeros(0)

    def near(w: Word) -> bool:  # any Qwen word overlapping [w.start - 0.5, w.end + 0.5]
        if not len(starts):
            return False
        before = np.searchsorted(starts, w.end + 0.5)  # words starting before the window ends
        after = len(ends) - np.searchsorted(ends, w.start - 0.5)  # words ending after the window starts
        return before + after > len(starts)

    groups: list[list[Word]] = []
    for w in sorted(whisper, key=lambda x: x.start):
        if near(w):
            continue
        if groups and w.start - groups[-1][-1].end < 1.0:
            groups[-1].append(w)
        else:
            groups.append([w])
    out = []
    for g in groups:
        s, e = g[0].start, g[-1].end
        n = sum(len(bench.tokens(w.text, lang)) for w in g)
        if e - s >= 0.8 and n >= (4 if lang == "ja" else 3):
            out.append((s, e, g))
    return out


def raised(x: np.ndarray, target: float = 0.05, cap_db: float = 40.0) -> tuple[np.ndarray, float]:
    """The stretch at normal speaking loudness (its RMS to `target`, at most +40 dB), and the gain in dB."""
    r = float(np.sqrt(np.mean(x ** 2))) if len(x) else 0.0
    g = min(10 ** (cap_db / 20), target / max(r, 1e-9))
    return np.clip(x * g, -1, 1).astype(np.float32), round(20 * float(np.log10(g)), 1)


def shifted(words: list[Word], by: float) -> list[Word]:
    return [Word(w.text, w.start + by, w.end + by) for w in words]


# ------------------------------------------------------------------------------------------------ lines

def lines_of(words: list[Word], lang: str) -> list[Cue]:
    """
    Plain rules: a new line after a pause over 0.5 s, a sentence end, 7 s, or the length of two lines; a line that is full breaks at its
    longest pause in its second half (Qwen gives Japanese without punctuation, so length alone would cut words like 現地|企業 apart);
    then enough time to read it, never into the next line, never over 7 s.
    """
    limit, cps, join = (32, 8.0, "") if lang == "ja" else (84, 17.0, " ")
    size = lambda ws: len(join.join(x.text for x in ws))  # noqa: E731
    cues: list[list[Word]] = []
    for w in sorted(words, key=lambda x: x.start):
        if cues:
            cur = cues[-1]
            if w.start - cur[-1].end <= 0.5 and w.end - cur[0].start <= 7.0 and not re.search(r"[。？！.?!]$", cur[-1].text):
                if size(cur) + len(join) + len(w.text) <= limit:
                    cur.append(w)
                    continue
                if len(cur) >= 4:
                    half = len(cur) // 2
                    k = max(range(half, len(cur)), key=lambda i: cur[i].start - cur[i - 1].end)
                    cues[-1], rest = cur[:k], cur[k:]
                    if size(rest) + len(join) + len(w.text) <= limit and w.end - rest[0].start <= 7.0:
                        cues.append(rest + [w])
                    else:
                        cues += [rest, [w]]
                    continue
        cues.append([w])
    out = []
    for n, c in enumerate(cues):
        text = join.join(x.text for x in c).strip()
        start = c[0].start
        end = min(start + 7.0, c[-1].end)
        want = start + max(1.0, len(text) / cps)
        nxt = cues[n + 1][0].start - 0.08 if n + 1 < len(cues) else want
        out.append(Cue(start, min(start + 7.0, max(end, min(want, nxt))), text))
    return out


# ------------------------------------------------------------------------------------------------ scoring

_EN = None


def norm(text: str, lang: str) -> list[str]:
    """One normaliser for every engine and the reference: Whisper's English normaliser (numbers, spellings) when there, else plain tokens."""
    global _EN
    if lang == "en":
        try:
            if _EN is None:
                from transformers.models.whisper.english_normalizer import EnglishTextNormalizer

                _EN = EnglishTextNormalizer({})
            return _EN(text).split()
        except Exception:
            pass
    return bench.tokens(text, lang)


def score(ref: list[Cue], words: list[Word], lang: str) -> dict:
    joiner = "" if lang == "ja" else " "
    err = bench.edits(norm(joiner.join(c.text for c in ref), lang), norm(joiner.join(w.text for w in words), lang))
    ref_n = max(1, len(norm(joiner.join(c.text for c in ref), lang)))
    ref_tokens, first = [], []
    for c in ref:
        first.append(len(ref_tokens))
        ref_tokens += bench.tokens(c.text, lang)
    first.append(len(ref_tokens))
    hyp, when = [], []
    for w in words:
        for t in bench.tokens(w.text, lang):
            hyp.append(t)
            when.append(w.start)
    where: dict[int, int] = {}
    for b in difflib.SequenceMatcher(None, ref_tokens, hyp, autojunk=False).get_matching_blocks():
        for k in range(b.size):
            where[b.a + k] = b.b + k
    offsets, heard, worst, per_line = [], 0, [], {}
    for n, c in enumerate(ref):
        span = range(first[n], first[n + 1])
        if len(span) and sum(i in where for i in span) / len(span) >= 0.5:
            heard += 1
        if first[n] in where:
            d = when[where[first[n]]] - c.start
            offsets.append(d)
            per_line[n] = round(d, 3)
            if abs(d) > 0.3:
                worst.append((n, round(d, 2)))
    off = np.abs(np.array(offsets)) if offsets else np.zeros(0)
    outside = sum(1 for w in words if not any(c.start - 0.5 <= w.start <= c.end + 0.3 for c in ref))
    return {
        ("cer" if lang == "ja" else "wer"): round(err / ref_n, 4),
        "ref_tokens": ref_n,
        "lines_heard": f"{heard}/{len(ref)}",
        "lines_timed": len(offsets),
        "within_0_1": int((off <= 0.1).sum()),
        "within_0_3": int((off <= 0.3).sum()),
        "start_median_s": round(float(np.median(off)), 3) if len(off) else None,
        "off_by_more_than_0_3": worst[:12],
        "words_where_nobody_speaks": outside,
        "per_line": per_line,
    }


def made_worse(before: dict, after: dict) -> list:
    """Lines whose start moved more than 50 ms further from the reference between two scores (what a check broke)."""
    a, b = before["per_line"], after["per_line"]
    return [(n, a[n], b[n]) for n in a if n in b and abs(b[n]) > abs(a[n]) + 0.05]


# ------------------------------------------------------------------------------------------------ the pipeline

def generate(engine, pcm: np.ndarray, lang: str, p: np.ndarray, second: list[Word] | None, vad=None) -> dict:
    """The whole pipeline on one sound. Returns words after each step, the cost, and what each check did."""
    vad = vad or vad_track
    t0 = time.time()
    raw: list[Word] = []
    first_piece = None
    for a, b in pieces(pcm, p):
        engine.at = a  # (where the piece starts: only the replay engine reads it)
        raw += [Word(w.text, w.start + a, w.end + a) for w in engine.transcribe(pcm[int(a * SR): int(b * SR)], lang)]
        if first_piece is None:
            first_piece = time.time() - t0
    fixed, fix_stats = fix_stretched(raw, p)
    final, retried, recovered, fallback, rejected, gains = list(fixed), 0, 0, 0, 0, []
    for s, e, g in missed_stretches(fixed, second or [], lang):
        # (No word of the first pass touches [s - 0.5, e + 0.5], so what the retry hears there cannot double one.)
        a, b = max(0.0, s - 0.5), min(len(pcm) / SR, e + 0.5)
        piece, gain = raised(pcm[int(a * SR): int(b * SR)])
        p2 = vad(piece)
        if float(p2.max(initial=0)) < 0.5:
            rejected += 1  # no speech even at normal loudness: Whisper's words there are taken as invented
            continue
        retried += 1
        gains.append(gain)
        engine.at, engine.retry = a, True
        try:
            again, _ = fix_stretched(engine.transcribe(piece, lang), p2)
        finally:
            engine.retry = False
        again = shifted(again, a)
        if again:
            recovered += 1
            final += again
        else:
            fallback += 1
            final += shifted(fix_stretched(shifted(g, -a), p2)[0], a)
    final.sort(key=lambda w: w.start)
    total = time.time() - t0
    return {
        "raw": raw, "fixed": fixed, "final": final,
        "first_piece_s": round(first_piece or 0.0, 2), "total_s": round(total, 1), "x_realtime": round(len(pcm) / SR / max(total, 1e-6), 1),
        "checks": {**fix_stats, "second_listener_stretches": retried, "rejected_no_speech": rejected, "recovered_by_qwen": recovered,
                   "whisper_words_used": fallback, "gain_db": gains},
    }


# ------------------------------------------------------------------------------------------------ clips

def fleurs_clip(code: str, lang: str, seconds: float) -> tuple[np.ndarray, list[Cue], list[float]]:
    """FLEURS test sentences (each once) joined with 0.6 s gaps. Returns the sound, the lines (start = where speech starts), and where each recording starts."""
    import csv
    import tarfile
    import urllib.request

    base = f"https://huggingface.co/datasets/google/fleurs/resolve/main/data/{code}"
    tsv = bench.fetch(f"{base}/test.tsv", f"fleurs_{code}_test.tsv")
    texts: dict[str, str] = {}
    with open(tsv, encoding="utf-8") as f:
        for row in csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            names = [i for i, v in enumerate(row) if v.endswith(".wav")]
            if names and names[0] + 1 < len(row):
                texts[os.path.basename(row[names[0]])] = row[names[0] + 1]
    pcs, ref, starts, at, used = [], [], [], 0.0, set()
    req = urllib.request.Request(f"{base}/audio/test.tar.gz", headers={"User-Agent": "kino-asr-bench"})
    with urllib.request.urlopen(req, timeout=120) as res, tarfile.open(fileobj=res, mode="r|gz") as tar:
        for member in tar:
            name = os.path.basename(member.name)
            if not member.isfile() or name not in texts or texts[name] in used:
                continue
            used.add(texts[name])
            pcm = bench.pcm_of(tar.extractfile(member).read())
            if len(pcm) < SR:
                continue
            starts.append(at)
            ref.append(Cue(at + bench.speech_onset(pcm), at + len(pcm) / SR, texts[name]))
            pcs += [pcm, np.zeros(int(0.6 * SR), dtype=np.float32)]
            at += len(pcm) / SR + 0.6
            if at >= seconds:
                break
    return np.concatenate(pcs), ref, starts


def film_background(length: int) -> np.ndarray:
    """Tears of Steel's music and effects with no voices: 2 s windows at least 1.5 s from any subtitle, where Silero hears no speech, louder than the median such window."""
    film = bench.pcm_of(bench.fetch(bench.TOS_FILM, "tos_720p.mov"))
    with open(bench.fetch(bench.TOS_SRT, "TOS-en.srt"), encoding="utf-8", errors="replace") as f:
        cues = bench.parse_srt(f.read())
    p = vad_track(film)
    wins = []
    for s in np.arange(0, len(film) / SR - 2, 2.0):
        if any(c.start - 1.5 < s + 2 and s < c.end + 1.5 for c in cues):
            continue
        if float(p[int(s * 100): int((s + 2) * 100)].max(initial=0)) >= 0.3:
            continue
        wins.append((s, float(np.sqrt(np.mean(film[int(s * SR): int((s + 2) * SR)] ** 2)))))
    med = float(np.median([r for _, r in wins]))
    keep = [s for s, r in wins if r >= med]
    log(f"background: {len(keep)} windows of 2 s ({len(wins)} without voices)")
    fade = np.linspace(0, 1, int(0.02 * SR), dtype=np.float32)
    parts = []
    for s in keep:
        w = film[int(s * SR): int((s + 2) * SR)].copy()
        w[: len(fade)] *= fade
        w[-len(fade):] *= fade[::-1]
        parts.append(w)
    bg = np.concatenate(parts)
    return np.tile(bg, int(np.ceil(length / len(bg))))[:length]


def speech_rms(pcm: np.ndarray, ref: list[Cue]) -> float:
    sel = np.concatenate([pcm[int(c.start * SR): int(c.end * SR)] for c in ref])
    return float(np.sqrt(np.mean(sel ** 2)))


def mix(speech: np.ndarray, bg: np.ndarray, ref: list[Cue], snr_db: float) -> np.ndarray:
    g = speech_rms(speech, ref) / max(1e-9, float(np.sqrt(np.mean(bg ** 2)))) / (10 ** (snr_db / 20))
    return (speech + g * bg).astype(np.float32)


def old_film(speech: np.ndarray, bg: np.ndarray, ref: list[Cue]) -> np.ndarray:
    """A simulated old optical soundtrack: music at +5 dB, a 200-4000 Hz band, 60 Hz hum with two harmonics, and hiss."""
    from scipy.signal import butter, sosfiltfilt

    x = mix(speech, bg, ref, OLD_SNR_DB)
    x = sosfiltfilt(butter(4, [200, 4000], btype="band", fs=SR, output="sos"), x)  # zero phase: no delay
    level = speech_rms(speech, ref)
    t = np.arange(len(x)) / SR
    hum = sum(np.sin(2 * np.pi * f * t) / k for k, f in enumerate((60, 120, 180), 1)) * level * 10 ** (-25 / 20)
    rng = np.random.default_rng(7)
    hiss = rng.standard_normal(len(x)) * level * 10 ** (-18 / 20)
    return (x + hum + hiss).astype(np.float32)


def si_sdr(est: np.ndarray, ref: np.ndarray) -> float:
    n = min(len(est), len(ref))
    est, ref = est[:n] - est[:n].mean(), ref[:n] - ref[:n].mean()
    a = float(np.dot(est, ref) / max(1e-9, np.dot(ref, ref)))
    e = a * ref
    return round(10 * np.log10(max(1e-9, np.dot(e, e)) / max(1e-9, np.dot(est - e, est - e))), 2)


def lag_ms(est: np.ndarray, ref: np.ndarray) -> float:
    """Delay of `est` against `ref` (positive = late), from the cross-correlation of their 10 ms loudness."""
    a, b = bench.frame_rms(est, 160), bench.frame_rms(ref, 160)
    n = min(len(a), len(b))
    a, b = a[:n] - a[:n].mean(), b[:n] - b[:n].mean()
    lags = range(-20, 21)
    c = [float(np.dot(a[max(0, k):n + min(0, k)], b[max(0, -k):n - max(0, k)])) for k in lags]
    return float(list(lags)[int(np.argmax(c))] * 10)


def isolate(name: str, pcm: np.ndarray) -> np.ndarray:
    """The speech of a 16 kHz sound, by DBS-TIGER-DnR (speech stem) or Demucs htdemucs (vocals stem), at 44.1 kHz and back."""
    import torch
    from scipy.signal import resample_poly

    up = resample_poly(pcm, 441, 160).astype(np.float32)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    with torch.inference_mode():
        if name == "tiger":
            from dbs.engine import separate
            from dbs.models import DBSTIGER

            if "tiger" not in _MODELS:
                _MODELS["tiger"] = DBSTIGER.from_pretrained("JusperLee/DBS-TIGER-DnR").eval().to(dev)
            out = separate(_MODELS["tiger"], torch.from_numpy(up).view(1, 1, -1).to(dev),
                           {"mode": "chunked", "chunk_seconds": 6.0, "hop_seconds": 3.0}, sample_rate=44100)[0]
            speech = out[2].reshape(-1).float().cpu().numpy()  # music, sfx, speech
        else:
            from demucs.apply import apply_model
            from demucs.pretrained import get_model

            if "demucs" not in _MODELS:
                _MODELS["demucs"] = get_model("htdemucs").eval().to(dev)
            m = _MODELS["demucs"]
            x = torch.from_numpy(np.stack([up, up]))[None].to(dev)
            out = apply_model(m, x, split=True, overlap=0.25, progress=False, device=dev)[0]
            speech = out[m.sources.index("vocals")].mean(0).float().cpu().numpy()
    back = resample_poly(speech, 160, 441).astype(np.float32)
    return np.pad(back, (0, max(0, len(pcm) - len(back))))[: len(pcm)]


_MODELS: dict = {}


def prepare() -> None:
    os.makedirs(GEN, exist_ok=True)
    notes = []
    for code, lang, secs in (("ja_jp", "ja", JA_SECONDS), ("en_us", "en", EN_SECONDS)):
        clean, ref, starts = fleurs_clip(code, lang, secs)
        with open(os.path.join(GEN, f"{lang}-ref.json"), "w", encoding="utf-8") as f:
            json.dump({"ref": [[c.start, c.end, c.text] for c in ref], "starts": starts}, f, ensure_ascii=False)
        bg = film_background(len(clean))
        sounds = {"clean": clean, "film": mix(clean, bg, ref, FILM_SNR_DB), "old": old_film(clean, bg, ref)}
        for name, x in sounds.items():
            np.save(os.path.join(GEN, f"{lang}-{name}.npy"), x)
        log(f"{lang}: {len(clean) / SR:.0f} s, {len(ref)} lines; film mix SI-SDR {si_sdr(sounds['film'], clean)} dB, old {si_sdr(sounds['old'], clean)} dB")
        for iso in ("tiger", "demucs"):
            for name in ("clean", "film", "old"):
                if iso == "demucs" and name == "clean":
                    continue  # (the control for "always or only as a retry" is TIGER on clean sound)
                try:
                    t = time.time()
                    y = isolate(iso, sounds[name])
                    took = time.time() - t
                    np.save(os.path.join(GEN, f"{lang}-{name}+{iso}.npy"), y)
                    line = f"{lang}-{name}+{iso}: {len(y) / SR / took:.0f}x real time, SI-SDR vs clean speech {si_sdr(y, clean)} dB (input {si_sdr(sounds[name], clean)} dB), lag {lag_ms(y, clean):+.0f} ms"
                except Exception as error:  # noqa: BLE001 (an isolator that will not install or run is reported, the rest go on)
                    line = f"{lang}-{name}+{iso}: FAILED {error!r}"[:300]
                log(line)
                notes.append(line)
    with open(os.path.join(GEN, "prepare-notes.json"), "w", encoding="utf-8") as f:
        json.dump(notes, f, ensure_ascii=False, indent=1)


# ------------------------------------------------------------------------------------------------ engines

class Musci(bench.Engine):
    name = "Musci-ASR-2.4B + ForcedAligner-0.6B"

    def load(self):
        import torch
        from huggingface_hub import hf_hub_download
        from qwen_asr import Qwen3ForcedAligner
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from transformers.dynamic_module_utils import get_class_from_dynamic_module

        repo, rev = MUSCI
        # (The card loads it in bfloat16, which a T4 has no hardware for: float16 by default here, GEN_MUSCI_DTYPE=bfloat16|float32 to change.)
        dtype = getattr(torch, os.environ.get("GEN_MUSCI_DTYPE", "float16"))
        self.name += f" ({dtype})".replace("torch.", "")
        self.model = AutoModelForCausalLM.from_pretrained(repo, revision=rev, dtype=dtype, trust_remote_code=True).to("cuda:0").eval()
        tok = AutoTokenizer.from_pretrained(repo, revision=rev, trust_remote_code=True)
        proc = get_class_from_dynamic_module("processing_Musci.MusciProcessor", repo, revision=rev)
        mel = get_class_from_dynamic_module("processing_Musci.MelConfig", repo, revision=rev)
        # (The card's settings, given explicitly: the file's own default FFT size is 640, the card says 400.)
        self.proc = proc(tok, config=mel(mel_sr=16000, mel_dim=128, mel_n_fft=400, mel_hop_length=160), enable_time_marker=False)
        self.proc.load_template(hf_hub_download(repo, "chat_template_default.py", revision=rev))
        self.aligner = Qwen3ForcedAligner.from_pretrained("Qwen/Qwen3-ForcedAligner-0.6B", dtype=bench.torch_dtype(), device_map="cuda:0")

    def transcribe(self, pcm, lang):
        import torch

        inputs = self.proc(audio=pcm, return_tensors="pt").to("cuda:0")
        inputs["audio_data"] = inputs["audio_data"].to(self.model.dtype)
        with torch.no_grad():
            out = self.model.generate(**inputs, max_new_tokens=512, do_sample=False, num_beams=1, use_cache=True, eos_token_id=[self.proc.end_token_id])
        text = self.proc.batch_decode(out[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0].strip()
        if not text:
            return []
        r = self.aligner.align(audio=(pcm, SR), text=text, language="English")[0]
        return bench.stamp_words(r, len(pcm) / SR) or [Word(text, 0.0, len(pcm) / SR)]


class Replay(bench.Engine):
    """
    Saved word times (diag-*.json) given back for the piece asked (generate() sets `at`): the checks and the lines on CPU, with no model.
    A retry hears nothing (saved words cannot say what a second listen would), so the fallback is what gets tested.
    """
    retry = False

    def __init__(self, path: str, name: str):
        with open(path, encoding="utf-8") as f:
            self.words = [Word(w[0], float(w[1]), float(w[2])) if isinstance(w, list) else Word(w["text"], w["start"], w["end"])
                          for w in json.load(f)["words"]]
        self.name = name
        self.at = 0.0

    def transcribe(self, pcm, lang):
        if self.retry:
            return []
        a, b = self.at, self.at + len(pcm) / SR
        return [Word(w.text, w.start - a, w.end - a) for w in self.words if a <= w.start < b]


# ------------------------------------------------------------------------------------------------ runs

def load_ref(lang: str) -> list[Cue]:
    with open(os.path.join(GEN, f"{lang}-ref.json"), encoding="utf-8") as f:
        return [Cue(s, e, t) for s, e, t in json.load(f)["ref"]]


ORDER = ["clean", "film", "film+tiger", "old", "old+tiger", "clean+tiger", "film+demucs", "old+demucs"]  # most telling first


def sounds(lang: str) -> list[str]:
    names = {n[len(lang) + 1: -4] for n in os.listdir(GEN) if n.startswith(lang + "-") and n.endswith(".npy")}
    only = [s for s in os.environ.get("GEN_SOUNDS", "").split(",") if s]
    return [s for s in ORDER if s in names and (not only or s in only)]


def words_path(engine: str, lang: str, sound: str) -> str:
    return os.path.join(GEN, f"words-{engine}-{lang}-{sound}.json")


def save_words(path: str, words: list[Word]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump([[w.text, round(w.start, 3), round(w.end, 3)] for w in words], f, ensure_ascii=False)


def read_words(path: str) -> list[Word] | None:
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return [Word(t, s, e) for t, s, e in json.load(f)]


def append_result(r: dict) -> None:
    allr = []
    if os.path.exists(RESULTS):
        with open(RESULTS, encoding="utf-8") as f:
            allr = json.load(f)
    allr.append(r)
    os.makedirs(bench.OUT, exist_ok=True)
    with open(RESULTS, "w", encoding="utf-8") as f:
        json.dump(allr, f, ensure_ascii=False, indent=1)


def table(rows: list[dict]) -> str:
    out = ["| engine | lang | sound | WER/CER (before checks) | lines heard | timed: within 0.1 / 0.3 s (before checks) | median | words where nobody speaks | checks | first piece | x real time |",
           "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        if "error" in r:
            out.append(f"| {r['engine']} | {r.get('lang')} | {r.get('sound')} | failed: {r['error'][:90]} |||||||")
            continue
        s, raw = r["final"], r["raw"]
        out.append(f"| {r['engine']} | {r['lang']} | {r['sound']} | {s.get('wer', s.get('cer'))} ({raw.get('wer', raw.get('cer'))}) | {s['lines_heard']} | "
                   f"{s['within_0_1']} / {s['within_0_3']} of {s['lines_timed']} ({raw['within_0_3']}) | {s['start_median_s']} | {s['words_where_nobody_speaks']} | "
                   f"{r.get('checks', '')} | {r.get('first_piece_s')} s | {r.get('x_realtime')} |")
    return "\n".join(out)


def run(which: str) -> None:
    rows = []
    if which == "whisper":
        engine, langs = bench.WhisperEngine(), ("ja", "en")
    elif which == "qwen":
        engine, langs = bench.QwenEngine(QWEN), ("ja", "en")
    elif which == "musci":
        engine, langs = Musci(), ("en",)
    else:
        raise SystemExit(f"unknown engine {which}")
    try:
        t = time.time()
        engine.load()
        engine.transcribe(np.zeros(5 * SR, dtype=np.float32) + np.float32(1e-4), langs[0])
        log(f"{engine.name}: loaded in {time.time() - t:.0f} s")
    except Exception as error:  # noqa: BLE001
        r = {"engine": getattr(engine, "name", which), "error": f"load: {error!r}"[:500]}
        append_result(r)
        log(table([r]))
        return
    jobs = [(lang, s, "") for lang in langs for s in sounds(lang)]
    if which == "qwen":
        jobs.append(("ja", "clean", "names"))
    for lang, sound, ctx in jobs:
        try:
            pcm = np.load(os.path.join(GEN, f"{lang}-{sound}.npy"))
            ref = load_ref(lang)
            p = vad_track(pcm)
            if ctx:
                # (A title's cast and places, as TMDB would give them; here the clip's own proper names: katakana runs of 3+ and names written
                # with a middle dot. It shows what naming the people and places does, it is not a blind test.)
                names = sorted({m for c in ref for m in re.findall(r"[ァ-ヶー・]{3,}", c.text)})
                engine.context = "登場する名前・地名: " + "、".join(names)
            second = read_words(words_path("whisper", lang, sound)) if which != "whisper" else None
            try:
                g = generate(engine, pcm, lang, p, second)
            finally:
                if ctx:
                    engine.context = ""
            if which == "whisper":
                save_words(words_path("whisper", lang, sound), g["raw"])
            stem = f"{which}-{lang}-{sound}{'-' + ctx if ctx else ''}"
            bench.write_srt(lines_of(g["final"], lang), os.path.join(bench.OUT, f"gen-{stem}.srt"))
            with open(os.path.join(bench.OUT, f"gen-words-{stem}.json"), "w", encoding="utf-8") as f:
                json.dump({k: [[w.text, round(w.start, 3), round(w.end, 3)] for w in g[k]] for k in ("raw", "fixed", "final")}, f, ensure_ascii=False)
            r = {"engine": engine.name + (f" + context ({ctx})" if ctx else ""), "lang": lang, "sound": sound, "audio_s": round(len(pcm) / SR, 1),
                 "first_piece_s": g["first_piece_s"], "total_s": g["total_s"], "x_realtime": g["x_realtime"],
                 "raw": score(ref, g["raw"], lang), "fixed": score(ref, g["fixed"], lang), "final": score(ref, g["final"], lang)}
            r["made_worse_by_fix"] = made_worse(r["raw"], r["fixed"])
            if which != "whisper":
                r["checks"] = g["checks"]
            if lang == "ja" and len(ref) > 15:
                # (Lines 1-15 are the clip the checks were tuned on (MIN_MOVE_S, the second listener); lines 16 on were never looked at.)
                r["first_15_lines"] = score(ref[:15], [w for w in g["final"] if w.start < ref[14].end + 0.5], lang)
                r["lines_16_on"] = score(ref[15:], [w for w in g["final"] if w.start >= ref[15].start - 0.5], lang)
                r["lines_16_on_before_checks"] = score(ref[15:], [w for w in g["raw"] if w.start >= ref[15].start - 0.5], lang)
        except Exception as error:  # noqa: BLE001
            r = {"engine": engine.name, "lang": lang, "sound": sound, "error": repr(error)[:500]}
        append_result(r)
        rows.append(r)
        log(brief(r))
    engine.unload()
    log(table(rows))


def brief(r: dict) -> str:
    """One line per run, short enough to read off the notebook page."""
    if "error" in r:
        return f"{r['engine']} {r.get('lang')} {r.get('sound')}: FAILED {r['error'][:200]}"
    f, raw = r["final"], r["raw"]
    err = lambda s: s.get("wer", s.get("cer"))  # noqa: E731
    out = (f"{r['engine']} | {r['lang']} {r['sound']} | err {err(raw)} -> {err(f)} | heard {f['lines_heard']} | 0.3 s: {raw['within_0_3']} -> "
           f"{f['within_0_3']}/{f['lines_timed']} (0.1 s: {f['within_0_1']}) | off {f['off_by_more_than_0_3'][:4]} | stray {f['words_where_nobody_speaks']} | "
           f"worse {r['made_worse_by_fix'][:3]} | {r.get('checks', '')} | {r['x_realtime']}x, first piece {r['first_piece_s']} s")
    for k in ("first_15_lines", "lines_16_on", "lines_16_on_before_checks"):
        if k in r:
            s = r[k]
            out += f"\n    {k}: err {err(s)} heard {s['lines_heard']} 0.3 s {s['within_0_3']}/{s['lines_timed']} off {s['off_by_more_than_0_3'][:4]}"
    return out


def replay() -> None:
    """CPU: the saved Qwen and Whisper words of the 188 s Japanese clip, through the checks and the lines, scored against its reference."""
    d = os.environ["GEN_REPLAY_DIR"]
    pcm = np.fromfile(os.path.join(d, "fleurs.f32"), dtype=np.float32)
    # (The site's own Silero port by default; GEN_REPLAY_VAD=onnx uses the official ONNX file, as the Colab run does.)
    p = vad_track(pcm) if os.environ.get("GEN_REPLAY_VAD") == "onnx" else np.fromfile(os.path.join(d, "fleurs-vad.f32"), dtype=np.float32)
    with open(os.path.join(d, "fleurs-ref.json"), encoding="utf-8") as f:
        rows = json.load(f)  # (line starts by the loudness rule, checked against the site's Silero)
    with open(os.path.join(d, "diag-qwen-qwen3-asr-1-7b.json"), encoding="utf-8") as f:
        texts = [r["text"] for r in json.load(f)["rows"]]
    ref = [Cue(r["onset"], r["end"], t) for r, t in zip(rows, texts)]
    whisper = Replay(os.path.join(d, "diag-whisper.json"), "whisper (saved)").words
    qwen = Replay(os.path.join(d, "diag-qwen-qwen3-asr-1-7b.json"), "Qwen3-ASR-1.7B (saved)")
    log("pieces at", [round(a, 1) for a, _ in pieces(pcm, p)])
    g = generate(qwen, pcm, "ja", p, whisper)
    scores = {step: score(ref, g[step], "ja") for step in ("raw", "fixed", "final")}
    for step, s in scores.items():
        log(step, json.dumps({k: v for k, v in s.items() if k != "per_line"}, ensure_ascii=False))
    log("lines the fix made worse (line, before, after):", made_worse(scores["raw"], scores["fixed"]))
    log("checks", g["checks"])
    log("whisper alone", json.dumps(score(ref, fix_stretched(whisper, p)[0], "ja"), ensure_ascii=False))
    cues = lines_of(g["final"], "ja")
    bench.write_srt(cues, os.path.join(bench.OUT, "gen-replay-ja.srt"))
    log(f"{len(cues)} lines written; longest {max(c.end - c.start for c in cues):.1f} s, shortest {min(c.end - c.start for c in cues):.1f} s")
    for c in cues[:6]:
        log(f"  {c.start:7.2f} {c.end:7.2f}  {c.text}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "prepare":
        prepare()
    elif cmd == "run":
        run(sys.argv[2])
    elif cmd == "replay":
        replay()
    else:
        raise SystemExit(__doc__)
