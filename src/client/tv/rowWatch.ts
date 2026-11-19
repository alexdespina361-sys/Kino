type Seen = (on: boolean) => void;
interface Watcher {
  io: IntersectionObserver;
  calls: Map<Element, Seen>;
}

const byRoot = new WeakMap<Element | Document, Map<string, Watcher>>();

export function watchSeen(target: Element, root: Element | null, margin: string, seen: Seen): () => void {
  const key = root ?? document;
  let watchers = byRoot.get(key);
  if (!watchers) byRoot.set(key, (watchers = new Map()));
  let watcher = watchers.get(margin);
  if (!watcher) {
    const calls = new Map<Element, Seen>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) calls.get(entry.target)?.(entry.isIntersecting);
      },
      { root, rootMargin: margin },
    );
    watchers.set(margin, (watcher = { io, calls }));
  }
  const { io, calls } = watcher;
  calls.set(target, seen);
  io.observe(target);
  return () => {
    io.unobserve(target);
    calls.delete(target);
  };
}
