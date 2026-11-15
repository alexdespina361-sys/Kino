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

## For generation on request (Workflow B): what is known, nothing benchmarked yet

From the model cards. The speed numbers are each card's own, on hardware it often does not name.

| Use | Candidates | Notes |
|---|---|---|
| English speech | Qwen3-ASR-0.6B (Apache-2.0, ~0.9B); FUTO asr4all-s (28M, CPU, English only, its own "ethical use" licence) | asr4all-s: RTFx 52 single-thread on a desktop i9 (its card); no timestamps stated |
| Japanese speech | Qwen3-ASR-1.7B (Apache-2.0); Parakeet TDT-CTC 0.6B ja (CC-BY-4.0, NeMo, CER 6.4 JSUT) | The anime/galgame fine-tune of Qwen3-ASR-1.7B scores better only on its author's own set, and its licence is "other" with dataset terms: avoid |
| Timing words | Qwen3-ForcedAligner-0.6B (Apache-2.0) | Audio + transcript to word times, English and Japanese, up to 5 min a call; 42 ms (ja) and 38 ms (en) mean error on its card |

**Kaggle:** the browser signed in is "Browser 1" (the other one is not signed in). The account is phone-verified, which GPU notebooks need.
This week: GPU 0 of 30 h used, TPU 0 of 20 h; Kaggle's own AI-model credit $0 of $10 a day. Nothing was started there.

## Next step (one)

A Kaggle notebook (free GPU) that runs Qwen3-ASR-0.6B + Qwen3-ForcedAligner on two short clips that may be shared (one English, one Japanese;
Creative Commons or made up), and measures:

- the time to the first 30 s of timed subtitles;
- the time for 3 minutes;
- the speed against playback;
- the errors, shown as real lines.

The fixer's report format and the aligner's line placement then carry the result. For the website, the sound for generation would come from
the watching screen (as the aligner's does), never from fetching the film.
