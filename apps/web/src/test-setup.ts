import { configure } from "@testing-library/react";

// Every web test's findBy* and waitFor wait up to 10 seconds instead of Testing Library's 1: on
// a machine shared with other builds a jsdom render can take longer than a second, and a wait
// that gives up first fails a test that passes on a quiet machine. Vitest's per-test limit (30
// seconds, in the root vitest.config.ts) stays above it, so a wait that never ends still fails
// with Testing Library's message, which names what it was looking for.
configure({ asyncUtilTimeout: 10_000 });

// Tests pin the browser locale, which the app formats pay and dates and reads amounts in, so they
// pass the same on any machine. Enumerable, so a test that stubs navigator with a copy keeps it.
Object.defineProperty(navigator, "language", { value: "en", configurable: true, enumerable: true });
