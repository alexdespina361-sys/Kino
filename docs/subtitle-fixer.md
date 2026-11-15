# Subtitle fixer

Phase 1 of the owner's subtitle brief of 15 Nov 2026 (repair existing subtitles; generation on request comes later). It is one pipeline, not a
second system: the **tidying** is the Kino Official rules (`src/server/subtitles/clean.ts`), the **timing** is the screens' own aligner
(`src/client/subsync`, the vendored kit unchanged), and the **kept, improved file with the original next to it** is what Kino Official already
does for the website ([official-subtitles.md](official-subtitles.md)). The fixer adds a command line for files on this computer, Subtitle Edit's
fixes, and a door for a language model.

## Commands

```
node scripts/subfix.mjs film.srt --lang en                         tidy only (no other program needed)
node scripts/subfix.mjs film.srt --lang ro --seconv                + Subtitle Edit's fixes (SECONV=<path> or seconv on the PATH)
node scripts/subfix.mjs film.srt --lang en --audio film.mkv        + timed to the film's sound with the aligner (ffmpeg reads it)
node scripts/subfix.mjs film.ass --lang en --polish-command "node my-model.mjs" --strength natural
```

- **Reads:** SRT, VTT and ASS (dialogue only, italics kept). Bytes that are not UTF-8 are read as windows-1250 (Romanian) or windows-1252.
- **Writes, next to the file or in `--out`:**
  - `film.original.srt`, once;
  - `film.kino-v1.srt` (or `.vtt` with `--format vtt`);
  - `film.kino-v1.report.json`.
- **Never writes over** anything. Each run is a new version. A file already done the same way (same text and same options, by sha256) is
  not done again unless `--again` is given.
- **The report** holds:
  - every changed line: before and after, which step changed it (`tidy`, `subtitle-edit`, `aligner`, `polish`, `valid`) and which line of
    the file it came from;
  - every line left out, with its text;
  - the timing: lines placed, the shift learned, the median and largest move;
  - every line a model offered that was turned away, and why;
  - the steps that could not run, and why.

## Steps (`src/server/subtitles/fixer/`)

