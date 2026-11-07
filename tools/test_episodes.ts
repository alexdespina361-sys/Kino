import { filmpireSource } from '../src/server/library/filmpire.ts';

const src = filmpireSource();
try {
  console.log('Testing episodes for season 1:');
  const eps1 = await src.episodes('https://filmpire.sc/watch/95479?s=1&e=1', 1);
  console.log('Season 1 episodes count:', eps1.length);
  if (eps1.length > 0) console.log('Ep 1:', eps1[0]);

  console.log('Testing episodes for season 2:');
  const eps2 = await src.episodes('https://filmpire.sc/watch/95479?s=1&e=1', 2);
  console.log('Season 2 episodes count:', eps2.length);

  console.log('Testing episodes for season 3:');
  const eps3 = await src.episodes('https://filmpire.sc/watch/95479?s=1&e=1', 3);
  console.log('Season 3 episodes count:', eps3.length);
} catch (e) {
  console.error('Error:', e);
}
