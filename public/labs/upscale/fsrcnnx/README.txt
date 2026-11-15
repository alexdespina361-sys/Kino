The "Film" modes of the upscaler test page (/labs/upscale/): FSRCNNX by igv, mpv user shaders.

  Source:  https://github.com/igv/FSRCNN-TensorFlow/releases/tag/1.1 ("FSRCNNX")
  Files:   FSRCNNX_x2_8-0-4-1.glsl   sha256 e800dbc5c1c95185cc82216c597724533ff5f2880179f256eef600f03e8dc2ae
           FSRCNNX_x2_16-0-4-1.glsl  sha256 d5a24a271e5d9a3f7f7a053b150c460a44c25b3cf7f770857d57cc3a2e1c9965
  Licence: GNU Lesser General Public License, version 3.0 or later, as each file's own header says
           (LICENSE-LGPL-3.0.txt; it builds on LICENSE-GPL-3.0.txt). Copyright (C) 2017-2021 igv.

The two files are served here exactly as released: not changed, not bundled into the page's code. The page fetches one
when a Film mode is first chosen and runs it with its own reader of mpv's shader format (src/labs/upscale/fsrcnnx.ts in
Kino's source), so either file can be replaced by another build of FSRCNNX, or any mpv user shader of the same shape.
Everything else on the page is Kino's own code or MIT-licensed (AMD FSR 1, Anime4K-WebGPU).
