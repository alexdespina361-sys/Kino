import { useEffect, useMemo, useState } from "react";

const QUIET_ZONE = 2;

type Maker = typeof import("qrcode-generator");
let maker: Maker | undefined;
let asked: Promise<Maker> | undefined;

export function loadQrMaker(): Promise<Maker> {
  asked ??= import("qrcode-generator").then(
    (module) => (maker = module.default),
    (error: unknown) => {
      asked = undefined;
      throw error;
    },
  );
  return asked;
}

function drawn(make: Maker, value: string): { size: number; path: string } {
  const qr = make(0, "M");
  qr.addData(value);
  qr.make();
  const size = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!qr.isDark(row, col)) continue;
      let end = col;
      while (end + 1 < size && qr.isDark(row, end + 1)) end++;
      path += `M${col} ${row}h${end - col + 1}v1h${col - end - 1}z`;
      col = end;
    }
  }
  return { size, path };
}

export function QrCode({ value, label }: { value: string; label: string }) {
  const [make, setMake] = useState(() => maker);
  useEffect(() => {
    if (make) return;
    let on = true;
    const ask = () =>
      loadQrMaker().then(
        (made) => on && setMake(() => made),
        () => on && setTimeout(ask, 3000),
      );
    void ask();
    return () => {
      on = false;
    };
  }, [make]);
  const code = useMemo(() => (make ? drawn(make, value) : undefined), [make, value]);

  if (!code) return <svg viewBox="0 0 1 1" role="img" aria-label={label} aria-busy="true" data-testid="pairing-qr-wait"><rect width="1" height="1" fill="#fff" /></svg>;
  const total = code.size + QUIET_ZONE * 2;
  return (
    <svg
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${total} ${total}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-testid="pairing-qr"
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={total} height={total} fill="#fff" />
      <path d={code.path} fill="#000" />
    </svg>
  );
}
