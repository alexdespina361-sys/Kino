/*
 * A WebAssembly module put together by hand, byte by byte, for the tests of what runs one (see `wasmDecrypt`) and of what hands one over (the adapters):
 * the module is as bad, or as good, as the test needs it to be. It has the three exports that the players' modules have: `memory`, `alloc` and `decrypt`.
 */
export const u32 = (value: number): number[] => {
  const out: number[] = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest = Math.floor(rest / 128);
    if (rest > 0) byte |= 0x80;
    out.push(byte);
  } while (rest > 0);
  return out;
};
export const i32Const = (value: number): number[] => {
  const out: number[] = [0x41];
  let rest = value;
  for (;;) {
    const byte = rest & 0x7f;
    rest >>= 7;
    if ((rest === 0 && !(byte & 0x40)) || (rest === -1 && byte & 0x40)) return [...out, byte];
    out.push(byte | 0x80);
  }
};
const section = (id: number, body: number[]) => [id, ...u32(body.length), ...body];
const vector = (items: number[][]) => [...u32(items.length), ...items.flat()];
const name = (text: string) => [...u32(text.length), ...Buffer.from(text)];
const func = (code: number[]) => [...u32(code.length + 1), 0, ...code]; // (no locals)

export const END = 0x0b;
/** `alloc(len)` hands out a place at 1024. */
const ALLOC = [...i32Const(1024), END];
/** `decrypt(at, len)` says the text is the `len - 12` bytes after a header of 12. */
export const DECRYPT_AFTER_HEADER = [0x20, 1, ...i32Const(12), 0x6b, END];

/** One memory as the module declares it: what it starts with (64 KiB pages) and, if it says so, the most it may grow to. */
export const memory = (initial: number, most?: number): number[] => (most === undefined ? [0x00, ...u32(initial)] : [0x01, ...u32(initial), ...u32(most)]);

export function wasmModule(options: { decrypt?: number[]; pages?: number | null; memories?: number[][] } = {}): Uint8Array<ArrayBuffer> {
  const pages = options.pages === undefined ? 1 : options.pages;
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...section(1, vector([[0x60, 1, 0x7f, 1, 0x7f], [0x60, 2, 0x7f, 0x7f, 1, 0x7f]])),
    ...section(3, vector([[0], [1]])),
    ...(options.memories ? section(5, vector(options.memories)) : pages === null ? [] : section(5, vector([memory(pages)]))),
    ...section(7, vector([[...name("memory"), 2, 0], [...name("alloc"), 0, 0], [...name("decrypt"), 0, 1]])),
    ...section(10, vector([func(ALLOC), func(options.decrypt ?? DECRYPT_AFTER_HEADER)])),
  ]);
}
/** What the module is given: 12 bytes that it ignores, and then the text. */
export const sealed = (text: string) => Buffer.concat([Buffer.alloc(12), Buffer.from(text)]);
