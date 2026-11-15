"""
The editing step: a language model reads what the main listener heard (with the second listener's reading of the same moments, the
title and its names) and writes each segment as a subtitler would. Then `finish.guarded` undoes every content change it cannot justify,
`finish.carry` puts the text back on the main listener's word times, and `finish.events` makes the subtitle events.

  python editor.py MAIN_WORDS.json OTHER_WORDS.json[,MORE.json] OUT.srt [--lang en] [--title "..."] [--names "A, B"] [--model ID] [--raw]

MAIN_WORDS / OTHER_WORDS: [[text, start, end], ...] or generate.py's {"raw": ..., "fixed": ..., "final": ...} (then "fixed" is used:
the second listener's additions raised the error rate on every noisy sound). --raw: no model, only tidy + events (the baseline).
Writes OUT.srt, OUT.edits.json (each segment before, as the model wrote it, and after the guard) and prints the guard's counts.
The model runs on a GPU (Colab T4: fp16; a model over ~9B parameters is loaded in 4 bits).
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import finish  # noqa: E402
from finish import Word  # noqa: E402

MODEL = os.environ.get("EDITOR_MODEL", "Qwen/Qwen3-8B")
PER_PROMPT = int(os.environ.get("EDITOR_SEGMENTS", "16"))

SYSTEM_EN = """You are a professional subtitle editor working from automatic speech recognition of a film.
For each numbered segment you get A (the main recogniser) and other recognisers (B, C...) that heard the same moment; any of them may be wrong.
Write the segment as a professional English subtitler would:
- where the recognisers disagree, choose the reading that makes sense in context; do not write words that none of them heard, except a name from the names list;
- correct capitals, punctuation and sentence boundaries (a question gets a question mark; names capitalised; numbers zero to ten in words; "okay");
- drop fillers (um, uh, er) and stutters; keep everything else the speaker said, in their own words and their own grammar;
- never add, summarise, explain or translate; never move words between segments;
- if a segment is only noise, song lyrics, or a phrase like "Thank you for watching" that no one in the film would say, return "";
- "A: (heard nothing)" means the main recogniser heard no words there: write what the others heard only if it fits the scene, else "".
Answer with JSON only, one key per segment number: {"1": "...", "2": "..."}"""


def load_words(path: str) -> list[Word]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        data = data.get("fixed") or data.get("final") or data.get("raw") or []
    return [Word(t, float(s), float(e)) for t, s, e in data]


def segments(words: list[Word], lang: str, gap: float = 0.6, longest: float = 12.0) -> list[list[Word]]:
    out: list[list[Word]] = []
    for w in sorted(words, key=lambda x: x.start):
        if out and w.start - out[-1][-1].end <= gap and w.end - out[-1][0].start <= longest and not finish.END.search(out[-1][-1].text):
            out[-1].append(w)
        else:
            out.append([w])
    return out


def text_of(ws: list[Word], lang: str) -> str:
    return ("" if lang == "ja" else " ").join(w.text for w in ws).strip()


def other_for(seg: list[Word], other: list[Word]) -> list[Word]:
    s, e = seg[0].start - 0.3, seg[-1].end + 0.3
    return [w for w in other if w.start >= s and w.start < e]


HALLUCINATION = re.compile(r"^(thank you( (so much|very much))?( for watching)?|thanks for watching|subtitles by.*|you|bye|\W*)$", re.I)
FILL_MIN = int(os.environ.get("EDITOR_FILL_MIN", "2"))


def fills(main: list[Word], others: list[list[Word]], lang: str, pad: float = 0.5) -> list[tuple[list[Word], int]]:
    """
    The moments the main listener heard nothing but another one heard words (shouts under gunfire, a line under music): each as
    (the words of the engine that heard the most there, how many engines heard something there). The main listener's segments never
    offer these, so without this step a line only the others heard is lost.
    """
    def free(w: Word) -> bool:
        return not any(m.end > w.start - pad and m.start < w.end + pad for m in main)

    runs: list[tuple[float, float, int, list[Word]]] = []
    for n, o in enumerate(others):
        for seg in segments([w for w in o if free(w) and finish.key(w.text)], lang):
            runs.append((seg[0].start, seg[-1].end, n, seg))
    runs.sort(key=lambda r: r[0])
    groups: list[list[tuple[float, float, int, list[Word]]]] = []
    for r in runs:
        if groups and r[0] <= max(x[1] for x in groups[-1]) + 0.3:
            groups[-1].append(r)
        else:
            groups.append([r])
    out = []
    for g in groups:
        engines = {r[2] for r in g}
        # (The base timeline: the engine that heard the most words there.)
        by_engine: dict[int, list[Word]] = {}
        for r in g:
            by_engine.setdefault(r[2], []).extend(r[3])
        base = max(by_engine.values(), key=len)
        out.append((sorted(base, key=lambda w: w.start), len(engines)))
    return out


class LLM:
    def __init__(self, model_id: str):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.id = model_id
        self.tok = AutoTokenizer.from_pretrained(model_id)
        kw = {"dtype": torch.float16, "device_map": "cuda:0"}
        big = re.search(r"(\d+(?:\.\d+)?)B", model_id)
        if big and float(big.group(1)) >= 7 and not re.search(r"AWQ|GPTQ|4bit|bnb", model_id, re.I):  # (an 8B model in fp16 is 16 GB: over a T4)
            from transformers import BitsAndBytesConfig

            kw["quantization_config"] = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.float16, bnb_4bit_quant_type="nf4")
        self.model = AutoModelForCausalLM.from_pretrained(model_id, **kw).eval()

    def ask(self, system: str, user: str, max_new: int = 1500) -> str:
        import torch

        msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        try:
            prompt = self.tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        except TypeError:
            prompt = self.tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        ids = self.tok(prompt, return_tensors="pt").to(self.model.device)
        with torch.no_grad():
            out = self.model.generate(**ids, max_new_tokens=max_new, do_sample=False, temperature=None, top_p=None, top_k=None)
        return self.tok.decode(out[0, ids["input_ids"].shape[1]:], skip_special_tokens=True)


def parse_answer(text: str, n: int) -> dict[int, str]:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        try:
            got = json.loads(m.group(0))
            return {int(k): str(v) for k, v in got.items() if str(k).isdigit() and 1 <= int(k) <= n}
        except json.JSONDecodeError:
            pass
    out = {}
    for line in text.splitlines():
        m = re.match(r'\s*"?(\d+)"?\s*[:.]\s*"?(.*?)"?,?\s*$', line)
        if m and 1 <= int(m.group(1)) <= n:
            out[int(m.group(1))] = m.group(2)
    return out


def edit(main: list[Word], others: list[list[Word]], lang: str, title: str, names: list[str], llm: LLM | None, normalise=None) -> tuple[list[Word], list[dict]]:
    other = sorted((w for o in others for w in o), key=lambda w: w.start)  # (the guard accepts a word any other engine heard there)
    main = finish.tidy(main)
    # Each segment: (words, how many other engines heard something there; None = a segment of the main listener's).
    segs: list[tuple[list[Word], int | None]] = [(s, None) for s in segments(main, lang)]
    if FILL_MIN > 0:
        segs += [(finish.tidy(ws), n) for ws, n in fills(main, others, lang) if n >= FILL_MIN or llm is not None]
    segs.sort(key=lambda x: x[0][0].start)
    log: list[dict] = []
    done: list[str] = []
    out: list[Word] = []
    for i in range(0, len(segs), PER_PROMPT):
        batch = segs[i: i + PER_PROMPT]
        answers: dict[int, str] = {}
        if llm is not None:
            lines = [f"Film: {title}" if title else "", f"Names: {', '.join(names)}" if names else "",
                     "Context (already subtitled, do not repeat): " + " ".join(done[-6:]) if done else "", "Segments:"]
            for k, (seg, fill) in enumerate(batch, 1):
                a = "(heard nothing)" if fill is not None else text_of(seg, lang)
                lines.append(f"{k}. A: {a}" + "".join(f" | {'BCDEFG'[n]}: {text_of(other_for(seg, o), lang)}" for n, o in enumerate(others)))
            answers = parse_answer(llm.ask(SYSTEM_EN, "\n".join(x for x in lines if x)), len(batch))
        for k, (seg, fill) in enumerate(batch, 1):
            before = text_of(seg, lang)
            wrote = answers.get(k) if llm is not None else (before if fill is not None else None)
            if fill is not None and (fill < FILL_MIN or HALLUCINATION.match(before.strip(" .!?,"))):
                # (A moment only one other engine heard, or only a stock phrase: left out, whatever the model wrote.)
                after, stats = "", {"fill": fill, "fill refused": True}
            elif wrote is None:
                after, stats = before, {"model": "no answer"}
            elif not wrote.strip():
                # (An empty answer drops a main segment only when no other engine heard anything there either.)
                if fill is not None or not other_for(seg, other):
                    after, stats = "", {"dropped": True}
                else:
                    after, stats = before, {"drop refused": True}
            else:
                after, stats = finish.guarded(seg, wrote.strip(), other, set(names), normalise)
            if fill is not None:
                stats["fill"] = fill
            log.append({"start": round(seg[0].start, 2), "before": before, "model": wrote, "after": after, **stats})
            if after:
                out += finish.carry(seg, after)
                done.append(after)
    return out, log


def main(argv: list[str]) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    opts, args, i = {}, [], 0
    while i < len(argv):
        if argv[i] == "--raw":
            opts["raw"] = "1"
            i += 1
        elif argv[i].startswith("--"):
            opts[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            args.append(argv[i])
            i += 1
    main_path, other_path, out_path = args
    lang = opts.get("lang", "en")
    names = [x.strip() for x in opts.get("names", "").split(",") if x.strip()]
    main_w = load_words(main_path)
    other_w = [load_words(p) for p in other_path.split(",") if os.path.exists(p)]
    normalise = None
    if lang == "en":
        try:
            from transformers.models.whisper.english_normalizer import EnglishTextNormalizer

            normalise = EnglishTextNormalizer({})
        except Exception:  # noqa: BLE001
            pass
    t = time.time()
    llm = None if "raw" in opts else LLM(opts.get("model", MODEL))
    loaded = time.time() - t
    words, log = edit(main_w, other_w, lang, opts.get("title", ""), names, llm, normalise)
    evs = finish.events(words, lang)
    finish.write_srt(evs, out_path)
    with open(out_path + ".edits.json", "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, indent=1)
    tot = {"kept": {}, "undone": {}}
    for r in log:
        for side in ("kept", "undone"):
            for k, v in r.get(side, {}).items():
                tot[side][k] = tot[side].get(k, 0) + v
    print(f"{out_path}: {len(evs)} events from {len(words)} words; model {None if llm is None else llm.id} loaded in {loaded:.0f} s, "
          f"edited in {time.time() - t - loaded:.0f} s; guard {tot}; dropped {sum(1 for r in log if r.get('dropped'))}, "
          f"no answer {sum(1 for r in log if r.get('model') is None and llm is not None)}")


if __name__ == "__main__":
    main(sys.argv[1:])
