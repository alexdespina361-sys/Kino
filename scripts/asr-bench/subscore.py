"""
Subtitle scoring for the generation work: what a viewer would notice, not only the word error rate.

  python subscore.py format FILE.srt [--lang en|ja]
      formatting against the Netflix timed-text rules (English: 42 characters a line, 2 lines, 20 characters a second, 5/6 s to 7 s,
      2 frames between events) plus the line-break and capital-letter rules a program can check. Run it on the human file too.
  python subscore.py compare REF.srt HYP.srt [--lang en|ja]
      word error rate (normalised), reference lines heard, start offsets of matched lines, and generated lines with no reference line
      anywhere near them (the candidates for invented text, to be read by hand).
  python subscore.py sheet OUT_DIR REF.srt NAME=HYP.srt [NAME=HYP.srt ...] [--n 40] [--seed 1] [--lang en]
      a blind judging sheet: OUT_DIR/sheet.md lists a seeded random sample of reference lines, each with what every variant shows at that
      moment under a shuffled letter; OUT_DIR/key.json says which letter is which variant. Fill in each "judge" line, then:
  python subscore.py tally OUT_DIR
      counts per 100 lines for each variant.

Judging codes (several may be given, comma-separated; "ok" when none applies), against the reference line and what it means:
  M  meaning wrong (a word or phrase heard as something else that changes what is said)
  N  a name wrong (person, place, thing)
  X  missing (the line, or the part that carries its meaning, is not there)
  I  invented (words that nobody said, which a viewer would take as said)
  G  grammar (a sentence a careful subtitler would not write, though the meaning survives)
  C  capitals or punctuation wrong (sentence start, proper noun, "i", missing question mark, run-on)
A line that says the same thing in other words is ok: subtitles condense, and so may the generated ones.

Reference subtitle text must never go into the repository: OUT_DIR belongs outside it (WebPlayer/scratch).
"""
from __future__ import annotations

import difflib
import json
import os
import random
import re
import sys
import unicodedata
from dataclasses import dataclass, field

TIME = re.compile(r"\s*(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)")
RULES = {
    # Netflix English Timed Text Style Guide: 42 characters per line, 2 lines, adult reading speed 20 characters a second,
    # 5/6 s (20 frames at 24 fps) to 7 s on screen, a 2-frame gap between events.
    "en": {"max_chars": 42, "max_lines": 2, "max_cps": 20.0, "min_dur": 5 / 6, "max_dur": 7.0, "min_gap": 2 / 24},
    # Netflix Japanese: 13 full-width characters per line (horizontal), 2 lines, 4 characters a second.
    "ja": {"max_chars": 13, "max_lines": 2, "max_cps": 4.0, "min_dur": 5 / 6, "max_dur": 7.0, "min_gap": 2 / 24},
}
# A first line should not end on a word that belongs to the next one (Netflix: do not separate an article from its noun, a preposition
# or conjunction from what follows, a subject pronoun from its verb, a possessive from its noun).
WEAK_END = set("""a an the of to in on at for with from by about into onto over under after before through between without
and or but nor because if than my your his her its our their I""".split())


@dataclass
class Event:
    start: float
    end: float
    lines: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return " ".join(self.lines)


def read_srt(path: str) -> list[Event]:
    with open(path, encoding="utf-8-sig", errors="replace") as f:
        text = f.read()
    out = []
    for block in re.split(r"\r?\n\s*\r?\n", text.strip()):
        rows = [r.rstrip() for r in block.splitlines() if r.strip()]
        for i, row in enumerate(rows):
            m = TIME.match(row)
            if m:
                g = [int(x) for x in m.groups()]
                start = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 10 ** len(m.group(4))
                end = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 10 ** len(m.group(8))
                lines = [re.sub(r"<[^>]+>|\{[^}]+\}", "", x).strip() for x in rows[i + 1:]]
                lines = [x for x in lines if x]
                if lines:
                    out.append(Event(start, end, lines))
                break
    return sorted(out, key=lambda e: e.start)


def width(s: str) -> int:
    return len(s)


def is_cue_only(e: Event) -> bool:
    """A sound description or a song mark, not speech: [MUSIC], (laughs), ♪ ... ♪."""
    t = e.text.strip()
    return bool(re.fullmatch(r"[\[(].*[\])]|♪.*|#.*", t))


# ------------------------------------------------------------------------------------------------ formatting

