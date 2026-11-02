/**
 * Puts `value` in `map` as the newest entry, and lets the oldest go while there are more than `max`. (A `Map` keeps the order things were added in; an
 * entry that is set again is moved to the end.) For what is kept by a name that came from somewhere else: left alone it only grows.
 */
export function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  for (const oldest of map.keys()) {
    if (map.size <= max) break;
    map.delete(oldest);
  }
}
