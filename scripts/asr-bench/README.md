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
- Clips are fetched inside the notebook. Both may be shared:
  - English: *Tears of Steel*, CC BY 3.0, (CC) Blender Foundation | mango.blender.org. It is the whole 12-minute film, with its official English subtitles as the reference. That reference is a subtitle file, not a transcript, so the WER it gives is an upper bound.
  - Japanese: FLEURS ja_jp test, CC BY 4.0, Google, joined to about 3 minutes. It is **read speech**, so it says nothing about anime.
- Local check without a GPU or downloads:
  ```
  BENCH_FAKE=1 BENCH_OUT=out BENCH_EN_AUDIO=clip.wav BENCH_EN_SRT=clip.srt python bench.py
  ```
- Results and what they mean: `docs/subtitle-fixer.md`, section "Generation".
