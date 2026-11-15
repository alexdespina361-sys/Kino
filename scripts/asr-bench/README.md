# ASR benchmark (Workflow B, step one)

Measures speech-to-timed-subtitles the way a viewer would feel it: one stream, 30 s chunks in order, from the start of a clip. It reports:
- time to the first 30 s of subtitles;
- time until 3 minutes are covered;
- speed against playback;
- WER or CER;
- how far each line's first word lands from where it should;
- peak VRAM;
- reference and recognised lines side by side.

- `bench.py` is the whole benchmark. Engines sit behind `Engine`:
  - Qwen3-ASR 0.6B and 1.7B, with Qwen3-ForcedAligner-0.6B for word times;
  - faster-whisper large-v3-turbo as a baseline.
- `kino_asr_bench.ipynb` is built from it by `python build_notebook.py`. It is what is imported into Kaggle: GPU on, Internet on, then Save Version → Run All.
- On Colab (T4 runtime), no notebook file is needed. One cell fetches `bench.py` from GitHub with `wget` and runs `python bench.py qwen`, then the same with `BENCH_CUT=pause`. Then `sh more.sh` runs the Whisper baseline (installing CUDA 12's cuBLAS/cuDNN wheels, which the images lack) and `diag.py`.
- `diag.py <Qwen model id | whisper> [fixed|pause]` prints the Japanese clip line by line: where each line's speech starts, where the engine put its first word, and a loudness strip. It is how a late aligner is told apart from a wrong reference.
- Clips are fetched inside the notebook. Both may be shared:
  - English: *Tears of Steel*, CC BY 3.0, (CC) Blender Foundation | mango.blender.org. It is the whole 12-minute film, with its official English subtitles as the reference. That reference is a subtitle file, not a transcript, so the WER it gives is an upper bound.
  - Japanese: FLEURS ja_jp test, CC BY 4.0, Google, joined to about 3 minutes. It is **read speech**, so it says nothing about anime.
- Local check without a GPU or downloads:
  ```
  BENCH_FAKE=1 BENCH_OUT=out BENCH_EN_AUDIO=clip.wav BENCH_EN_SRT=clip.srt python bench.py
  ```
- Results and what they mean: `docs/subtitle-fixer.md`, section "Generation".

## `generate.py`: the generation pipeline, and its test on film-like sound

The prototype of what the site would run on request. It works piece by piece from the start:
1. the voice detector (Silero v5, the official ONNX file through onnxruntime);
2. cuts of 10-20 s in the longest stretch without speech;
3. Qwen3-ASR-1.7B with the forced aligner;
4. the voice-detector fix: a word starting in silence moves to where speech starts, if that is at least 0.25 s later;
5. the second listener: where Whisper heard words and Qwen gave none, the stretch is raised to normal loudness. If the voice detector then hears speech, Qwen listens again, and Whisper's words are used if it still hears nothing;
6. the line rules, written as SRT.

The test sounds are built by `prepare`:
- FLEURS en_us (about 8 minutes) and ja_jp (about 6 minutes; its first 15 lines are the clip `bench.py` uses);
- mixed with *Tears of Steel*'s music and effects at 0 dB for every line ("film");
- a simulated old optical track: +5 dB, a 200-4000 Hz band, hum and hiss ("old");
- each of those with the speech isolated by DBS-TIGER-DnR (Apache-2.0) or Demucs htdemucs (MIT).

On Colab, one cell per step, from a folder holding `bench.py`, `generate.py` and `gen.sh`:
```
sh gen.sh install     # qwen-asr 0.0.6, faster-whisper + CUDA 12 wheels, onnxruntime, demucs 4.0.1, DBS at a pinned commit, silero-vad (its ONNX file only)
sh gen.sh prepare     # the sounds above, with each isolator's speed, SI-SDR against the clean speech, and lag
sh gen.sh whisper     # first: its words are the second listener's
sh gen.sh qwen        # the pipeline, plus one Japanese run with the clip's names given as context
sh gen.sh musci       # Musci-ASR-2.4B (English only, pinned revision) with the same aligner and checks
sh gen.sh table
```
For a dry run first, see the header of `gen.sh`. Without a GPU, `python generate.py replay` runs the checks and the lines on saved word times (`GEN_REPLAY_DIR`). It also takes `GEN_SILERO_ONNX`, the path of a `silero_vad.onnx`.
