import { useEffect, useRef, useState } from "react";
import { t, useT } from "../i18n";
import { CloseIcon } from "../shared/icons";
import { codeFromScan } from "./scan";

/** The browser's own QR reader (Chrome and Android WebViews). Not in TypeScript's DOM types yet. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare const BarcodeDetector: (new (options: { formats: string[] }) => BarcodeDetectorLike) | undefined;

/** Frames are shrunk to this width before decoding: a QR code on a TV is big, and this is much faster than full resolution. */
const SCAN_WIDTH = 480;
/** About ten looks a second is plenty for a code held in front of the camera. */
const SCAN_EVERY_MS = 100;

export const cameraAvailable = () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

function describeCameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return t("scan.blocked");
  if (name === "NotFoundError" || name === "OverconstrainedError") return t("scan.noCamera");
  if (name === "NotReadableError") return t("scan.busy");
  return t("scan.failed");
}

/**
 * Full-screen camera that reads the TV's QR code and hands back the code in it. `read` says what counts as one: the six
 * digits of pairing (the default) or, with `linkFromScan`, the code on the TV's sign-in screen.
 */
export function Scanner({ onCode, onClose, read = codeFromScan }: { onCode: (code: string) => void; onClose: () => void; read?: (text: string) => string | null }) {
  useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // The latest callbacks, without restarting the camera whenever the parent re-renders.
  const handlers = useRef({ onCode, onClose, read });
  handlers.current = { onCode, onClose, read };

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        });
      } catch (cause) {
        if (!stopped) setError(describeCameraError(cause));
        return;
      }
      const video = videoRef.current;
      if (stopped || !video) return stream.getTracks().forEach((track) => track.stop());
      video.srcObject = stream;
      await video.play().catch(() => {});

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      let native: BarcodeDetectorLike | null = null;
      try {
        native = typeof BarcodeDetector === "function" ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
      } catch {
        /* the browser has the API but not for QR codes: use the library */
      }
      // The library is only fetched when there is no (working) built-in reader, which is the case on iPhones.
      let decoder: ((data: Uint8ClampedArray, width: number, height: number) => { data: string } | null) | null = null;

      const look = async () => {
        if (stopped) return;
        if (context && video.videoWidth > 0) {
          canvas.width = Math.min(SCAN_WIDTH, video.videoWidth);
          canvas.height = Math.round((canvas.width / video.videoWidth) * video.videoHeight);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          let text: string | undefined;
          try {
            if (native) {
              try {
                text = (await native.detect(canvas))[0]?.rawValue;
              } catch {
                native = null; // a reader that errors (service missing on this device) is not coming back: switch to the library
              }
            }
            if (!native) {
              decoder ??= (await import("jsqr")).default;
              text = decoder(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data;
            }
          } catch {
            /* a frame that can't be read is just skipped */
          }
          const code = text ? handlers.current.read(text) : null;
          if (code && !stopped) {
            stopped = true;
            handlers.current.onCode(code);
            return;
          }
        }
        timer = setTimeout(look, SCAN_EVERY_MS);
      };
      void look();
    };
    void start();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && handlers.current.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={t("scan.title")} data-testid="scanner">
      <video ref={videoRef} className="scanner-video" playsInline muted />
      <div className="scanner-shade" aria-hidden="true">
        <div className="scanner-frame" />
      </div>
      <button className="scanner-close" onClick={onClose} aria-label={t("scan.close")} data-testid="scanner-close">
        <CloseIcon />
      </button>
      <p className="scanner-hint" role={error ? "alert" : "status"} data-testid="scanner-hint">
        {error ?? t("scan.hint")}
      </p>
    </div>
  );
}
