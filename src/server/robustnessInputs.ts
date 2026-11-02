import { gzipSync } from "node:zlib";

/**
 * The awkward inputs of `robustness.test.ts`: a seeded generator and the shapes of body, path, query, header and frame that no page sends
 * and that a server has to turn away without a 5xx, a hang or a leak. Nothing here is random but the seed, so the same requests are sent on every machine.
 */

/** A seeded generator (mulberry32) giving numbers in [0, 1). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number from a text (FNV-1a), to seed a generator for one route so that a new route does not change what the others are sent. */
export function hashed(text: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at++) hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193);
  return hash >>> 0;
}

/** `count` of the items, chosen by the generator and kept in the order the list has them: the seed decides which ones, nothing else does. */
export function sample<T>(rand: () => number, items: readonly T[], count: number): T[] {
  if (count >= items.length) return [...items];
  const chosen = new Set<number>();
  while (chosen.size < count) chosen.add(Math.floor(rand() * items.length));
  return items.filter((_, index) => chosen.has(index));
}

export interface Named<T> {
  name: string;
  value: T;
}

/* ------------------------------ JSON that JSON.stringify cannot write ------------------------------ */

/** Text that goes into a body as it is: a number `JSON.stringify` has no way to write, or a key called `__proto__`. */
export class Raw {
  constructor(readonly text: string) {}
}

