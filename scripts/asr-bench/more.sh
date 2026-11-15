#!/bin/sh
# After bench.py has run in a Colab/Kaggle notebook: the faster-whisper baseline (its CTranslate2 wants CUDA 12's cuBLAS/cuDNN, which
# the images no longer carry, so they come as pip wheels) and the Japanese line-by-line timing check (diag.py) for Qwen and Whisper.
export BENCH_OUT="${BENCH_OUT:-/content/out}"
quiet='pad_token_id|I0000|WARNING: All log|TensorFlow|AVX|absl|generation flags'
pip install -q -U faster-whisper nvidia-cublas-cu12 'nvidia-cudnn-cu12==9.*' 2>&1 | tail -2
LIBS=$(python -c "import nvidia.cublas.lib as a, nvidia.cudnn.lib as b; print(list(a.__path__)[0] + ':' + list(b.__path__)[0])")
export LD_LIBRARY_PATH="$LIBS:$LD_LIBRARY_PATH"
python bench.py whisper 2>&1 | grep -vE "$quiet" | tail -4
python diag.py Qwen/Qwen3-ASR-1.7B pause 2>&1 | grep -vE "$quiet"
python diag.py whisper pause 2>&1 | grep -vE "$quiet"