def format_report(events: list[Event], lang: str = "en") -> dict:
    r = RULES[lang]
    counts = {k: 0 for k in ("too_long_line", "too_many_lines", "too_fast", "too_short", "too_long_on_screen", "gap_under_2_frames",
                             "overlap", "needless_break", "weak_break", "lower_case_sentence_start", "lower_case_i", "space_before_punctuation",
                             "double_space", "lone_dialogue_dash")}
    examples: dict[str, list[str]] = {k: [] for k in counts}

    def hit(k: str, e: Event) -> None:
        counts[k] += 1
        if len(examples[k]) < 3:
            examples[k].append(f"{e.start:.2f}: " + " / ".join(e.lines))

    prev = None
    for e in events:
        dur = e.end - e.start
        chars = sum(width(x) for x in e.lines) + (len(e.lines) - 1 if lang == "en" else 0)
        if any(width(x) > r["max_chars"] for x in e.lines):
            hit("too_long_line", e)
        if len(e.lines) > r["max_lines"]:
            hit("too_many_lines", e)
        if dur > 0 and chars / dur > r["max_cps"]:
            hit("too_fast", e)
        if dur < r["min_dur"]:
            hit("too_short", e)
        if dur > r["max_dur"]:
            hit("too_long_on_screen", e)
        if prev is not None:
            gap = e.start - prev.end
            if gap < -0.001:
                hit("overlap", e)
            elif gap < r["min_gap"] - 0.001 and gap < 0.5:
                hit("gap_under_2_frames", e)
        if lang == "en":
            if len(e.lines) == 2 and not any(x.startswith("-") for x in e.lines) and chars <= r["max_chars"]:
                hit("needless_break", e)
            if len(e.lines) >= 2 and not e.lines[0].startswith("-"):
                last = re.sub(r"[^\w']", "", e.lines[0].split()[-1]) if e.lines[0].split() else ""
                if last in WEAK_END or last.lower() in (WEAK_END - {"I"}):
                    hit("weak_break", e)
            first = re.sub(r"^[-\s\"'(\[♪]+", "", e.text)
            if prev is not None and first[:1].islower() and re.search(r"[.?!][\"')\]]*$", prev.text.strip()):
                hit("lower_case_sentence_start", e)
            if re.search(r"(^|[\s\"'-])i([\s'?!.,]|$)", e.text):
                hit("lower_case_i", e)
            if re.search(r"\s[,.?!;:](\s|$)", e.text):
                hit("space_before_punctuation", e)
            if "  " in e.text:
                hit("double_space", e)
            dashes = sum(x.startswith("-") for x in e.lines)
            if dashes == 1 and len(e.lines) == 2 and not e.lines[0].startswith("-"):
                hit("lone_dialogue_dash", e)
        prev = e
    n = max(1, len(events))
    speech = [e for e in events if not is_cue_only(e)]
    cps = sorted((sum(width(x) for x in e.lines) / max(0.01, e.end - e.start)) for e in speech) or [0.0]
    return {"events": len(events), "per_100_events": {k: round(100 * v / n, 1) for k, v in counts.items()},
            "median_cps": round(cps[len(cps) // 2], 1), "examples": {k: v for k, v in examples.items() if v}}


# ------------------------------------------------------------------------------------------------ words

_NORM = None


def tokens(text: str, lang: str) -> list[str]:
    global _NORM
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\[[^\]]*\]|\([^)]*\)|♪", " ", text)  # (sound descriptions are not speech)
    if lang == "ja":
        return [ch for ch in text.lower() if unicodedata.category(ch)[0] in "LN"]
    if _NORM is None:
        try:
            from transformers.models.whisper.english_normalizer import EnglishTextNormalizer
            _NORM = EnglishTextNormalizer({})
        except Exception:  # noqa: BLE001 (no transformers here: a plainer normaliser)
            _NORM = False
    if _NORM:
        return _NORM(text).split()
    return re.findall(r"[a-z0-9]+", re.sub(r"[’']", "", text.lower()))


def edits(a: list[str], b: list[str]) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]


def overlapping(events: list[Event], start: float, end: float) -> list[Event]:
    return [e for e in events if e.end > start and e.start < end]


def timed_tokens(events: list[Event], lang: str) -> list[tuple[str, float]]:
    """Every token with a time: spread evenly over its event (good enough to fit a whole file's offset and drift)."""
    out = []
    for e in events:
        ts = tokens(e.text, lang)
        for k, t in enumerate(ts):
            out.append((t, e.start + (e.end - e.start) * k / max(1, len(ts))))
    return out


