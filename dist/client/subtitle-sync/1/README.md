# Files for the subtitle aligner

Served as they are, kept for good by the browser (`immutable`): a file is never changed in place. A new model or worker goes in a new folder (`2/`) and `src/client/subsync/assets.ts` points to it.

| File | What | Where from | Licence |
|---|---|---|---|
| `silero-vad-16k.bin` (1.2 MB) | The weights of the Silero VAD v5 voice detector (16 kHz) as float32, in the layout `src/client/subsync/silero.ts` reads | github.com/snakers4/silero-vad (`silero_vad.onnx`, converted by the lab; the JavaScript port matches onnxruntime to 2e-6) | MIT, Copyright (c) 2020-present Silero Team |
| `whistle.cact` (16.9 MB) | The Whistle speech recogniser's weights, sha256 `b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb` | huggingface.co/Cactus-Compute/whistle, revision `b358ddadd89b7a713b5aa131f23032d3cca1b251` | Apache-2.0 |
| `whistle-worker.js` (54 KB) | The browser worker of cactus-needle 0.3.0 (an independent community wrapper around Cactus Compute's `needle.wasm`), unchanged apart from the source-map comment | npmjs.com/package/cactus-needle | Apache-2.0 (`LICENSE-cactus-needle`, `NOTICE-cactus-needle`) |
| `needle.wasm` (0.9 MB) | The engine the worker runs | Cactus-Compute/needle3 on Hugging Face, revision `2ae11323dc000f5e70c49f7403efa6af12ba9e67` | Apache-2.0 (`LICENSE-needle-wasm`) |
