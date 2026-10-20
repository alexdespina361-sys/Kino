// Bundles a TypeScript entry for the browser (one script, its exports on `window.<name>`), with Vite's own build, so the cat's lab and
// recordings run the very source the app is built from. Returns the code as a string; nothing is written to disk.
import { build } from "vite";

export async function bundle(entry, name) {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: { entry, name, formats: ["iife"], fileName: "bundle" },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  for (const one of outputs) {
    for (const chunk of one.output) if (chunk.type === "chunk") return chunk.code;
  }
  throw new Error("the bundle made nothing");
}
