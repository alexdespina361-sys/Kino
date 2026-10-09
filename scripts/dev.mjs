// `pnpm dev`: Fastify (auto-restart) + Vite dev server, one terminal. No extra dependency.
import { spawn } from "node:child_process";

const run = (name, args) =>
  spawn("pnpm", ["exec", ...args], { stdio: "inherit", shell: true }).on("exit", (code) => {
    console.log(`[dev] ${name} exited (${code})`);
    process.exit(code ?? 1);
  });

run("server", ["tsx", "watch", "src/server/index.ts"]);
run("vite", ["vite"]);
console.log("[dev] phone: http://localhost:5173   tv: http://localhost:5173/tv");
