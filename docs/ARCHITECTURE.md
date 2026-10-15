# Architecture

One TypeScript codebase. The same server runs in three ways:

- **Development:** `pnpm dev` runs the server and the Vite dev server; Vite forwards `/api` to the
  server.
- **Desktop:** Electron starts the server inside the app on a free loopback port and opens a
  window on it.
- **Docker:** the server serves both the API and the built UI from one container.

The UI only ever talks to the server over HTTP, from the same origin, so it behaves the same in
all three.

## Packages

| Path | Owns | May import |
| --- | --- | --- |
| `packages/schema` | Zod schemas: every API payload, every AI structured output, the profile format | — |
| `packages/core` | Intake decisions, profiles, decision inbox, rules, scoring. Pure logic, no I/O | schema |
| `packages/db` | SQLite (libSQL) through Drizzle: tables, migrations, queries | schema |
| `packages/mail` | IMAP sync (imapflow), parsing (mailparser), building drafts (nodemailer) | schema |
| `packages/ai` | Provider registry (AI SDK), per-task model choice, prompts, structured extraction | schema |
| `apps/server` | HTTP API (Hono), authentication, background jobs, live updates | all packages |
| `apps/web` | React UI (Vite, Tailwind, TanStack Query, React Router) | schema; server types only |
| `apps/desktop` | Electron shell: runs the server, the window, tray, OS keychain | server |

Rules:

- Packages never import apps, and `packages/core` never does I/O: it takes data and returns
  decisions, so it can be tested without mail, a database or a model.
- Anything that crosses a package boundary, goes over HTTP, or comes back from a model has a
  schema in `packages/schema`, and is validated at that boundary.
- Workspace packages ship as TypeScript source. The server and desktop builds bundle all
  JavaScript; native modules stay external and must be listed in that app's own dependencies.

## Data

- One SQLite file in the data directory: the OS app-data folder on desktop, the `/data` volume in
  Docker.
- The mailbox is the source of truth for mail. The database holds an index of message metadata
  plus local state — profiles, decisions, rules, drafts in progress, the tracker — which must
  survive any re-sync. Full message bodies are fetched when needed, not stored.

## AI

- Every model call goes through `packages/ai`. The user picks a provider; each task (sorting,
  extraction, matching, drafting, embeddings) can use its own model, and embeddings can come
  from a different provider than text.
- Structured output is validated against its schema. Output that doesn't validate is rejected,
  never patched up.
- Mail content sent to a model is marked as untrusted input, so instructions inside an email
  cannot steer the app.

## Security

- Secrets (mail passwords, OAuth tokens, API keys) never sit in the database or a config file in
  plain text. Desktop uses the OS keychain (Electron `safeStorage`); Docker uses a key from an
  environment variable or a Docker secret.
- The API will require authentication in every mode: the desktop app hands its window a
  per-launch token, and Docker uses a login session. Until that lands, Docker binds to loopback
  only.
- Email HTML is rendered in a sandboxed iframe with a strict content-security policy: no scripts,
  and no remote content unless the user allows it.
- There is no bulk send. Sending is one request per message, made after the user pressed send.

## Testing

Vitest everywhere. `pnpm check` runs lint, typecheck and tests. Tests are hermetic: no real
mailbox, no real model, no network; use fakes at the package boundary.
