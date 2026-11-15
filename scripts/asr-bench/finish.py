"""
From timed words to finished subtitles (CPU only):

- `tidy(words)`: fillers out (um, uh, er, erm), a stutter's repeated word out ("I I think" -> "I think").
- `carry(old, text)`: a corrected text put back on the old words' times, word by word: an unchanged word keeps its time, a replaced
  run shares the time of the words it replaced, an added word sits against its neighbour. Corrected text is never aligned to the sound
  again: an aligner can only time words that were said.
- `guarded(old, text, other, names)`: a corrector's text with every content change it cannot justify undone. A changed or added word is
  kept when the other listener heard it at that moment, when it is in the title's names, when it is the same word written otherwise
  (numbers, spellings, contractions), or when it sounds like the word it replaces; a removed word when it is a filler, a repeat, or the
  other listener did not hear it either. Capitals and punctuation may always change.
- `events(words, lang)`: subtitle events by the Netflix rules: a dynamic programme over where events end (sentence ends best, then
  clause punctuation, then pauses; never over two lines of 42 characters or 7 s), the best line break inside each (after punctuation,
  never after an article, preposition, conjunction or possessive, bottom-heavy), and times (the first word's start; the end leaves time
  to read at 20 characters a second, at least 5/6 s, at most 7 s, closes gaps under half a second to 2 frames, never runs into the next).
"""
from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass

FRAME = 1 / 24
MAX_CHARS, MAX_CPS, MIN_DUR, MAX_DUR, MIN_GAP, CLOSE_GAP = 42, 20.0, 5 / 6, 7.0, 2 * FRAME, 0.5
JA = {"max_chars": 13, "max_cps": 4.0}
FILLERS = {"um", "uh", "er", "erm", "uhm", "umm", "hmm-mm"}
WEAK_END = set("""a an the of to in on at for with from by about into onto over under after before through between without
and or but nor because if than my your his her its our their""".split()) | {"I"}
END = re.compile(r"[.?!…。？！]['\"”’)\]]*$")
CLAUSE = re.compile(r"[,;:—–、]['\"”’)\]]*$")


@dataclass
class Word:
    text: str
    start: float
    end: float


@dataclass
class Event:
    start: float
    end: float
    lines: list[str]


def key(text: str) -> str:
    """A word as compared: lower case, letters, digits and apostrophes only."""
    t = unicodedata.normalize("NFKC", text).lower().replace("’", "'")
    return re.sub(r"[^\w']", "", t).strip("'")


# ------------------------------------------------------------------------------------------------ tidy

def tidy(words: list[Word]) -> list[Word]:
    out: list[Word] = []
    for w in words:
        k = key(w.text)
        if k in FILLERS:
            # (Punctuation the filler carried goes to the word before it: "So, um, yes" -> "So, yes".)
            if out and re.search(r"[.?!]$", w.text) and not END.search(out[-1].text):
                out[-1] = Word(re.sub(r"[,;:]$", "", out[-1].text) + w.text[-1], out[-1].start, out[-1].end)
            continue
        if out and k and key(out[-1].text) == k and w.start - out[-1].end < 0.6 and not END.search(out[-1].text) and k not in {"no", "yes", "very", "so", "bye", "go", "come", "now", "really", "okay", "ok", "hey", "oh"}:
            # (A repeat straight after itself is a stutter; "no, no" and "very very" are said on purpose and stay.)
            out[-1] = Word(w.text if out[-1].text[:1].islower() or not w.text[:1].islower() else w.text[:1].upper() + w.text[1:], out[-1].start, w.end)
            continue
        out.append(w)
    return out


# ------------------------------------------------------------------------------------------------ carry and guard

def _ops(old: list[Word], new: list[str]):
    a, b = [key(w.text) for w in old], [key(t) for t in new]
    return difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()


def carry(old: list[Word], text: str) -> list[Word]:
    new = text.split()
    out: list[Word] = []
    for op, i1, i2, j1, j2 in _ops(old, new):
        if op == "equal":
            out += [Word(new[j1 + k], old[i1 + k].start, old[i1 + k].end) for k in range(i2 - i1)]
        elif op == "replace":
            s, e = old[i1].start, old[i2 - 1].end
            sizes = [max(1, len(new[j])) for j in range(j1, j2)]
            total, at = sum(sizes), s
            for j, n in zip(range(j1, j2), sizes):
                d = (e - s) * n / total
                out.append(Word(new[j], at, at + d))
                at += d
        elif op == "insert":
            t = out[-1].end if out else (old[i1].start if i1 < len(old) else 0.0)
            out += [Word(new[j], t, t) for j in range(j1, j2)]
    return out


