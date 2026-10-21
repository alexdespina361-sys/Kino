import { readFileSync } from "node:fs";
const buf = readFileSync(process.argv[2]!);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let off = 12;
while (off < buf.length) {
  const len = dv.getUint32(off, true);
  const type = dv.getUint32(off + 4, true);
  if (type === 0x4e4f534a) { const j = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString("utf8")); console.log(JSON.stringify(j, null, 1).slice(0, 3500)); }
  else console.log("chunk type", type.toString(16), "bytes", len);
  off += 8 + len + ((4 - (len % 4)) % 4);
}
