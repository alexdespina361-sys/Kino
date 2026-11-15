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

## Generation on request (Workflow B): measurements (15 Nov 2026, free T4 on Kaggle and Colab)

**The goal:** subtitles with the right words, each line starting where its speech starts, to about a tenth of a second.

The model cards (licences, sizes, their own numbers):

| Use | Candidates | Notes |
|---|---|---|
| English speech | Qwen3-ASR-0.6B / 1.7B (Apache-2.0); faster-whisper large-v3-turbo (MIT); FUTO asr4all-s (28M, CPU, English only, its own "ethical use" licence) | asr4all-s: RTFx 52 single-thread on a desktop i9 (its card); no timestamps stated |
| Japanese speech | Qwen3-ASR-1.7B (Apache-2.0); Parakeet TDT-CTC 0.6B ja (CC-BY-4.0, NeMo, CER 6.4 on JSUT) | The anime/galgame fine-tune of Qwen3-ASR-1.7B scores better only on its author's own set, and its licence is "other" with dataset terms: avoid |
| Timing words | Qwen3-ForcedAligner-0.6B (Apache-2.0) | Audio + transcript to word times, 11 languages incl. English and Japanese, up to 5 min a call |

**What was run:** `scripts/asr-bench/`:
- `bench.py`: the benchmark;
- `diag.py`: the Japanese clip line by line;
- `more.sh`: the Whisper run plus the diag runs.

Version 1 ran on Kaggle. Version 2 ran in a Colab notebook in "Browser 1": Kaggle queued it for 45 minutes and it was cancelled unrun.
- **Hardware and setup:** one T4 (16 GB), bf16, batch size 1, one stream. The sound is cut every 30 s, or at the quietest moment 10-20 s along ("at pauses"), and served in order, as one viewer's request would be.
- **English clip:** *Tears of Steel* (CC BY 3.0, Blender Foundation), the whole film: 734 s, music and action. It is scored against its official English subtitles, which are not a word-for-word transcript.
- **Japanese clip:** FLEURS ja_jp (CC BY 4.0), 15 sentences joined to 188 s. It is **read speech: it says nothing about anime.**

| engine | cut | English: first 30 s / 3 min / speed | English WER | Japanese: first 30 s / 3 min / speed | Japanese CER | VRAM |
|---|---|---|---|---|---|---|
| Qwen3-ASR-0.6B + aligner | every 30 s | 3.3 s / 12.1 s / 16x | 23% | 4.5 s / 28.6 s / 6.4x | 14.4% | 3.6 GB |
| Qwen3-ASR-1.7B + aligner | every 30 s | 3.7 s / 15.5 s / 12x | 25% | 5.4 s / 32.8 s / 5.6x | 10.8% | 6.1 GB |
| Qwen3-ASR-0.6B + aligner | at pauses | 4.6 s (first piece 1.2 s) / 13.0 s / 15x | 30% | 7.6 s (1.9 s) / 31.7 s / 5.9x | 11.1% | 3.6 GB |
| Qwen3-ASR-1.7B + aligner | at pauses | 5.5 s (first piece 1.6 s) / 44.2 s / 6.2x | 29% | 8.1 s (1.7 s) / 35.1 s / 5.4x | **6.3%** | 6.1 GB |
| faster-whisper large-v3-turbo | every 30 s | **0.8 s / 3.2 s / 43x** | 26% | 1.1 s / 5.9 s / 30x | 18.7% | (not torch) |

**Speed is settled.**
- Every engine runs well ahead of playback on a free T4; the slowest is 5.4x.
- With cuts at pauses, the first lines are ready in under 2 s.
- The 1.7B English run at pauses was slower (6.2x) with no sign of looping: its SRT has 825 words, against Whisper's 812. That slowdown is not explained yet.

**Japanese words: Qwen3-ASR-1.7B, cut at pauses, is clearly best.**
- Its CER is 6.3%, against 10.8% when cut every 30 s, 11.1% for the 0.6B model and 18.7% for Whisper.
- Where it slips is names and rarer words. For example, ロランド・メンドーサ came out as ロランド面倒さ, 九龍 as 空ロ and 磁気反転 as 時計判定.
- In both cuts it dropped one whole 7 s sentence, which Whisper heard.

**English words: these runs cannot rank the engines.**
- The reference is a subtitle file, not a transcript.
- 23% against 25% is about five words.
- Cutting at pauses hears more interjections that the subtitles leave out (17 "Oh"s), which count as errors.
- Deciding this needs a verbatim reference (see the next step).

**Timing, Japanese, line by line.** These are measured against where each line's speech starts, found by loudness against the recording's own noise floor.

