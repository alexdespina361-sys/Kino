import qrcode from "qrcode-generator";
import { useMemo } from "react";

const QUIET_ZONE = 2; // modules of white around the code; scanners need some

/** A QR code as one SVG path: crisp at any size, no canvas, no images. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const size = qr.getModuleCount();
    let path = "";
    for (let row = 0; row < size; row++) {
      // One rectangle per horizontal run of dark modules keeps the path short.
      for (let col = 0; col < size; col++) {
        if (!qr.isDark(row, col)) continue;
        let end = col;
        while (end + 1 < size && qr.isDark(row, end + 1)) end++;
        path += `M${col} ${row}h${end - col + 1}v1h${col - end - 1}z`;
        col = end;
      }
    }
    return { size, path };
  }, [value]);

  const total = size + QUIET_ZONE * 2;
  return (
    <svg
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${total} ${total}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-testid="pairing-qr"
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={total} height={total} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
