import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isOfficialLang } from "../../../shared";
import { fixSubtitle, sha256, type FixOptions, type FixReport } from "./fix";
import { decodeSubtitle, formatOf, readSubtitle, writeSubtitle } from "./formats";
import { CommandPolisher, type Strength } from "./polish";
import { sileroVad, soundOf } from "./sync";

const HELP = `Usage: node scripts/subfix.mjs <subtitle file> --lang en|ro [options]

  --out <folder>           where to write (default: next to the file)
  --format srt|vtt         what to write (default: srt, or vtt for a .vtt file)
  --audio <film or sound>  time the lines to it with the screens' aligner (ffmpeg reads it)
  --seconv [program]       also run Subtitle Edit's fixes (seconv: this path, else SECONV, else on the PATH)
  --polish-command "<cmd>" better wording by a model behind this command (JSON in, {"lines": [...]} out)
  --strength conservative|natural|adaptive   how much the model may reword (default: conservative)
  --again                  make a new version even if this file was done the same way before

Writes <name>.original.<ext> (once), <name>.kino-v<N>.<format> and <name>.kino-v<N>.report.json. Nothing is written over.`;

function parse(argv: string[]): { file?: string; flags: Map<string, string | true> } {
  const flags = new Map<string, string | true>();
  let file: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      file ??= arg;
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    const takes = ["lang", "out", "format", "audio", "polish-command", "strength"].includes(name) || (name === "seconv" && next !== undefined && !next.startsWith("--") && /seconv/i.test(next));
    if (takes && next !== undefined) {
      flags.set(name, next);
      i++;
    } else flags.set(name, true);
  }
  return { ...(file ? { file } : {}), flags };
}

async function main(): Promise<number> {
  const { file, flags } = parse(process.argv.slice(2));
  const lang = flags.get("lang");
  if (!file || flags.has("help") || typeof lang !== "string" || !isOfficialLang(lang)) {
    console.log(HELP);
    return file && !flags.has("help") ? 2 : 0;
  }
  const strength = (flags.get("strength") ?? "conservative") as Strength;
  if (!["conservative", "natural", "adaptive"].includes(strength)) throw new Error(`--strength: ${String(strength)}`);
  const text = decodeSubtitle(await readFile(file), lang);
  const source = readSubtitle(text, formatOf(text, file));
  if (source.length === 0) throw new Error(`${file}: no subtitle lines read`);
  const ext = path.extname(file);
  const stem = path.basename(file, ext);
  const out = typeof flags.get("out") === "string" ? (flags.get("out") as string) : path.dirname(file);
  const format = flags.get("format") === "vtt" || (!flags.has("format") && ext.toLowerCase() === ".vtt") ? "vtt" : "srt";
  await mkdir(out, { recursive: true });

  const options: FixOptions = { lang, log: (line) => console.log(`  ${line}`) };
  const seconv = flags.get("seconv");
  if (seconv) options.seconv = seconv;
  const audio = flags.get("audio");
  if (typeof audio === "string") options.sound = { pieces: soundOf(audio), vad: await sileroVad() };
  const command = flags.get("polish-command");
  if (typeof command === "string") options.polish = { polisher: new CommandPolisher(command), strength };
  const asked = { audio: typeof audio === "string", seconv: Boolean(seconv), polish: typeof command === "string" ? strength : false };

  const names = await readdir(out);
  const versions = names.map((name) => new RegExp(`^${escape(stem)}\\.kino-v(\\d+)\\.report\\.json$`).exec(name)).filter((m): m is RegExpExecArray => m !== null);
  for (const match of versions) {
    const previous = JSON.parse(await readFile(path.join(out, match[0]), "utf8")) as FixReport & { asked?: unknown };
    if (!flags.has("again") && previous.source === sha256(text) && JSON.stringify(previous.asked) === JSON.stringify(asked)) {
      console.log(`Already done the same way: ${path.join(out, match[0])} (--again to make a new version).`);
      return 0;
    }
  }
  const version = versions.reduce((most, m) => Math.max(most, Number(m[1])), 0) + 1;

  console.log(`${path.basename(file)}: ${source.length} lines (${lang})`);
  const { cues, report } = await fixSubtitle(source, text, options);
  const original = path.join(out, `${stem}.original${ext}`);
  if (!names.includes(path.basename(original))) await copyFile(file, original);
  const target = path.join(out, `${stem}.kino-v${version}.${format}`);
  await writeFile(target, writeSubtitle(cues, format, format === "vtt" ? `Kino subtitle fixer ${report.fixer}` : undefined), { encoding: "utf8", flag: "wx" });
  await writeFile(path.join(out, `${stem}.kino-v${version}.report.json`), `${JSON.stringify({ ...report, asked }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  const by = (step: string) => report.changes.filter((change) => change.by.includes(step)).length;
  console.log(`  left out ${report.dropped.length}, changed ${report.changes.length} (tidy ${by("tidy")}, subtitle-edit ${by("subtitle-edit")}, aligner ${by("aligner")}, polish ${by("polish")})`);
  for (const step of report.steps.filter((s) => !s.done)) console.log(`  NOT DONE ${step.step}: ${step.note}`);
  console.log(`Wrote ${target}`);
  return 0;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
