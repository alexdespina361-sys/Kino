"""
Line-by-line timing on the Japanese clip, to tell a late aligner from a wrong reference: `python diag.py <engine> [fixed|pause]`.
<engine> is a Qwen3-ASR model id (with the forced aligner) or "whisper". For each reference line it prints where its recording starts,
where the reference says its speech starts (`speech_onset`), a second onset found against the recording's own noise floor, where the
engine put the line's first matched character, and a loudness strip of the recording's first 4 s (one character per 100 ms).
Writes <BENCH_OUT>/diag-<engine>.json with every word's time.
"""
from __future__ import annotations

import difflib
import json
import os
import re
import sys

os.environ.setdefault("BENCH_CUT", sys.argv[2] if len(sys.argv) > 2 else "pause")
import numpy as np  # noqa: E402

import bench  # noqa: E402

SR = bench.SR


def floor_onset(pcm: np.ndarray) -> float:
    """Speech start against the recording's own noise: the first 100 ms louder than 4x its quiet level and 10% of its loudest.
    (The first try; it misses line 0. bench.speech_onset now uses 3x and 15%, which fits every line.)"""
    rms = bench.frame_rms(pcm)
    if not len(rms):
        return 0.0
    smooth = np.convolve(rms, np.ones(5) / 5, mode="same")
    noise = float(np.percentile(rms, 10))
    loud = np.nonzero(smooth > max(4 * noise, 0.1 * float(smooth.max())))[0]
    return float(max(0, loud[0] - 2)) * 0.02 if len(loud) else 0.0


def strip(pcm: np.ndarray) -> str:
    rms = bench.frame_rms(pcm[: 4 * SR], frame=1600)
    top = float(bench.frame_rms(pcm, frame=1600).max() or 1)
    return "".join(" .:-=#"[min(5, int(6 * v / top))] for v in rms)


def main() -> None:
    which = sys.argv[1] if len(sys.argv) > 1 else "Qwen/Qwen3-ASR-1.7B"
    clip = bench.japanese_clip()
    engine = bench.WhisperEngine() if which == "whisper" else bench.QwenEngine(which)
    engine.load()
    words: list[bench.Word] = []
    pieces = bench.pieces_of(clip.pcm)
    for at, end in pieces:
        off = at / SR
        words += [bench.Word(w.text, w.start + off, w.end + off) for w in engine.transcribe(clip.pcm[at:end], clip.lang)]
    engine.unload()

    ref_tokens, first = [], []
    for c in clip.ref:
        first.append(len(ref_tokens))
        ref_tokens += bench.tokens(c.text, "ja")
    hyp, when = [], []
    for w in words:
        for t in bench.tokens(w.text, "ja"):
            hyp.append(t)
            when.append(w.start)
    where: dict[int, int] = {}
    for b in difflib.SequenceMatcher(None, ref_tokens, hyp, autojunk=False).get_matching_blocks():
        for k in range(b.size):
            where[b.a + k] = b.b + k

    print(f"engine {engine.name}, cut {bench.CUT}; pieces at", [round(a / SR, 1) for a, _ in pieces])
    print("line | file at | ref onset (+s) | floor onset (+s) | engine first char | engine - ref | engine - floor | loudness, first 4 s | ref text / heard")
    rows = []
    for n, c in enumerate(clip.ref):
        file_at = 0.0 if n == 0 else clip.ref[n - 1].end + 0.6
        pcm = clip.pcm[int(file_at * SR): int(c.end * SR)]
        fl = file_at + floor_onset(pcm)
        i = first[n]
        got = when[where[i]] if i in where else None
        heard = "".join(w.text for w in words if file_at - 0.3 <= w.start < c.end)[:24]
        rows.append({"line": n, "file_at": round(file_at, 2), "ref_onset": round(c.start, 2), "floor_onset": round(fl, 2), "engine": got, "text": c.text, "heard": heard})
        d1 = f"{got - c.start:+.2f}" if got is not None else "-"
        d2 = f"{got - fl:+.2f}" if got is not None else "-"
        print(f"{n:2d} | {file_at:6.1f} | {c.start:6.2f} (+{c.start - file_at:.2f}) | {fl:6.2f} (+{fl - file_at:.2f}) | {got if got is None else round(got, 2)} | {d1} | {d2} | [{strip(pcm)}] | {c.text[:14]} / {heard}")
    name = re.sub(r"[^a-z0-9]+", "-", which.lower()).strip("-")
    with open(os.path.join(bench.OUT, f"diag-{name}.json"), "w", encoding="utf-8") as f:
        json.dump({"rows": rows, "words": [[w.text, round(w.start, 3), round(w.end, 3)] for w in words]}, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
