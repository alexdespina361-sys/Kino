# RIFE for the upscaler test page's frame boost

`rife-v4.25-lite.onnx` makes the frame at a moment between two of the video's frames, for "Frame boost" with
"Frames made by: RIFE" on `/labs/upscale/`. The page runs it in the visitor's browser with ONNX Runtime Web on WebGPU
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

Checked by Kino (16 Nov 2026) on two scenes of Tears of Steel (CC BY, Blender Foundation): the frame it makes halfway between
two frames against the real middle frame, luma PSNR 35-38 dB on moving frames (a plain mix of the two: 21-22 dB), the same as
the full RIFE 4.25 and as the processor's own answer for the same file.