def sounds(a: str) -> str:
    """A rough sound key: first letter, then consonant classes without repeats (enough to tell "their"/"there" from "chair")."""
    a = key(a)
    if not a:
        return ""
    groups = {"bfpv": "1", "cgjkqsxz": "2", "dt": "3", "l": "4", "mn": "5", "r": "6"}
    out, last = a[0], ""
    for ch in a[1:]:
        code = next((v for k, v in groups.items() if ch in k), "")
        if code and code != last:
            out += code
        last = code
    return out


def same_word(a: str, b: str, normalise=None) -> bool:
    if key(a) == key(b):
        return True
    if normalise is not None:
        try:
            return normalise(a) == normalise(b)
        except Exception:  # noqa: BLE001
            return False
    return False


def guarded(old: list[Word], text: str, other: list[Word], names: set[str] | None = None, normalise=None,
            soundalike: bool = False) -> tuple[str, dict]:
    """
    The corrected text with the changes it cannot justify undone, and a count of what was kept and undone. A new word must have been
    heard by another engine at that moment, or be one of the title's names, or the same word written otherwise. (`soundalike` also
    lets through a word that sounds like the one it replaces; off by default: published correctors that wrote words no engine heard
    made error rates worse, not better.)
    """
    names = {key(n) for n in (names or set()) for n in n.split()}
    new = text.split()
    kept, undone, out = {"changed": 0, "added": 0, "removed": 0}, {"changed": 0, "added": 0, "removed": 0}, []

    def heard_by_other(ks: list[str], s: float, e: float) -> bool:
        near = {key(w.text) for w in other if w.end > s - 1.0 and w.start < e + 1.0}
        return all(k in near or k in names for k in ks if k)

    for op, i1, i2, j1, j2 in _ops(old, new):
        if op == "equal":
            out += new[j1:j2]
            continue
        s = old[i1].start if i1 < len(old) else (old[-1].end if old else 0.0)
        e = old[i2 - 1].end if i2 > i1 else s
        before, after = [old[i].text for i in range(i1, i2)], new[j1:j2]
        bk, ak = [key(x) for x in before], [key(x) for x in after]
        if op == "delete":
            ok = all(k in FILLERS or not k for k in bk) or not heard_by_other(bk, s, e) or (i1 > 0 and all(k == key(old[i1 - 1].text) for k in bk))
            (kept if ok else undone)["removed"] += 1
            out += [] if ok else before
            continue
        what = "added" if op == "insert" else "changed"
        ok = (heard_by_other(ak, s, e)
              or same_word(" ".join(before), " ".join(after), normalise)
              or (soundalike and op == "replace" and sounds("".join(bk)) == sounds("".join(ak)) and len("".join(ak)) <= 2 * len("".join(bk)) + 2))
        (kept if ok else undone)[what] += 1
        out += after if ok else before
    return " ".join(out), {"kept": kept, "undone": undone}


# ------------------------------------------------------------------------------------------------ events

def _join(ws: list[Word], lang: str) -> str:
    return ("" if lang == "ja" else " ").join(w.text for w in ws).strip()


def best_break(ws: list[Word], lang: str = "en") -> tuple[float, int | None]:
    """The cost of showing these words as one event, and where its line break goes (None: one line). Infinite if they do not fit."""
    limit = JA["max_chars"] if lang == "ja" else MAX_CHARS
    sep = "" if lang == "ja" else " "
    text = _join(ws, lang)
    if len(text) <= limit:
        return 0.0, None
    best, at = float("inf"), None
    for k in range(1, len(ws)):
        l1, l2 = _join(ws[:k], lang), _join(ws[k:], lang)
        if len(l1) > limit or len(l2) > limit:
            continue
        last = ws[k - 1].text
        c = 0.0
        if END.search(last):
            c -= 3.0
        elif CLAUSE.search(last):
            c -= 2.0
        elif re.sub(r"[^\w']", "", last) in WEAK_END or re.sub(r"[^\w']", "", last).lower() in (WEAK_END - {"I"}):
            c += 6.0
        c += abs(len(l1) - len(l2)) / 10.0 + (1.0 if len(l1) > len(l2) + 4 else 0.0)  # (balanced, a little bottom-heavy)
        c += max(0.0, ws[k].start - ws[k - 1].end) * -1.0  # (a pause is a good place)
        if c < best:
            best, at = c, k
    del sep
    return best, at


