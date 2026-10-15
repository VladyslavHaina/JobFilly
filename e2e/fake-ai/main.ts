import type { AddressInfo } from "node:net";
import { fixturesDir } from "../fixtures/format.ts";
import { loadAnswers } from "./answers.ts";
import { createFakeAi } from "./server.ts";

// The fake AI of the test stack: node e2e/fake-ai/main.ts
//   PORT                  listen port (8080; 0 takes any free port)
//   FIXTURES_DIR          the fixtures (e2e/fixtures)
//   FAKE_AI_DELAY_MS      wait before every answer (0; the test stack sets 300)
//   FAKE_AI_SLOW_TEST_MS  extra wait on ai.test.v1 only (0)

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    console.error(
      JSON.stringify({
        level: "fatal",
        event: "fake_ai.config",
        reason: `${name} must be a whole number`,
      }),
    );
    process.exit(1);
  }
  return value;
}

const log = (line: Record<string, unknown>) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), ...line }));

const port = number("PORT", 8080);
const dir = fixturesDir();
const server = createFakeAi({
  store: loadAnswers(dir),
  delayMs: number("FAKE_AI_DELAY_MS", 0),
  slowTestMs: number("FAKE_AI_SLOW_TEST_MS", 0),
  log,
});
// The port actually bound, so PORT=0 (any free port) can be found from the log.
server.listen(port, "0.0.0.0", () =>
  log({
    level: "info",
    event: "fake_ai.ready",
    port: (server.address() as AddressInfo).port,
    fixturesDir: dir,
  }),
);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log({ level: "info", event: "fake_ai.stopping", signal });
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
