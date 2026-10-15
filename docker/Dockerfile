# syntax=docker/dockerfile:1

# Build: install the workspace, then build the web UI and the server bundle.
FROM node:24-slim AS build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm install -g pnpm@12.10.1
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jobfilly/web build && pnpm --filter @jobfilly/server build
# The bundle already contains the workspace code, so deploy copies only the
# server's own production dependencies (`--legacy`: no injected workspace packages).
RUN pnpm --filter @jobfilly/server deploy --prod --legacy /out

# Run: the server bundle, its production dependencies and the built UI.
FROM node:24-slim
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/apps/web/dist ./web
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 WEB_DIST=/app/web DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "dist/index.js"]