def fit_timing(ref: list[Event], hyp: list[Event], lang: str = "en") -> dict:
    """
    How the reference's clock maps onto the sound's: t_sound = a * t_ref + b, from runs of 3+ tokens both files share, in order (no time
    window, so any offset or frame-rate drift is found). A reference made for another cut or a 25 fps transfer shows here first.
    """
    rt, ht = timed_tokens(ref, lang), timed_tokens(hyp, lang)
    sm = difflib.SequenceMatcher(None, [t for t, _ in rt], [t for t, _ in ht], autojunk=False)
    pairs = [(rt[b.a + k][1], ht[b.b + k][1]) for b in sm.get_matching_blocks() if b.size >= 3 for k in range(b.size)]
    if len(pairs) < 20:
        return {"a": 1.0, "b": 0.0, "pairs": len(pairs), "note": "too few shared runs to fit"}
    import numpy as np  # (only here: the rest of this file needs nothing outside the standard library)

    x, y = np.array([p[0] for p in pairs]), np.array([p[1] for p in pairs])
    keep = np.ones(len(x), bool)
    for _ in range(4):  # (refit without the pairs more than 1.5 s off: repeated phrases matched in the wrong place)
        a, b = np.polyfit(x[keep], y[keep], 1)
        res = np.abs(y - (a * x + b))
        keep = res < max(1.5, float(np.percentile(res, 80)))
    a, b = np.polyfit(x[keep], y[keep], 1)
    return {"a": round(float(a), 5), "b": round(float(b), 3), "pairs": int(keep.sum()), "of": len(pairs),
            "median_residual_s": round(float(np.median(np.abs(y[keep] - (a * x[keep] + b)))), 3)}


def retimed(events: list[Event], a: float, b: float) -> list[Event]:
    return [Event(a * e.start + b, a * e.end + b, e.lines) for e in events]


