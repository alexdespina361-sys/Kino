// Writes only model.ts (the posture the mesh was made in) from meshy-rest.mts: the build writes it too, with the mesh; this is for the moment when the numbers of the
// rest are being measured and no mesh is wanted yet (the bones and the mesh builder both read model.ts).
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MESHY_REST } from "./meshy-rest.mts";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/client/cat/render/gl/model.ts");

export const modelFile = (): string =>
  `// Made by scripts/cat/model/build-meshy.mts with cat.mesh: do not edit.\n` +
  `import type { ModelRest } from "./rest";\n\n` +
  `/** The posture the mesh was made in (rest.ts says what each number is). */\n` +
  `export const MODEL: ModelRest = ${JSON.stringify(MESHY_REST)};\n`;

if (process.argv[1]?.endsWith("write-model.mts")) {
  writeFileSync(out, modelFile());
  console.log("wrote", out);
}
