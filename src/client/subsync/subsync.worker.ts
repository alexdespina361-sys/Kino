// The aligner's worker: the voice detector and the solves, away from the page that plays the film. See backend.ts.
import type { WorkerReply, WorkerRequest } from "./backend";
import { SyncCore } from "./core";
import type { Cue } from "./cues";
import { Silero, SILERO_WEIGHT_FLOATS } from "./silero";
import type { Word } from "./signals";

const scope = self as unknown as { postMessage(message: WorkerReply): void; onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null };
let core: SyncCore | undefined;

async function handle({ op, args }: WorkerRequest): Promise<unknown> {
  if (op === "init") {
    const response = await fetch(args.weightsUrl as string);
    if (!response.ok) throw new Error(`Weights: HTTP ${response.status}`);
    const weights = new Float32Array(await response.arrayBuffer());
    if (weights.length !== SILERO_WEIGHT_FLOATS) throw new Error("Weights have the wrong size");
    core = new SyncCore(new Silero(weights));
    return true;
  }
  if (!core) throw new Error("Not started");
  switch (op) {
    case "audio": {
      const started = performance.now();
      core.addAudio(args.time as number, args.pcm as Float32Array);
      return performance.now() - started;
    }
    case "words":
      core.addWords(args.words as Word[], args.from as number, args.to as number);
      return undefined;
    case "track":
      core.setTrack(args.key as string, args.cues as Cue[], args.useWords as boolean);
      return undefined;
    case "drop":
      core.dropTrack(args.key as string);
      return undefined;
    case "solve":
      return core.solve(args.key as string, args.end as number);
    case "score":
      return core.score(args.cues as Cue[], args.latest as boolean);
    case "reset":
      core.reset();
      return undefined;
  }
}

scope.onmessage = (event) => {
  const { id } = event.data;
  // (Requests are taken in turn: only "init" waits, and nothing is sent before it has answered.)
  handle(event.data).then(
    (value) => scope.postMessage({ id, value }),
    (error: unknown) => scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }),
  );
};
