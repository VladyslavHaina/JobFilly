import { startServer } from "./node";

function port(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535, got "${value}"`);
  }
  return parsed;
}

const server = await startServer({
  hostname: process.env.HOST ?? "127.0.0.1",
  port: port(process.env.PORT, 8787),
  version: process.env.JOBFILLY_VERSION ?? "0.0.0-dev",
  webDist: process.env.WEB_DIST,
});
console.log(`JobFilly server listening on ${server.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
