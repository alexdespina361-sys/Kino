#!/bin/sh
# Colab (free T4): the subtitle generation prototype and its noise test, one step per notebook cell (see generate.py and README.md):
#   sh gen.sh install | prepare | whisper | qwen | musci | table
# Run from the folder holding bench.py and generate.py. Every model runs in its own process.
# A dry run first (40 s clips, two sounds, kept apart from the real run):
#   export GEN_DIR=/content/work/gen-dry BENCH_OUT=/content/dry GEN_EN_SECONDS=40 GEN_JA_SECONDS=40 GEN_SOUNDS=clean,film+tiger
export BENCH_OUT="${BENCH_OUT:-/content/out}" BENCH_WORK="${BENCH_WORK:-/content/work}"
quiet='pad_token_id|I0000|WARNING: All log|TensorFlow|AVX|absl|generation flags|Setting `pad_token_id`|FutureWarning|warnings.warn|UserWarning'
DBS='git+https://github.com/JusperLee/Dynamic-Band-Splitting.git@ff526463a58ee0278e7bd05c4b8bce112b743e34'
case "$1" in
  install)
    # (One pip call per part, so one that will not install leaves the others working; silero-vad without its dependencies: only its
    # ONNX file is used, through onnxruntime, so torchaudio is never touched.)
    for part in qwen-asr==0.0.6 "faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12==9.*" onnxruntime demucs==4.0.1 "$DBS"; do
      pip install -q $part 2>&1 | tail -2
    done
    pip install -q --no-deps silero-vad==5.1.2 2>&1 | tail -1
    for m in qwen_asr faster_whisper onnxruntime demucs dbs; do python -c "import $m" 2>/dev/null && echo "ok $m" || echo "MISSING $m"; done
    python -c "import importlib.util as u, os; s = u.find_spec('silero_vad'); print('ok silero onnx' if s and os.path.exists(os.path.join(list(s.submodule_search_locations)[0], 'data', 'silero_vad.onnx')) else 'MISSING silero onnx')"
    python -c "import torch, transformers; print('torch', torch.__version__, 'transformers', transformers.__version__, 'cuda', torch.cuda.is_available())"
    exit ;;
  table)
    python -c "
import json, generate
rows = json.load(open('$BENCH_OUT/gen-results.json', encoding='utf-8'))
print(generate.table(rows))
for r in rows:
    if 'lines_16_on' in r: print(generate.brief(r).split(chr(10), 1)[-1])
"
    exit ;;
esac
LIBS=$(python -c "import nvidia.cublas.lib as a, nvidia.cudnn.lib as b; print(list(a.__path__)[0] + ':' + list(b.__path__)[0])")
export LD_LIBRARY_PATH="$LIBS:$LD_LIBRARY_PATH"
case "$1" in
  prepare|prepare-film|prepare-corpus|agree) python generate.py "$1" 2>&1 | grep -vE "$quiet" ;;
  whisper|qwen|musci) python generate.py run "$1" 2>&1 | grep -vE "$quiet" ;;
  *) echo "sh gen.sh install | prepare | whisper | qwen | musci | table" ;;
esac