def compare(ref: list[Event], hyp: list[Event], lang: str = "en", fit: bool = True) -> dict:
    clock = fit_timing(ref, hyp, lang) if fit else {"a": 1.0, "b": 0.0}
    if abs(clock["a"] - 1) > 0.0005 or abs(clock["b"]) > 0.15:
        ref = retimed(ref, clock["a"], clock["b"])
        clock["applied"] = True
    ref_s = [e for e in ref if not is_cue_only(e)]
    rt = [t for e in ref_s for t in tokens(e.text, lang)]
    ht = [t for e in hyp for t in tokens(e.text, lang)]
    # (Whole-file edit distance is quadratic: done in 10-minute stretches, which is exact enough for a rate.)
    errs, n = 0, 0
    span = 600.0
    t = 0.0
    last = max([e.end for e in ref_s + hyp] or [0.0])
    while t < last:
        a = [x for e in ref_s if t <= e.start < t + span for x in tokens(e.text, lang)]
        b = [x for e in hyp if t <= e.start < t + span for x in tokens(e.text, lang)]
        errs += edits(a, b)
        n += len(a)
        t += span
    heard, offsets = 0, []
    for e in ref_s:
        want = tokens(e.text, lang)
        near = overlapping(hyp, e.start - 0.5, e.end + 0.5)
        got = [x for h in near for x in tokens(h.text, lang)]
        if want and sum(1 for x in set(want) if x in got) >= 0.5 * len(set(want)):
            heard += 1
            # (Start offset: the generated event that holds this line's first word, if it starts within 2 s.)
            first = want[0]
            cand = [h for h in near if first in tokens(h.text, lang) and abs(h.start - e.start) <= 2.0]
            if cand:
                offsets.append(round(min(cand, key=lambda h: abs(h.start - e.start)).start - e.start, 2))
    lonely = []
    for h in hyp:
        if is_cue_only(h):
            continue
        near = overlapping(ref_s, h.start - 2.0, h.end + 2.0)
        mine = set(tokens(h.text, lang))
        theirs = {x for e in near for x in tokens(e.text, lang)}
        if not near or (len(mine) >= 3 and len(mine & theirs) <= 0.2 * len(mine)):
            lonely.append(f"{h.start:.2f}: " + " / ".join(h.lines))
    off = sorted(abs(x) for x in offsets)
    return {"reference_clock": clock, "error_rate": round(errs / max(1, n), 4), "ref_words": n, "hyp_words": len(ht), "ref_lines": len(ref_s), "lines_heard": heard,
            "starts_compared": len(offsets), "start_median_abs_s": off[len(off) // 2] if off else None,
            "starts_within_0_3": sum(x <= 0.3 for x in off), "starts_within_0_5": sum(x <= 0.5 for x in off),
            "mean_offset_s": round(sum(offsets) / len(offsets), 3) if offsets else None,
            "lonely_hyp_events": len(lonely), "lonely_examples": lonely[:40]}


# ------------------------------------------------------------------------------------------------ blind sheet

def stamp(t: float) -> str:
    return f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


def sheet(out_dir: str, ref_path: str, variants: dict[str, str], n: int = 40, seed: int = 1, lang: str = "en") -> None:
    ref = [e for e in read_srt(ref_path) if not is_cue_only(e)]
    hyps = {name: read_srt(path) for name, path in variants.items()}
    clock = fit_timing(ref, next(iter(hyps.values())), lang)
    if abs(clock["a"] - 1) > 0.0005 or abs(clock["b"]) > 0.15:
        ref = retimed(ref, clock["a"], clock["b"])
    print(f"reference clock: {clock}")
    rng = random.Random(seed)
    picks = sorted(rng.sample(range(len(ref)), min(n, len(ref))))
    letters = "ABCDEFGH"[: len(hyps)]
    key, rows = {}, [f"# Blind sheet: {os.path.basename(ref_path)}, {len(picks)} lines, seed {seed}", "",
                     "Codes: ok | M meaning | N name | X missing | I invented | G grammar | C capitals/punctuation (comma-separated).", ""]
    for k, i in enumerate(picks, 1):
        e = ref[i]
        names = list(hyps)
        rng.shuffle(names)
        key[str(k)] = dict(zip(letters, names))
        rows.append(f"## {k} ({stamp(e.start)})")
        if i > 0:
            rows.append(f"before: {ref[i - 1].text}")
        rows.append(f"**REF: {' / '.join(e.lines)}**")
        if i + 1 < len(ref):
            rows.append(f"after: {ref[i + 1].text}")
        for letter, name in zip(letters, names):
            shown = overlapping(hyps[name], e.start - 0.2, e.end + 0.2)
            rows.append(f"{letter}: " + ("  ||  ".join(" / ".join(h.lines) for h in shown) if shown else "(nothing on screen)"))
        for letter in letters:
            rows.append(f"judge {letter}: ")
        rows.append("")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "sheet.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(rows))
    with open(os.path.join(out_dir, "key.json"), "w", encoding="utf-8") as f:
        json.dump({"ref": ref_path, "variants": variants, "seed": seed, "items": key}, f, indent=1)
    print(f"{len(picks)} lines -> {os.path.join(out_dir, 'sheet.md')}")


def tally(out_dir: str) -> dict:
    with open(os.path.join(out_dir, "key.json"), encoding="utf-8") as f:
        key = json.load(f)
    with open(os.path.join(out_dir, "sheet.md"), encoding="utf-8") as f:
        text = f.read()
    codes = ("M", "N", "X", "I", "G", "C")
    res: dict[str, dict] = {}
    item = None
    unjudged = 0
    for line in text.splitlines():
        m = re.match(r"## (\d+) ", line)
        if m:
            item = m.group(1)
            continue
        m = re.match(r"judge ([A-H]):\s*(.*)", line)
        if m and item:
            name = key["items"][item][m.group(1)]
            r = res.setdefault(name, {"lines": 0, "ok": 0, **{c: 0 for c in codes}})
            got = [x.strip().upper() for x in m.group(2).split(",") if x.strip()]
            if not got:
                unjudged += 1
                continue
            r["lines"] += 1
            if got == ["OK"]:
                r["ok"] += 1
            for c in got:
                if c in r:
                    r[c] += 1
    for r in res.values():
        r["per_100"] = {c: round(100 * r[c] / max(1, r["lines"]), 1) for c in codes}
        r["lines_with_any_error_per_100"] = round(100 * (r["lines"] - r["ok"]) / max(1, r["lines"]), 1)
    if unjudged:
        res["_unjudged"] = unjudged
    return res


def main(argv: list[str]) -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    opts = {}
    args = []
    i = 0
    while i < len(argv):
        if argv[i].startswith("--"):
            opts[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            args.append(argv[i])
            i += 1
    lang = opts.get("lang", "en")
    if not args:
        print(__doc__)
        return
    cmd = args[0]
    if cmd == "format":
        print(json.dumps(format_report(read_srt(args[1]), lang), ensure_ascii=False, indent=1))
    elif cmd == "compare":
        print(json.dumps(compare(read_srt(args[1]), read_srt(args[2]), lang), ensure_ascii=False, indent=1))
    elif cmd == "sheet":
        variants = dict(a.split("=", 1) for a in args[3:])
        sheet(args[1], args[2], variants, int(opts.get("n", 40)), int(opts.get("seed", 1)), lang)
    elif cmd == "summary":  # summary REF HYP [HYP ...]: one line per file
        ref = read_srt(args[1])
        for path in args[2:]:
            hyp = read_srt(path)
            c, f = compare(ref, hyp, lang), format_report(hyp, lang)
            bad = {k: v for k, v in f["per_100_events"].items() if v}
            print(f"{os.path.basename(path)}: err {c['error_rate']} | heard {c['lines_heard']}/{c['ref_lines']} | starts <=0.3 s "
                  f"{c['starts_within_0_3']}/{c['starts_compared']} (median {c['start_median_abs_s']}, mean {c['mean_offset_s']}) | "
                  f"lonely {c['lonely_hyp_events']} | events {f['events']}, cps {f['median_cps']} | per 100: {bad} | clock {c['reference_clock'].get('a')}, {c['reference_clock'].get('b')}")
    elif cmd == "tally":
        print(json.dumps(tally(args[1]), ensure_ascii=False, indent=1))
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
