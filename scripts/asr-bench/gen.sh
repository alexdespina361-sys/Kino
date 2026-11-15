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
  venv-nemo)  # (NeMo for Parakeet, in its own environment that still sees the main one's torch)
    # (Colab's Python has no ensurepip, so `python -m venv` fails: virtualenv brings its own pip.)
    rm -rf /content/venv-nemo; pip install -q virtualenv && python -m virtualenv -q --system-site-packages /content/venv-nemo && /content/venv-nemo/bin/pip install -q "nemo_toolkit[asr]" 2>&1 | tail -2
    /content/venv-nemo/bin/python -c "import nemo.collections.asr; print('ok nemo')"
    exit ;;
  venv-cohere)  # (transformers >= 5.4 for Cohere Transcribe; the Hugging Face token comes from the HF_TOKEN environment variable)
    rm -rf /content/venv-cohere; pip install -q virtualenv && python -m virtualenv -q --system-site-packages /content/venv-cohere && /content/venv-cohere/bin/pip install -q "transformers>=5.4.0" sentencepiece protobuf librosa 2>&1 | tail -2
    /content/venv-cohere/bin/python -c "from transformers import CohereAsrForConditionalGeneration; print('ok cohere')"
    exit ;;
  clean-losers)  # (models and sounds that lost, to free the disk: Musci, the two isolators and their sounds, the dry run)
    rm -rf ~/.cache/huggingface/hub/models--Musci-research--Musci-ASR-2.4B ~/.cache/huggingface/hub/models--JusperLee--DBS-TIGER-DnR \
      ~/.cache/torch/hub/checkpoints/*htdemucs* ~/.cache/torch/hub/checkpoints/955717e8-8726e21a.th /content/work/gen-dry /content/dry
    rm -f "${GEN_DIR:-$BENCH_WORK/gen}"/*+tiger.npy "${GEN_DIR:-$BENCH_WORK/gen}"/*+demucs.npy
    df -h /content | tail -1
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
  show) python generate.py show "$2" "$3" "${4:-missed}" 2>&1 | grep -vE "$quiet" ;;
  whisper|qwen|musci|granite) python generate.py run "$1" 2>&1 | grep -vE "$quiet" ;;
  parakeet) /content/venv-nemo/bin/python generate.py transcribe parakeet 2>&1 | grep -vE "$quiet|^\[NeMo W|^\s*warnings" ; python generate.py run aligned:parakeet 2>&1 | grep -vE "$quiet" ;;
  cohere) /content/venv-cohere/bin/python generate.py transcribe cohere 2>&1 | grep -vE "$quiet" ; python generate.py run aligned:cohere 2>&1 | grep -vE "$quiet" ;;
  aligned) python generate.py run "aligned:$2" 2>&1 | grep -vE "$quiet" ;;  # (sh gen.sh aligned cohere: time the saved text again, no recogniser)
  edit)  # sh gen.sh edit <lang> <sound> <main engine> <other engines, comma-separated> "<title>" "<names>" [raw]: editing step + subtitle events
    python -c "import bitsandbytes" 2>/dev/null || pip install -q bitsandbytes 2>&1 | tail -1
    others=""; for e in $(echo "$5" | tr ',' ' '); do others="$others${others:+,}$BENCH_OUT/gen-words-$e-$2-$3.json"; done
    if [ -n "$8" ]; then tag=raw; flag=--raw; else tag=llm; flag=""; fi
    EDITOR_CACHE="${EDITOR_CACHE:-$BENCH_OUT/llm-cache.json}" python editor.py "$BENCH_OUT/gen-words-$4-$2-$3.json" "$others" "$BENCH_OUT/final-$tag-$4-$2-$3.srt" --lang "$2" --title "$6" --names "$7" $flag 2>&1 | grep -vE "$quiet" ;;
  score)  # sh gen.sh score <lang> <sound> <reference.srt | ref> SRT...: one line each (words, lines, starts, invented candidates, format)
    lang="$2"; ref="$4"
    if [ "$ref" = ref ]; then ref="$BENCH_OUT/ref-$2-$3.srt"; python generate.py refsrt "$2" "$3" "$ref"; fi
    shift 4; python subscore.py summary "$ref" "$ref" "$@" --lang "$lang" ;;
  *) echo "sh gen.sh install | venv-nemo | venv-cohere | clean-losers | prepare | prepare-film | prepare-corpus | whisper | qwen | granite | parakeet | cohere | aligned | musci | agree | show | edit | score | table" ;;
esac
