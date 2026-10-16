# syntax=docker/dockerfile:1

# The test stack's own services, seed, fake-ai and rdap (docker/compose.e2e.yaml): e2e/ and its
# production dependencies only, never app or package code. Node runs the TypeScript entry points
# directly (type stripping), so there is no build step. Build context: the repository root.

FROM node:24-slim AS deps
RUN npm install -g pnpm@12.10.1
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY e2e ./e2e
RUN pnpm install --frozen-lockfile --prod --filter @jobfilly/e2e
# deploy copies e2e with a plain node_modules of its own dependencies (`--legacy`: no injected
# workspace packages; e2e has none).
RUN pnpm --filter @jobfilly/e2e deploy --prod --legacy /out

FROM node:24-slim
WORKDIR /repo
COPY --from=deps /out ./e2e
USER node
# Each service sets its command: `node e2e/seed/main.ts …`, `node e2e/fake-ai/main.ts` or
# `node e2e/rdap/main.ts`.
