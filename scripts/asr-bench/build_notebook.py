"""Builds kino_asr_bench.ipynb from bench.py: `python build_notebook.py`. The notebook is what is imported into Kaggle."""
import json
import os

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "bench.py"), encoding="utf-8") as f:
    bench = f.read()


def code(source):
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": source}


def text(source):
    return {"cell_type": "markdown", "metadata": {}, "source": source}


cells = [
    text(
        "# Kino ASR benchmark\n\n"
        "Speech to timed subtitles, one stream, cut every 30 s or at pauses, as a viewer's request would be served. Clips are fetched here, both may be shared: "
        "*Tears of Steel* (CC BY 3.0, (CC) Blender Foundation | mango.blender.org) and FLEURS ja_jp (CC BY 4.0, Google; read speech). "
        "Needs: GPU on, Internet on. Writes `results.json` and one `.srt` per engine and clip to /kaggle/working.\n"
    ),
    code("!nvidia-smi --query-gpu=name,memory.total --format=csv\n!pip install -q -U qwen-asr 2>&1 | tail -3\n!pip list 2>/dev/null | grep -iE '^(torch|transformers|qwen-asr) '"),
    code("%%writefile bench.py\n" + bench),
    code("!python bench.py qwen"),
    code("!BENCH_CUT=pause python bench.py qwen"),
    # (faster-whisper's CTranslate2 wants CUDA 12's cuBLAS/cuDNN; the image's torch is CUDA 13, so they come as pip wheels and are put on the path.)
    code(
        "!pip install -q -U faster-whisper nvidia-cublas-cu12 'nvidia-cudnn-cu12==9.*' 2>&1 | tail -3\n"
        "import nvidia.cublas.lib, nvidia.cudnn.lib, os\n"
        "os.environ['LD_LIBRARY_PATH'] = ':'.join([list(nvidia.cublas.lib.__path__)[0], list(nvidia.cudnn.lib.__path__)[0], os.environ.get('LD_LIBRARY_PATH', '')])\n"
        "!python bench.py whisper"
    ),
    code(
        "import json\n"
        "r = json.load(open('results.json'))\n"
        "print(json.dumps(r['notes'], ensure_ascii=False, indent=1))\n"
        "for run in r['runs']:\n"
        "    print(run.get('engine'), '|', run.get('clip'))\n"
        "    for e in run.get('examples', [])[:4]:\n"
        "        print('   REF', e['reference'])\n"
        "        print('   ASR', e['recognised'])"
    ),
]
nb = {
    "cells": cells,
    "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python"}},
    "nbformat": 4,
    "nbformat_minor": 5,
}
with open(os.path.join(here, "kino_asr_bench.ipynb"), "w", encoding="utf-8") as f:
    json.dump(nb, f, ensure_ascii=False, indent=1)
print("ok")
