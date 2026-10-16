// Run on the candidate relay machine. No credentials or tokens are printed.
// This checks that machine's egress; running it on a PC does not validate a VPS.
const pages = process.argv.slice(2);
if (!pages.length) pages.push(
  'https://filmpire.sc/watch/123542?s=1&e=1',
  'https://filmpire.sc/watch/1399?s=1&e=1',
  'https://filmpire.sc/watch/550',
);
const site = new URL(process.env.KINO_SITE_URL || 'https://kino.24-7.ro');
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const checked = new Set();
let failed = false;

async function request(url, referer, range = false, stage = 'upstream') {
  const headers = { 'user-agent': ua };
  if (referer) headers.referer = referer;
  if (range) headers.range = 'bytes=0-262143';
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${stage}: HTTP ${response.status} from ${new URL(url).hostname}`);
  }
  return response;
}

async function prefix(response, limit) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, limit - size);
      chunks.push(part); size += part.length;
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

async function text(response) {
  const data = await prefix(response, 2 * 1024 * 1024);
  if (data.length >= 2 * 1024 * 1024) throw new Error('Playlist or token exceeded the probe limit');
  return data.toString('utf8').trim();
}

async function probe(raw, referer) {
  const source = new URL(raw);
  let token = await text(await request(new URL('/generate.php', source), referer, false, 'token'));
  try { const parsed = JSON.parse(token); token = parsed.token || parsed.data || token; } catch { /* Plain JWT. */ }
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('No valid provider token');
  const expiry = Number(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp);
  if (!Number.isFinite(expiry) || expiry * 1000 <= Date.now() + 60_000) throw new Error('Provider token expires too soon');
  source.searchParams.set('token', token);
  source.searchParams.set('bypass_localize', 'true');
  let next = source;
  for (let depth = 0; depth < 6; depth++) {
    const playlist = await text(await request(next, referer, false, depth === 0 ? 'master' : 'variant'));
    if (!playlist.startsWith('#EXTM3U')) throw new Error('Upstream did not return an HLS playlist');
    const first = playlist.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#'));
    if (!first) throw new Error('Playlist contains no playable resources');
    const target = new URL(first, next);
    if (playlist.includes('#EXT-X-STREAM-INF:')) { next = target; continue; }
    const response = await request(target, referer, true, 'segment');
    const sample = await prefix(response, 262_144);
    let transportStream = false;
    for (let offset = 0; offset < Math.min(8192, sample.length - 376); offset++) {
      if (sample[offset] === 0x47 && sample[offset + 188] === 0x47 && sample[offset + 376] === 0x47) { transportStream = true; break; }
    }
    const mp4 = ['ftyp', 'styp', 'moof', 'sidx'].includes(sample.toString('ascii', 4, 8));
    const encrypted = /#EXT-X-KEY:.*METHOD=(?!NONE)/.test(playlist);
    if (sample.length < 1024 || (!transportStream && !mp4 && !encrypted)) throw new Error('Segment sample was not recognizable video');
    return { host: source.hostname, segmentHost: target.hostname, status: response.status, sampleBytes: sample.length, format: transportStream ? 'mpeg-ts' : mp4 ? 'fmp4' : 'encrypted', playlists: depth + 1 };
  }
  throw new Error('Too many playlist levels');
}

for (const page of pages) {
  let resolved;
  try {
    const endpoint = new URL('/api/resolve', site); endpoint.searchParams.set('url', page);
    resolved = JSON.parse(await text(await request(endpoint, undefined, false, 'resolver')));
    if (resolved.status !== 'success') throw new Error(`Resolver status: ${resolved.status}`);
    const streams = [resolved.media.stream, ...(resolved.media.alternates || []).map(item => item.stream)];
    for (const stream of streams) {
      const raw = stream.directUrl;
      if (!raw) throw new Error('Resolver returned no direct source');
      const host = new URL(raw).hostname;
      if (checked.has(host)) continue;
      checked.add(host);
      const referer = new URL(stream.url, site).searchParams.get('referer');
      try { console.log(JSON.stringify({ ok: true, title: resolved.media.title, ...await probe(raw, referer) })); }
      catch (error) { failed = true; console.log(JSON.stringify({ ok: false, title: resolved.media.title, host, error: error.message })); }
    }
  } catch (error) {
    failed = true; console.log(JSON.stringify({ ok: false, page, error: error.message }));
  }
}
if (!checked.size) failed = true;
console.log(JSON.stringify({ ok: !failed, hostsChecked: checked.size, note: 'This probes upstream access, not browser playback or sustained capacity.' }));
process.exitCode = failed ? 1 : 0;
