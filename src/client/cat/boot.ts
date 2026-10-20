import { catAsk, catOffered, readCatSettings, subscribeCatSettings, wantsCat } from "./settings";

/**
 * Starts the cat on a screen that wants one, and takes it away again when that is turned off. Nothing of the cat is downloaded before this says
 * so: a screen that never asked for one only ever runs these few lines. Only the screen that plays (the TV, or a computer's browser) has a cat so far.
 */
export function bootCat(role: "tv" | "remote"): void {
  if (role !== "tv" || typeof window === "undefined") return;
  let running: { stop: () => void } | undefined;
  let latest = 0;
  const sync = async (): Promise<void> => {
    const mine = ++latest;
    if (!wantsCat(readCatSettings(), catAsk())) {
      running?.stop();
      running = undefined;
      return;
    }
    if (running || !(await catOffered()) || mine !== latest || running) return;
    let host: typeof import("./host");
    try {
      host = await import("./host");
    } catch {
      return; // (the file did not come: a page without a cat is a whole page)
    }
    if (mine !== latest || running) return;
    try {
      running = host.mountCat();
    } catch (error) {
      console.warn("[kino] the cat could not start", error);
    }
  };
  void sync();
  subscribeCatSettings(() => void sync());
}