def events(words: list[Word], lang: str = "en", max_words: int = 40) -> list[Event]:
    ws = [w for w in sorted(words, key=lambda w: w.start) if w.text.strip()]
    n = len(ws)
    if not n:
        return []
    cps = JA["max_cps"] if lang == "ja" else MAX_CPS
    best = [0.0] + [float("inf")] * n
    back = [0] * (n + 1)
    brk: dict[tuple[int, int], int | None] = {}
    for i in range(1, n + 1):
        for j in range(max(0, i - max_words), i):
            seg = ws[j:i]
            if seg[-1].end - seg[0].start > MAX_DUR and i - j > 1:
                continue
            c, at = best_break(seg, lang)
            if c == float("inf"):
                continue
            last = seg[-1].text
            gap_after = (ws[i].start - seg[-1].end) if i < n else 9.0
            # Where the event ends: a sentence end is best, then a clause mark, then a pause; mid-phrase with no pause costs most.
            bare = re.sub(r"[^\w']", "", last)
            if END.search(last):
                c += 0.0
            elif CLAUSE.search(last):
                c += 4.0
            elif gap_after >= 0.5:
                c += 5.0
            else:
                c += 12.0 - min(gap_after, 0.5) * 8.0
            if not END.search(last) and not CLAUSE.search(last) and (bare in WEAK_END or bare.lower() in (WEAK_END - {"I"}) or bare.lower() in {"these", "those", "this", "that", "some", "any", "every", "no", "very", "so", "too"}):
                c += 8.0  # (an event that ends on "the", "to", "these" leaves the reader hanging)
            # A pause inside an event (someone stopping, or a new speaker) is worth avoiding.
            inner = max((seg[k].start - seg[k - 1].end for k in range(1, len(seg))), default=0.0)
            if inner > 1.0:
                c += 6.0 + 2.0 * inner
            # Reading speed: the time it can stay up is until the next event (or 7 s).
            chars = len(_join(seg, lang))
            room = min(MAX_DUR, (ws[i].start - MIN_GAP if i < n else seg[-1].end + 2.0) - seg[0].start)
            if room > 0 and chars / room > cps:
                c += 3.0 * (chars / room - cps)
            if room < MIN_DUR:
                c += 6.0  # (it could not stay up 5/6 s: better joined to the next)
            # Very short events flicker; many events cost a little each.
            c += 2.0 + (2.0 if chars < 12 and gap_after < 0.5 else 0.0)
            if best[j] + c < best[i]:
                best[i], back[i] = best[j] + c, j
                brk[(j, i)] = at
    cuts, i = [], n
    while i > 0:
        cuts.append((back[i], i))
        i = back[i]
    cuts.reverse()
    out: list[Event] = []
    for j, i in cuts:
        seg = ws[j:i]
        at = brk.get((j, i))
        lines = [_join(seg, lang)] if at is None else [_join(seg[:at], lang), _join(seg[at:], lang)]
        out.append(Event(seg[0].start, seg[-1].end, lines))
    # Times: long enough to read, at least 5/6 s, at most 7 s; small gaps closed to 2 frames; never into the next event.
    for k, e in enumerate(out):
        chars = sum(len(x) for x in e.lines)
        want = e.start + max(MIN_DUR, chars / cps, e.end - e.start + 0.2)
        nxt = out[k + 1].start if k + 1 < len(out) else float("inf")
        end = min(want, e.start + MAX_DUR, nxt - MIN_GAP)
        if nxt - end < CLOSE_GAP:
            end = nxt - MIN_GAP
        e.end = max(end, e.start + 0.3)
    return out


def write_srt(evs: list[Event], path: str) -> None:
    def t(x: float) -> str:
        ms = int(round(x * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"
    with open(path, "w", encoding="utf-8") as f:
        for n, e in enumerate(evs, 1):
            f.write(f"{n}\n{t(e.start)} --> {t(e.end)}\n" + "\n".join(e.lines) + "\n\n")