/** `JSON.stringify` that writes a `Raw` as it is. */
export function toJson(value: unknown): string {
  if (value instanceof Raw) return value.text;
  if (Array.isArray(value)) return `[${value.map(toJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([key, each]) => `${JSON.stringify(key)}:${toJson(each)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Marks a member that is taken out (see `replaceAt`). */
export const DROP = Symbol("drop");
type Path = ReadonlyArray<string | number>;

/** A copy of `value` with what is at `path` replaced by `replacement`, or taken out of its object or array when that is `DROP`. */
export function replaceAt(value: unknown, path: Path, replacement: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return replacement;
  if (Array.isArray(value)) {
    const copy: unknown[] = [...value];
    if (replacement === DROP && rest.length === 0) copy.splice(head as number, 1);
    else copy[head as number] = replaceAt(copy[head as number], rest, replacement);
    return copy;
  }
  const copy: Record<string, unknown> = { ...(value as object) };
  if (replacement === DROP && rest.length === 0) delete copy[head as string];
  else copy[head as string] = replaceAt(copy[head as string], rest, replacement);
  return copy;
}

/** Every place in a value that can be changed: each member of each object and the first item of each array. */
export function pathsIn(value: unknown, at: Array<string | number> = [], out: Array<Array<string | number>> = []): Array<Array<string | number>> {
  if (Array.isArray(value)) {
    if (value.length > 0) {
      out.push([...at, 0]);
      pathsIn(value[0], [...at, 0], out);
    }
  } else if (value && typeof value === "object" && !(value instanceof Raw)) {
    for (const [key, each] of Object.entries(value)) {
      out.push([...at, key]);
      pathsIn(each, [...at, key], out);
    }
  }
  return out;
}

/* ------------------------------ values for a field of a body ------------------------------ */

const nested = (depth: number, wrap: (inner: unknown) => unknown): unknown => {
  let inner: unknown = 1;
  for (let level = 0; level < depth; level++) inner = wrap(inner);
  return inner;
};

/** What a field of a body can be made, short of the right thing. The first `CORE_VALUES` are tried on every field, the rest on some of them (and `heavyValues` only on the routes that take a lot). */
export const CORE_VALUES = 12;
export function awkwardValues(): Array<Named<unknown>> {
  return [
    { name: "null", value: null },
    { name: "a number", value: 7 },
    { name: "a string", value: "text" },
    { name: "an empty string", value: "" },
    { name: "NUL in a string", value: "a\u0000b" },
    { name: "an empty object", value: {} },
    { name: "an empty array", value: [] },
    { name: "an array of null", value: [null] },
    { name: "true", value: true },
    { name: "5000 characters", value: "é".repeat(5000) },
    { name: "1e999", value: new Raw("1e999") },
    { name: "a lone surrogate", value: "x\ud800y" },
    { name: "a low surrogate first", value: "\udc00\ud800" },
    { name: "negative zero", value: new Raw("-0") },
    { name: "minus one", value: -1 },
    { name: "a fraction", value: 1.5 },
    { name: "2**53", value: 2 ** 53 },
    { name: "2**53 plus one", value: new Raw("9007199254740993") },
    { name: "-1e999", value: new Raw("-1e999") },
    { name: "1e-999", value: new Raw("1e-999") },
    { name: "NaN, which JSON writes as null", value: Number.NaN },
    { name: "blanks", value: "   \t " },
    { name: "emoji", value: "👨‍👩‍👧‍👦🏳️‍🌈" },
    { name: "direction marks", value: "‮abc⁦⁩" },
    { name: "zero width", value: "﻿​‍⁠" },
    { name: "a pile of combining marks", value: `e${"́".repeat(500)}` },
    { name: "a dotted capital I", value: "İİİ" },
    { name: "control characters", value: "\u0001\u0007\u001b[31m\u007f" },
    { name: "a name from the prototype", value: "__proto__" },
    { name: "constructor", value: "constructor" },
    { name: "a digit string", value: "123456" },
    { name: "300 characters", value: "a".repeat(300) },
    { name: "70000 characters", value: "b".repeat(70_000) },
    { name: "an object with a key from the prototype", value: new Raw('{"__proto__":{"x":1}}') },
    { name: "a thousand strings", value: Array.from({ length: 1000 }, () => "x") },
    { name: "an object 120 deep", value: nested(120, (inner) => ({ a: inner })) },
    { name: "an array 120 deep", value: nested(120, (inner) => [inner]) },
  ];
}

/** Values of a field that cost the server a lot to look at (as big as a body may be): tried only on the routes that take big things. */
export function heavyValues(): Array<Named<unknown>> {
  return [
    { name: "a hundred thousand small items", value: new Raw(`[${"0,".repeat(99_999)}0]`) },
    { name: "sixty thousand empty objects", value: new Raw(`[${"{},".repeat(59_999)}{}]`) },
    { name: "most of a megabyte", value: "a".repeat(900_000) },
  ];
}

/* ------------------------------ whole bodies ------------------------------ */

export interface BodyShape {
  name: string;
  body?: string | Buffer;
  /** The content type: `application/json` unless said, and none at all when `null`. */
  type?: string | null;
  headers?: Record<string, string>;
  /** Takes a megabyte or so to send: tried only where it can be read. */
  big?: boolean;
}

export function bodyShapes(): BodyShape[] {
  const deepArray = "[".repeat(100_000) + "]".repeat(100_000);
  return [
    { name: "no body", type: null },
    { name: "an empty body that says it is JSON" , body: "" },
    { name: "{}", body: "{}" },
    { name: "[]", body: "[]" },
    { name: "null", body: "null" },
    { name: "a string", body: '"text"' },
    { name: "a number", body: "42" },
    { name: "1e999", body: "1e999" },
    { name: "negative zero", body: "-0" },
    { name: "true", body: "true" },
    { name: "an object 120 deep", body: toJson(nested(120, (inner) => ({ a: inner }))) },
    { name: "an array 120 deep", body: toJson(nested(120, (inner) => [inner])) },
    { name: "an array a hundred thousand deep", body: deepArray, big: true },
    { name: "JSON that stops short", body: '{"a":' },
    { name: "JSON followed by more", body: "{} {}" },
    { name: "single quotes", body: "{'a':1}" },
    { name: "a byte order mark first", body: "﻿{}" },
    { name: "NUL bytes", body: Buffer.from([0, 0, 0]) },
    { name: "bytes that are no UTF-8", body: Buffer.from([0x7b, 0xff, 0xfe, 0x80, 0x7d]) },
    { name: "UTF-16 text", body: Buffer.from("{}", "utf16le") },
    { name: "a hundred thousand small items", body: `[${"0,".repeat(99_999)}0]`, big: true },
    { name: "sixty thousand empty objects", body: `[${"{},".repeat(59_999)}{}]`, big: true },
    { name: "a string of most of a megabyte", body: JSON.stringify("a".repeat(900_000)), big: true },
    { name: "a key of most of a megabyte", body: `{"${"k".repeat(900_000)}":1}`, big: true },
    { name: "plain text", body: "hello", type: "text/plain" },
    { name: "a form", body: "a=1&a=2&__proto__=x&b[]=3", type: "application/x-www-form-urlencoded" },
    { name: "a multipart body with no boundary", body: "--x\r\n\r\n", type: "multipart/form-data" },
    { name: "a multipart body that is nonsense", body: "--x\r\nContent-Disposition: form-data; name=\r\n\r\n--x--", type: "multipart/form-data; boundary=x" },
    { name: "XML", body: "<a/>", type: "application/xml" },
    { name: "a content type that is nonsense", body: "{}", type: "application/json;;;=" },
    { name: "a content type of a few thousand characters", body: "{}", type: `application/json; x=${"y".repeat(4000)}` },
    { name: "a content type that is no type", body: "{}", type: "json" },
    { name: "JSON in a charset that is not one", body: "{}", type: "application/json; charset=nonsense" },
    { name: "JSON labelled as UTF-16", body: Buffer.from("{}", "utf16le"), type: "application/json; charset=utf-16le" },
    { name: "gzip that is gzip", body: gzipSync("{}"), headers: { "content-encoding": "gzip" } },
    { name: "gzip that is not", body: "{}", headers: { "content-encoding": "gzip" } },
    { name: "gzip that stops short", body: gzipSync("{}").subarray(0, 12), headers: { "content-encoding": "gzip" } },
    { name: "gzip that unpacks to far more than the limit", body: gzipSync(Buffer.alloc(4 * 1024 * 1024, 0x20)), headers: { "content-encoding": "gzip" } },
    { name: "a coding nobody has", body: "{}", headers: { "content-encoding": "nonsense" } },
    { name: "a long list of codings", body: "{}", headers: { "content-encoding": Array.from({ length: 200 }, () => "gzip").join(", ") } },
    { name: "brotli that is not", body: "{}", headers: { "content-encoding": "br" } },
    { name: "deflate that is not", body: "{}", headers: { "content-encoding": "deflate" } },
  ];
}

/** The body sizes of two megabytes and more: past the limit of every route that has the usual one. */
export const OVER_THE_LIMIT: BodyShape = { name: "a body past the limit", body: `{"a":"${"a".repeat(2 * 1024 * 1024)}"}`, big: true };

/* ------------------------------ addresses and queries ------------------------------ */

/** What follows the folder's name in the address of a file (the routes that serve a folder), written as it would be on the wire. */
export const FILE_JUNK: Array<Named<string>> = [
  { name: "nothing", value: "" },
  { name: "up a folder", value: "a/../../outside.txt" },
  { name: "up a folder, escaped", value: "%2e%2e%2foutside.txt" },
  { name: "up a folder, escaped twice", value: "%252e%252e%252foutside.txt" },
  { name: "up a folder with backslashes", value: "..%5coutside.txt" },
  { name: "a long climb", value: `${"..%2f".repeat(40)}outside.txt` },
  { name: "dots on dots", value: "....//....//outside.txt" },
  { name: "NUL in the name", value: "index.html%00.txt" },
  { name: "a drive letter", value: "C:%5cx%5cy.txt" },
  { name: "a name with a colon", value: "index.html:stream" },
  { name: "a name a device has", value: "CON" },
  { name: "a folder", value: "assets/" },
  { name: "a folder without its slash", value: "assets" },
  { name: "many slashes", value: "////assets////app.js" },
  { name: "a long name", value: `${"n".repeat(5000)}.js` },
  { name: "unicode", value: encodeURIComponent("ünï-日本語-🙂.js") },
];

/** Path segments, written as they would be on the wire (some are not even valid). */
export const PATH_JUNK: Array<Named<string>> = [
  { name: "nothing", value: "" },
  { name: "a space", value: "%20" },
  { name: "NUL", value: "%00" },
  { name: "a lone percent sign", value: "%" },
  { name: "a broken escape", value: "%zz" },
  { name: "half an escape", value: "%E0%A4%A" },
  { name: "an overlong slash", value: "%C0%AF" },
  { name: "a surrogate escaped", value: "%ED%A0%80" },
  { name: "two dots", value: ".." },
  { name: "two dots escaped", value: "%2e%2e" },
  { name: "an escaped slash", value: "%2f" },
  { name: "an escaped backslash", value: "%5C" },
  { name: "a double escape", value: "%252e%252e%252f" },
  { name: "a name from the prototype", value: "__proto__" },
  { name: "hasOwnProperty", value: "hasOwnProperty" },
  { name: "undefined", value: "undefined" },
  { name: "NaN", value: "NaN" },
  { name: "unicode", value: encodeURIComponent("ünï-çödé-日本語-🙂") },
  { name: "direction marks", value: encodeURIComponent("‮abc⁦") },
  { name: "a question mark escaped", value: "%3Fx%3D1%23y" },
  { name: "a semicolon", value: "a;b=c" },
  { name: "angle brackets and quotes", value: encodeURIComponent("<b>\"'`${x}") },
  { name: "300 characters", value: "a".repeat(300) },
  { name: "5000 characters", value: "b".repeat(5000) },
  { name: "ten thousand escapes", value: "%41".repeat(10_000) },
];

/** Values of a query parameter, written as they would be on the wire. */
export const QUERY_JUNK: Array<Named<string>> = [
  { name: "empty", value: "" },
  { name: "NUL", value: "%00" },
  { name: "a lone percent sign", value: "%" },
  { name: "half an escape", value: "%E0%A4%A" },
  { name: "a surrogate escaped", value: "%ED%A0%80" },
  { name: "unicode", value: encodeURIComponent("ünï-çödé-日本語-🙂") },
  { name: "direction marks", value: encodeURIComponent("‮abc⁦") },
  { name: "1e999", value: "1e999" },
  { name: "negative zero", value: "-0" },
  { name: "minus one", value: "-1" },
  { name: "NaN", value: "NaN" },
  { name: "2**53", value: String(2 ** 53) },
  { name: "2**53 plus one", value: "9007199254740993" },
  { name: "a hex number", value: "0x10" },
  { name: "a fraction", value: "1.5" },
  { name: "a list", value: "1,2,3" },
  { name: "a name from the prototype", value: "__proto__" },
  { name: "undefined", value: "undefined" },
  { name: "not a URL", value: "nonsense" },
  { name: "a script URL", value: encodeURIComponent("javascript:0") },
  { name: "a file URL", value: encodeURIComponent("file:///nonexistent/file") },
  { name: "a data URL", value: encodeURIComponent("data:text/html,<b>x</b>") },
  { name: "a URL with nothing after the scheme", value: encodeURIComponent("http://") },
  { name: "a URL that stops in a bracket", value: encodeURIComponent("http://[::1") },
  { name: "a URL with a name and a password", value: encodeURIComponent("http://user:secret@127.0.0.1:1/") },
  { name: "a URL with a port past the range", value: encodeURIComponent("http://127.0.0.1:99999/") },
  { name: "a long URL", value: encodeURIComponent(`http://127.0.0.1:1/${"p".repeat(3000)}`) },
  { name: "300 characters", value: "a".repeat(300) },
  { name: "5000 characters", value: "b".repeat(5000) },
  { name: "ten thousand escapes", value: "%41".repeat(10_000) },
];

/** Whole query strings that no page sends, written as they would be on the wire (without the question mark). */
export const QUERY_STRINGS: Array<Named<string>> = [
  { name: "a name given twice", value: "a=1&a=2" },
  { name: "a name given three thousand times", value: Array.from({ length: 3000 }, (_, at) => `a=${at}`).join("&") },
  { name: "names from the prototype", value: "__proto__=1&constructor=2&toString=3&__proto__[x]=4&constructor[prototype][y]=5" },
  { name: "brackets", value: "q[]=1&q[]=2&q[a]=3&q[a][b]=4" },
  { name: "a name of nothing", value: "=&=1&&&" },
  { name: "an escaped NUL as a name", value: "%00=%00" },
  { name: "a broken escape as a name", value: "%E0%A4%A=1&%=2&%zz=3" },
  { name: "a name of five thousand characters", value: `${"n".repeat(5000)}=1` },
  { name: "a plus sign and a semicolon", value: "a=1+2;b=3" },
];

/* ------------------------------ headers ------------------------------ */

export interface HeaderShape {
  name: string;
  headers: Record<string, string>;
}

/** Request headers that a browser would not send. (Each is a legal header: the server has to take what Node's own parser lets through.) */
export function headerShapes(): HeaderShape[] {
  const long = (letter: string) => letter.repeat(5000);
  return [
    { name: "every coding accepted", headers: { "accept-encoding": "gzip, deflate, br, zstd" } },
    { name: "any coding accepted", headers: { "accept-encoding": "*" } },
    { name: "codings with qualities that are nonsense", headers: { "accept-encoding": "identity;q=0, gzip;q=NaN, br;q=-1, deflate;q=1e999, ;q=1" } },
    { name: "a very long list of codings", headers: { "accept-encoding": Array.from({ length: 800 }, () => "gzip").join(", ") } },
    { name: "a cookie with a broken escape", headers: { cookie: "kino_session=%E0%A4%A" } },
    { name: "a cookie of five thousand characters", headers: { cookie: `kino_session=${long("c")}` } },
    { name: "a cookie that is only separators", headers: { cookie: ";;;=;;=;kino_session" } },
    { name: "a cookie given twice", headers: { cookie: "kino_session=a; kino_session=b" } },
    { name: "a cookie of a name only", headers: { cookie: "kino_session" } },
    { name: "an empty authorization", headers: { authorization: "" } },
    { name: "a bearer with nothing after it", headers: { authorization: "Bearer " } },
    { name: "a bearer of five thousand characters", headers: { authorization: `Bearer ${long("t")}` } },
    { name: "a basic authorization that is not base64", headers: { authorization: "Basic !!!" } },
    { name: "a range that is not one", headers: { range: "bytes=abc" } },
    { name: "a range of nothing", headers: { range: "bytes=-0" } },
    { name: "a range past 2**64", headers: { range: "bytes=99999999999999999999-" } },
    { name: "a hundred ranges", headers: { range: `bytes=${Array.from({ length: 100 }, (_, at) => `${at * 2}-${at * 2 + 1}`).join(",")}` } },
    { name: "a range of the wrong unit", headers: { range: "items=0-1" } },
    { name: "a tag list of five thousand characters", headers: { "if-none-match": long("e") } },
    { name: "a tag that stops in a quote", headers: { "if-none-match": 'W/"' } },
    { name: "many stars", headers: { "if-none-match": "*, *, *, W/*" } },
    { name: "a date that is not one", headers: { "if-modified-since": "yesterday-ish" } },
    { name: "a host that stops in a bracket", headers: { host: "[::1" } },
    { name: "a host of three thousand characters", headers: { host: `${"h".repeat(3000)}.test` } },
    { name: "a host with a space", headers: { host: "a b" } },
    { name: "a host in unicode", headers: { host: "♥.test:80" } },
    { name: "a host with a port past the range", headers: { host: "localhost:99999" } },
    { name: "a forwarded list of commas", headers: { "x-forwarded-for": ",,, ,," } },
    { name: "a forwarded address of a mapped kind", headers: { "x-forwarded-for": "::ffff:1.2.3.4, [::1]:80, 999.999.999.999, nonsense" } },
    { name: "a forwarded list of a few hundred addresses", headers: { "x-forwarded-for": Array.from({ length: 400 }, (_, at) => `45.0.${Math.floor(at / 250)}.${at % 250}`).join(", ") } },
    { name: "a forwarded protocol of two values", headers: { "x-forwarded-proto": "https,http" } },
    { name: "a forwarded protocol that is no protocol", headers: { "x-forwarded-proto": "javascript" } },
    { name: "a user agent of five thousand characters", headers: { "user-agent": long("u"), accept: "text/html", "sec-fetch-dest": "document" } },
    { name: "no user agent", headers: { "user-agent": "", accept: "text/html" } },
    { name: "a language list of five thousand characters", headers: { "accept-language": long("l"), accept: "text/html", "user-agent": "Mozilla/5.0 Chrome/150" } },
    { name: "an origin of null", headers: { origin: "null" } },
    { name: "a connection that is nonsense", headers: { connection: "upgrade, close, nonsense", upgrade: "websocket" } },
  ];
}

/* ------------------------------ WebSocket frames ------------------------------ */

export interface FrameShape {
  name: string;
  data: string | Buffer;
  /** Sent as a binary frame (otherwise as text, even when the bytes are no text). */
  binary: boolean;
  /** The code the library itself closes the connection with when it sees this frame (before the server reads it): a frame past the size limit, text that is no UTF-8. */
  closes?: number;
}

/** Frames of every kind a client could put on the socket besides a message that is right. (The size limit of the server is 64 KiB.) */
export function frameShapes(rand: () => number): FrameShape[] {
  const noise = (length: number) => Buffer.from(Array.from({ length }, () => Math.floor(rand() * 256)));
  const ping = JSON.stringify({ type: "PING" });
  return [
    { name: "an empty text frame", data: "", binary: false },
    { name: "an empty binary frame", data: Buffer.alloc(0), binary: true },
    { name: "one byte", data: Buffer.from([0x7b]), binary: true },
    { name: "a message in a binary frame", data: Buffer.from(ping), binary: true },
    { name: "a hundred bytes of noise as binary", data: noise(100), binary: true },
    { name: "a hundred bytes of noise as text", data: noise(100), binary: false, closes: 1007 },
    { name: "text that is no UTF-8", data: Buffer.from([0x7b, 0xc3, 0x28, 0xff, 0x7d]), binary: false, closes: 1007 },
    { name: "text that is NUL", data: "\u0000", binary: false },
    { name: "null", data: "null", binary: false },
    { name: "a string", data: '"PING"', binary: false },
    { name: "a number", data: "1", binary: false },
    { name: "[]", data: "[]", binary: false },
    { name: "{}", data: "{}", binary: false },
    { name: "JSON that stops short", data: '{"type":"PING"', binary: false },
    { name: "two messages in one frame", data: ping + ping, binary: false },
    { name: "a message given twice in one object", data: '{"type":"PING","type":"TV_HELLO"}', binary: false },
    { name: "a byte order mark first", data: `﻿${ping}`, binary: false },
    { name: "a message 120 deep", data: toJson(nested(120, (inner) => ({ type: inner }))), binary: false },
    { name: "an array thirty thousand deep", data: "[".repeat(30_000), binary: false },
    { name: "just under the limit of a frame", data: JSON.stringify({ type: "PING", pad: "p".repeat(64 * 1024 - 40) }), binary: false },
    { name: "just over the limit of a frame", data: JSON.stringify({ type: "PING", pad: "p".repeat(64 * 1024) }), binary: false, closes: 1009 },
    { name: "a binary frame over the limit", data: Buffer.alloc(64 * 1024 + 1, 0x41), binary: true, closes: 1009 },
    { name: "a state with two thousand quality levels", data: JSON.stringify({ type: "TV_STATE", state: { state: "playing", currentTime: 1, duration: 2, quality: { current: 0, levels: Array.from({ length: 1500 }, (_, id) => ({ id, label: "720p" })) } } }), binary: false },
  ];
}
