# JobFilly — agent guide

This is the single guide for every coding agent (`AGENTS.md` points here). Before changing
anything, read [docs/NORTH_STAR.md](docs/NORTH_STAR.md) (what we're building) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how the pieces fit).

## Commands

```bash
pnpm install                         # from the repo root, always
pnpm dev                             # server :8787 + UI :5173
pnpm check                           # biome lint + typecheck + vitest — run before every commit
pnpm build                           # all bundles
pnpm --filter @jobfilly/desktop dev  # Electron
JOBFILLY_DESKTOP_SMOKE=1 pnpm --filter @jobfilly/desktop start   # after pnpm build: desktop check, no window
docker compose -f docker/compose.yaml up --build
```

Node 24+ (CI uses `.nvmrc`), pnpm 12. Format with `pnpm format` (Biome).

## Hard rules

- **Drafts only.** Nothing is sent without a button press for that message; no bulk send, no
  auto-apply.
- **Unknown means ask.** When the profile can't answer something a message needs, create a
  decision for the user and hold the reply. Never guess.
- **Nothing market- or user-specific in code.** Contract types, pay formats, work permits,
  locations and names come from the user's profile, never from enums, defaults or prompts.
- **Schemas first.** Data crossing a package boundary, going over HTTP, or coming back from a
  model is defined in `packages/schema` and validated where it enters.
- **All AI calls go through `packages/ai`.** Providers are equals; never hard-wire a vendor.
- **Match % is explainable** and is not an "ATS score". Never invent skills.
- **Secrets** go to the OS keychain (desktop) or an encrypted store keyed from the environment
  (Docker). Never in the database, a config file, logs or the repo.
- **Tests are hermetic:** no real mailbox, model or network. Fake at the package boundary.
- **Dependencies:** add them to the package that uses them, from the repo root. The 7-day
  `minimumReleaseAge` in `pnpm-workspace.yaml` stays; install scripts need an `allowBuilds`
  entry.
- **Docs:** only `README.md`, this file, `AGENTS.md`, `docs/NORTH_STAR.md` and
  `docs/ARCHITECTURE.md`. Update ARCHITECTURE when you change a boundary. Don't add other docs;
  explain details in code comments and tests.
- **Commits:** Conventional Commits, `type(scope): subject`; the scope is the package or app name.

## Working in parallel

Each workstream owns one package or app from the table in ARCHITECTURE. Use other packages only
through their exports. If you need a shared schema change, make it in `packages/schema` as its
own small commit first, so the other workstreams can build on it.

## Working with the owner

Ask decisions as selectable options (AskUserQuestion), not as open questions to answer in
writing.