| Step | File | What it does |
|---|---|---|
| Read | `formats.ts` | SRT/VTT the way the screens read them (`parseVtt`, in the browser's cue order), ASS dialogue |
| Tidy | `../clean.ts` | Credits and advertising out (near the start and end only, or a line that is a subtitle site's name or a bare link), Romanian ș/ț and old code pages, "l" read as "I", dashes, spaces, a song's notes. Conservative: a line is left out only when it is certainly not dialogue |
| Subtitle Edit | `seconv.ts` | Its "Fix common errors" rules, chosen one by one (`SECONV_RULES`): spaces, commas, a lone "i", italics, long and short line breaks, two speakers on one line. Its timing rules (overlaps, too short, too long, short gaps) run only when the sound will not time the file. A run that adds or drops lines is not used |
| Aligner | `sync.ts` | The screens' solver (`SyncCore` + the Silero voice detector port, the same weights from `public/subtitle-sync/1/`), fed the film's sound in 10 s pieces and solved every 15 s, as a screen does. Voice only: the recogniser runs in a browser worker. Never on the server, which has no film's sound |
| Wording | `polish.ts` | Any model behind a command: JSON in (`instructions`, `lang`, `strength`, `lines`, the 3 lines `before` and `after`), `{"lines": [...]}` out, 20 lines at a time. A line is taken only if it keeps its numbers, names, negation and speaker dash, is not empty and not far longer, and (conservative) does not rewrite most of the words. Off unless asked for; nothing calls a paid service |
| Check | `fix.ts` | Every line ends after it starts; lines in the browser's order |

## What was measured (15 Nov 2026, this PC)

- **A made-up spoken clip**: 94 s, 14 lines, made with the Windows speech synthesizer, so no film was used. The SRT was 3.0 s late, with one
  ad line. `--audio --seconv` took 3.5 s. 13 of the 14 lines landed within 0.08 s of where the speech starts; one line with a pause inside
  it was 1.1 s off. The ad line was left out, and "today ?" and "i left" were mended.
- **Limit:** a synthetic voice is clean speech. On real films the voice detector alone is a second or three off now and then (see
  [subtitle-sync.md](subtitle-sync.md)), and words from a recogniser are what make it exact.
- **Tests:** `src/server/subtitles/fixer/fixer.test.ts`:
  - reading SRT/ASS/code pages;
  - the report;
  - the model checks;
  - the aligner on the synthetic film;
  - the command's versions and its "already done";
  - Subtitle Edit itself, only with `SECONV=<path>` set.

## Subtitle Edit (checked 15 Nov 2026)

- **Licence:** MIT ("Copyright (c) 2026 Nikolaj Olsson"), the same text in the `seconv` download. It is used as a separate program, and no
  code of it is in this repository.
- **`seconv` v5.4.0:** prebuilt for Windows, macOS and Linux, x64 and ARM64 (`SeConv-Linux-ARM64.tar.gz`, 38 MB; the Oracle box is ARM64).
  Options are `--kebab-case`; an unknown option is an error. `seconv list-fce-rules` lists the rule IDs. Its other options include
  `--remove-text-for-hi` (not used: those lines are for deaf viewers), `--merge-same-texts`, `--balance-lines`, and `--translate-to` with
  local or OpenAI-compatible engines.
- It does nothing with sound: no timing to a film, no speech recognition.
- **Not installed on the Oracle box.** That would be a change to the live server, so it is left for a decision. The box does not need it
  for Kino Official, whose tidying is our own.
- ffsubsync (MIT) times a file to a film's sound, or to another subtitle file. It needs the film, so it is for this computer only. The
  screens' aligner does the same job here, and it is ours.

## Generation on request (Workflow B): first measurements (15 Nov 2026, Kaggle T4)

The model cards (licences, sizes, their own numbers):

| Use | Candidates | Notes |
|---|---|---|
| English speech | Qwen3-ASR-0.6B / 1.7B (Apache-2.0); FUTO asr4all-s (28M, CPU, English only, its own "ethical use" licence) | asr4all-s: RTFx 52 single-thread on a desktop i9 (its card); no timestamps stated |
| Japanese speech | Qwen3-ASR-1.7B (Apache-2.0); Parakeet TDT-CTC 0.6B ja (CC-BY-4.0, NeMo, CER 6.4 JSUT) | The anime/galgame fine-tune of Qwen3-ASR-1.7B scores better only on its author's own set, and its licence is "other" with dataset terms: avoid |
| Timing words | Qwen3-ForcedAligner-0.6B (Apache-2.0) | Audio + transcript to word times, 11 languages incl. English and Japanese, up to 5 min a call |

**What was run:** `scripts/asr-bench/` (a notebook built from `bench.py`, imported into Kaggle as the private notebook `kino-asr-bench`).
- **Hardware and setup:** one T4 (16 GB), bf16. Batch size 1, one stream. The sound is cut every 30 s and served in order, as one viewer's request would be.
- **English clip:** *Tears of Steel* (CC BY 3.0, Blender Foundation), the whole film: 734 s, music and action. It is scored against its official English subtitles, which are not a word-for-word transcript, so the WER is an upper bound.
- **Japanese clip:** FLEURS ja_jp (CC BY 4.0), 15 sentences joined to 188 s. It is **read speech: it says nothing about anime.**

Version 1, Qwen3-ASR with the forced aligner (numbers read from the run's log):

| model | clip | load (incl. download) | first 30 s | 3 min covered | speed vs playback | WER / CER | VRAM |
|---|---|---|---|---|---|---|---|
| 0.6B | Tears of Steel (en) | 58 s | 9.9 s (cold GPU) | 18.2 s | 14.9x | 23% | 3.6 GB |
| 1.7B | Tears of Steel (en) | 32 s | 3.7 s | 15.2 s | 12.5x | 25% | 6.1 GB |
| 0.6B | FLEURS (ja) | | 4.3 s | 26.8 s | 6.8x | 14.4% | 3.6 GB |
| 1.7B | FLEURS (ja) | | 5.0 s | 30.2 s | 6.0x | 10.8% | 6.1 GB |

- **Speed:** both models run far faster than playback, even on a free T4. A viewer would wait about 4-5 s for the first 30 s of subtitles. The 9.9 s is the very first call on a fresh GPU; a server pays that once at start. Dense speech (Japanese) runs at about 6x, sparse film dialogue at 12-15x.
- **English timing:** the line's first word lands within 1 s of the official subtitle's start for 81% (0.6B) and 85% (1.7B) of the lines that were heard, with a median of 0.3 s.
- **Japanese words:** the 1.7B model makes clearly fewer errors (10.8% against 14.4% CER). Names written in katakana and rarer kanji are where it slips. For example, ロランド・メンドーサ came out as ロランド面倒差, and 敵対的環境 as 適体適環境.
- **Japanese timing, problem 1:** in several 30 s chunks, the aligner put Japanese words 1-2 s late (against where each sentence's speech starts, measured from the loudness).
- **Japanese timing, problem 2:** one whole 7 s sentence (65-72 s) was missing from the text, and the aligner then placed the next sentence's first word in its gap.
- **Japanese timing, a mistake of mine:** version 1 also measured lines from the start of each FLEURS file, not from where the speech starts, which made all its Japanese timing numbers look worse. Version 2 measures from the speech start.
- **Baseline:** faster-whisper large-v3-turbo did not run. It needs CUDA 12's cuBLAS, and Kaggle's image is CUDA 13. Version 2 adds the CUDA 12 libraries.
- **Version 2** (queued on Kaggle at the time of writing) adds:
  - a mode that cuts at the quietest moment 10-20 s along instead of every 30 s, to test whether short pieces fix the Japanese timing and the lost sentence;
  - the faster-whisper baseline;
  - a warm-up call before timing.

**Kaggle:** "Browser 1" is signed in and phone-verified. Version 1 used 6 minutes of the 30 free GPU hours a week. Nothing paid.

## Next step (one)

Read version 2. Then build the generation path on the box's API with the GPU work elsewhere:
- Qwen3-ASR-1.7B plus the forced aligner, on sound cut at pauses, served from the viewer's position.
- The sound comes from the watching screen, as the aligner's does; never from fetching the film.
- Japanese is transcribed and timed first, then translated. The translation is projected onto the Japanese timing, never force-aligned against Japanese audio.
