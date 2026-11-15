// The subtitle fixer: node scripts/subfix.mjs <subtitle file> --lang en|ro [--audio film.mkv] [--seconv] [...]  (docs/subtitle-fixer.md)
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const result = spawnSync(process.execPath, [tsx, path.join(root, "src/server/subtitles/fixer/cli.ts"), ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 1);
