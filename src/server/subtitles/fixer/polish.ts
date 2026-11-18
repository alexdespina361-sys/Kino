import { spawn } from "node:child_process";

export type Strength = "conservative" | "natural" | "adaptive";

export interface PolishBatch {
  lang: string;
  strength: Strength;
  lines: string[];
  before: string[];
  after: string[];
}

export interface Polisher {
  readonly name: string;
  polish(batch: PolishBatch): Promise<string[]>;
}

export const POLISH_INSTRUCTIONS: Record<Strength, string> = {
  conservative: "Fix spelling, grammar and punctuation only. Keep the wording.",
  natural: "Fix spelling, grammar and punctuation, and make awkward wording read naturally. Keep the meaning.",
  adaptive: "Rewrite unnatural or overly literal translation into natural dialogue. Keep the meaning, negation, names, numbers and intent.",
};

export class CommandPolisher implements Polisher {
  readonly name: string;
  constructor(private readonly command: string) {
    this.name = `command: ${command.split(" ")[0]}`;
  }

  polish(batch: PolishBatch): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, { shell: true, windowsHide: true });
      let out = "";
      let err = "";
      const timer = setTimeout(() => child.kill(), 120_000);
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (err = (err + chunk.toString()).slice(-1000)));
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`exit ${code}: ${err.trim().split("\n").pop() ?? ""}`));
        try {
          const lines = (JSON.parse(out) as { lines?: unknown }).lines;
          if (!Array.isArray(lines) || !lines.every((line) => typeof line === "string")) throw new Error("no lines");
          resolve(lines as string[]);
        } catch (error) {
          reject(new Error(`not {"lines": [...]}: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
      child.stdin.end(JSON.stringify({ instructions: POLISH_INSTRUCTIONS[batch.strength], ...batch }));
    });
  }
}

const NEGATION: Record<string, RegExp> = {
  en: /\b(?:not|no|never|nothing|nobody|none|neither|nor|cannot)\b|n't\b/i,
  ro: /\b(?:nu|n-|niciodată|nicicând|nimic|nimeni|niciun|nicio|nici)\b/i,
};
const strip = (text: string) => text.replace(/<[^>]*>/g, "");

export function checkLine(before: string, after: string, lang: string, strength: Strength): string | undefined {
  const a = strip(before);
  const b = strip(after);
  if (!b.trim()) return "empty";
  if (b.includes("-->")) return "timing arrow";
  if (b.length > a.length * 2 + 20) return "far longer";
  if ((b.match(/\n/g)?.length ?? 0) > 2) return "more than three rows";
  const digits = (text: string) => (text.match(/\d+/g) ?? []).sort().join(",");
  if (digits(a) !== digits(b)) return "numbers changed";
  const negation = NEGATION[lang];
  if (negation && negation.test(a) !== negation.test(b)) return "negation changed";
  const names = (text: string) => new Set(text.match(/(?<![.!?]\s|^|\n|-\s|"|\.\.\.)\b[A-ZĂÂÎȘȚ][a-zăâîșț]{2,}/g) ?? []);
  for (const name of names(a)) if (!b.includes(name)) return `name ${name} lost`;
  if (a.trim().startsWith("-") !== b.trim().startsWith("-")) return "speaker dash changed";
  if (strength === "conservative" && wordsChanged(a, b) > 0.5) return "too much rewritten for conservative";
  return undefined;
}

function wordsChanged(a: string, b: string): number {
  const words = (text: string) => text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  const left = words(a);
  const right = new Set(words(b));
  return left.length === 0 ? 0 : left.filter((word) => !right.has(word)).length / left.length;
}
