import { existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  try {
    process.loadEnvFile(file);
  } catch (error) {
    console.warn(`${file} could not be read (${error instanceof Error ? error.message : String(error)}); its settings are not used.`);
  }
}
