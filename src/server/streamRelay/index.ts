import { buildStreamRelay } from "./app";

const app = buildStreamRelay({ key: process.env.STREAM_RELAY_KEY ?? "" });
const address = await app.listen({ port: Number(process.env.PORT ?? 8789), host: process.env.HOST ?? "0.0.0.0" });
console.log(`Stream relay listening at ${address}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void app.close());