| | within 0.1 s | within 0.3 s | badly off |
|---|---|---|---|
| Qwen3-ForcedAligner (on 1.7B's words) | 11 of 14 lines (all within 0.04 s) | 11 of 14 | 3 lines, all **too early**: 1.6 s and 4.2 s, where a piece starts with a quiet or noisy lead-in and the first word is put in it; 7.8 s for the line after the dropped sentence, whose first word went into that sentence's gap |
| Whisper turbo's own word times | 1 of 14 | 14 of 14 (consistently about 0.17 s early) | none |

- So the aligner is very exact when it is right, but now and then badly wrong. Every one of its misses puts a word where nobody speaks, which a voice detector can see.
- Whisper is never far off, but never exact either.
- **A mistake of mine, now fixed:** up to now the reference took the first moment louder than 5% of the loudest. That fired on the background noise before people speak in 9 of the 15 lines, and made every engine look 1-2 s late. It had been reported as "the aligner is 1-2 s late" in version 1.
- The rule now: 3x the recording's quiet level and 15% of its loudest. It is checked against Whisper's times, which do not depend on it; nearby settings give the same answer.

**English timing** (against the official subtitles' starts, which are hand-made):
- the median is 0.3 s for every engine;
- 81-89% of lines are within 1 s for Qwen, and 95% for Whisper.

**Free GPU used:** Kaggle 6 minutes (version 1), Colab about 20 minutes. Nothing paid.

## The generation pipeline: the order, and why

1. **Sound from the watching screen.** The site aligner already captures it (`src/client/subsync/capture.ts`), measured within 30-47 ms of the picture, and decides which stretch to listen to first, nearest the picture (`schedule.ts`). Reused as it is. The film itself is never fetched.
2. **Voice detector, then cut.** Silero, already in the site aligner, finds where people speak. The sound is cut in the gaps between speech, into pieces of 10-20 s that start just before speech. (The bench's "quietest moment" cut stands in for this.)
3. **ASR:** the words exactly as they are said.
4. **Word times:** the forced aligner, on those exact words, over the same piece. It has to come straight after ASR, before anything rewrites the text, because an aligner can only time the words that were actually said.
5. **Check against the voice detector.** This is where the existing alignment code earns its place, and these rules catch all three Qwen misses above:
   - a line whose first word sits where the detector hears no speech is moved to where speech starts;
   - speech with no words in it goes back to ASR on its own (the dropped sentence);
   - a word that cannot be placed is marked unsure, never given an invented time.
6. **Lines from the word times.** Plain rules, not AI:
   - a new line after a pause over 0.5 s or a sentence end;
   - at most 42 characters by 2 lines, 1-7 s on screen, at most 17 characters a second (a line's end moves into the gap after it).
   AI may add punctuation and capitals only, and its answer is used only if the words come back unchanged.
7. **Japanese:** translate a few lines at a time with their neighbours as context, into English or Romanian, and put each translation on its Japanese line's times. A translation is never aligned to the sound.
8. **Cache:** keyed by film, sound track and pipeline version, and shared between viewers. This reuses the site aligner's sharing (`share.ts`, `src/server/subsync/`).

**Why not ASR, then formatting, then alignment:** reformatted or rewritten text no longer matches what is said, so the aligner cannot time it. Formatting comes after word timing and works from it.

**Why the site aligner's solver does not time the generated lines:**
- It moves a whole existing file onto the sound (offset and stretch): 0.22 s on its lab clip with English words, 1-3 s with the voice detector alone. Japanese only ever gets the voice detector.
- Generated words are already timed from the same sound, so there is no file shift to find.
- What it does give generation: the capture, the voice detector, the "nearest the picture first" order and the sharing.

**Speed or quality first: quality,** since speed is already well ahead of playback.
- **Japanese:** Qwen3-ASR-1.7B, cut at pauses, plus the aligner and the check. Parakeet-ja is the one alternative worth a single run, on anime-like sound.
- **English:** Qwen3-ASR-1.7B or Whisper turbo, undecided until a verbatim test. Whisper is 3x faster with steadier times, so it may be the fast first pass if Qwen wins on words.

## Next step (one)

Build steps 2-6 as `scripts/asr-bench/generate.py` and run it on the same two clips on Colab:
- Silero cuts;
- Qwen3-ASR-1.7B plus the aligner;
- the voice-detector check, with the retry for speech that has no words;
- the line rules.

Done when the Japanese clip has:
- 14 of 14 lines within 0.3 s of the speech start;
- the dropped sentence back;
- a CER of 6.5% or less.

Add one English clip with a word-for-word transcript, to settle Qwen against Whisper. After that, the queue and cache at the site (Phase 3).
