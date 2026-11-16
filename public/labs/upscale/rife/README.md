# RIFE for the upscaler test page's frame boost

`rife-v4.25-lite.onnx` makes the frame at a moment between two of the video's frames, for "Frame boost" with
"Frames made by: RIFE" on `/labs/upscale/` (the page's checks of single frames and its tests; the live boost uses the same
network cut before its last step, `rife-v4.25-lite-motion.onnx`, below). The page runs it in the visitor's browser with ONNX Runtime Web on WebGPU
(`src/labs/upscale/rife.ts`). Nothing is sent anywhere.

- **What:** RIFE 4.25 lite, from Practical-RIFE by hzwer (Zhewei Huang et al., "RIFE: Real-Time Intermediate Flow Estimation
  for Video Frame Interpolation", ECCV 2022): https://github.com/hzwer/Practical-RIFE. The network and the weights are hzwer's.
  The Practical-RIFE README states that the content of its weight links "is under the same MIT license as this project".
- **This file:** the ONNX export published at https://huggingface.co/t9749/rife-4.25-lite-onnx (revision
  `8d1488a82e19fd2f2ca5b3ee1d1bfacd6787b9df`, file `rife_v425lite.onnx`, licence MIT), served here byte for byte as downloaded.
  Its README describes the export: hzwer's `IFNet_HDv3.py` and `flownet.pkl` loaded with `weights_only=True`, a stateless warp,
  `torch.onnx.export` at opset 17.
- **Size:** 22,677,513 bytes. **SHA-256:** `702802d0862ab78f2d72133c6bc3768e7e89b81756f7cd51d1055a2fe3d06577`
  (the same as Hugging Face's record of the file).
- **Inputs:** `img0`, `img1` (float32 `[1, 3, H, W]`, RGB 0..1, H and W multiples of 64), `timestep` (float32 `[1, 1, 1, 1]`).
  **Output:** `frame` (float32 `[1, 3, H, W]`, 0..1).
- **Licence:** MIT, Copyright (c) 2021 hzwer: see `LICENSE.txt` next to this file.

## `rife-v4.25-lite-motion.onnx`: the same network without its last step

The live frame boost uses this one. It is `rife-v4.25-lite.onnx` above, cut by Kino before its last step (the two warps and
the blend), with nothing else changed: the same network, the same weights, the same MIT licence (Copyright (c) 2021 hzwer).

- **Made with:** `python -I scripts/labs/rife-cut-motion.py rife-v4.25-lite.onnx rife-v4.25-lite-motion.onnx` (onnx 1.17).
  It keeps the 1,381 operations the motion needs and drops the 218 after it, and names the batch size `n` instead of a
  fixed 1, so that several moments are made in one run (a batch of two gives exactly what two runs of one give).
- **Size:** 22,657,156 bytes. **SHA-256:** `35d382a2c07e3aad241c74c3557062bfd5a337b16bd03a34ef7575488b4cd4d4`.
- **Inputs:** as above, each with `n` first. **Output:** `flowmask` (float32 `[n, 5, H, W]`): where to look in `img0` (x, y, in pixels), the same
  in `img1`, then how much of `img0` to take (0..1). The page makes the frame from it at the video's full size
  (`src/labs/upscale/frameBoost.ts` `warp`), so RIFE can find the motion on smaller pictures (much faster) while the frame
  keeps the video's own sharpness.
- **Checked:** the cut file plus that warp gives the stock file's own frame (126 dB apart, i.e. the same to rounding), and the
  motion found at half size, warped at the full size, is 0.4-2 dB from the stock frame's PSNR on Tears of Steel.

Checked by Kino (16 Nov 2026) on two scenes of Tears of Steel (CC BY, Blender Foundation): the frame it makes halfway between
two frames against the real middle frame, luma PSNR 35-38 dB on moving frames (a plain mix of the two: 21-22 dB), the same as
the full RIFE 4.25 and as the processor's own answer for the same file.
