# syntax=docker/dockerfile:1

# Build: install the app's workspace packages, then build the web UI and the server bundle.
FROM node:24-slim AS build
RUN npm install -g pnpm@12.10.1
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@jobfilly/server..." --filter "@jobfilly/web..."
RUN pnpm --filter @jobfilly/web build && pnpm --filter @jobfilly/server build
# The bundle already contains the workspace code and ships the migrations in dist/migrations, so
# deploy copies only the server's own production dependencies (`--legacy`: no injected workspace
# packages).
RUN pnpm --filter @jobfilly/server deploy --prod --legacy /out

# Run: the server bundle with its migrations, its production dependencies and the built UI.
# Stateless: everything lives in PostgreSQL. It runs as a non-root user and needs no writable
# path but /tmp, so it works with a read-only root filesystem. It listens on $PORT.
FROM node:24-slim
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/apps/web/dist ./web
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 WEB_DIST=/app/web
EXPOSE 8787
USER node
# `node dist/index.js migrate` applies the migrations alone (a migration job).
CMD ["node", "dist/index.js"]
