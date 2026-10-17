# JobFilly — agent guide

This is the single guide for every coding agent (`AGENTS.md` points here). Before changing
anything, read [README.md](README.md) (what JobFilly is) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how the pieces fit).

## Commands

```bash
pnpm install                         # from the repo root, always
pnpm dev                             # server :8787 + UI :5173
pnpm check                           # biome lint + typecheck + vitest — run before every commit
pnpm unused                          # knip: unused files, exports and dependencies
pnpm build                           # web UI and server bundles
pnpm e2e                             # test stack + Playwright specs
docker compose -f docker/compose.yaml up --build
```

Node 24+ (CI uses `.nvmrc`), pnpm 12. Format with `pnpm format` (Biome).

## Hard rules

- **Drafts only.** Nothing is sent without a button press for that message; no bulk send, no
  auto-apply.
- **Unknown means ask.** When the profile can't answer something a reply needs, create a decision
  and hold the reply. Never guess.
- **Nothing changes without the user's say.** The assistant and the model propose; applying is the
  user's separate action.
- **Nothing market- or user-specific in code.** Contract types, pay formats, work permits,
  locations and names come from the user's profile, never from enums, defaults or prompts.
  International standards (ISO country and currency codes, UTC offsets) are fine.
- **Workspace-scoped everything.** Workspace data is read and written only through `packages/db`
  functions that take a workspace id; the server checks membership and role on every workspace
  route (not a member → 404, wrong role → 403).
- **Schemas first.** Data crossing a package boundary, going over HTTP, or coming back from a
  model is defined in `packages/schema` and validated where it enters.
- **All AI calls go through `packages/ai`.** Providers are equals; never hard-wire a vendor.
- **Match % is explainable** and is not an "ATS score". Never invent skills.
- **Secrets** are encrypted at rest with `JOBFILLY_SECRET_KEY`; never returned by the API, never
  logged, never in the repo.
- **Kubernetes-ready:** no state on local disk, config only from the environment, JSON logs on
  stdout, graceful shutdown (see ARCHITECTURE).
- **Tests are hermetic:** no real mailbox, model or network. Fake at the package boundary; the
  database in tests is PGlite.
- **Dependencies:** add them to the package that uses them, from the repo root. The 7-day
  `minimumReleaseAge` in `pnpm-workspace.yaml` stays; install scripts need an `allowBuilds` entry.
- **Docs:** only `README.md`, this file, `AGENTS.md` and `docs/ARCHITECTURE.md`. Update
  ARCHITECTURE when you change a boundary. Don't add other docs; explain details in code comments
  and tests.
- **Commits:** Conventional Commits, `type(scope): subject`; the scope is the package or app name.

## Working in parallel

Each workstream owns one package or app from the table in ARCHITECTURE. Use other packages only
through their exports. If you need a shared schema change, make it in `packages/schema` as its own
small commit first, so the other workstreams can build on it.

## Working with the owner

Ask decisions as selectable options (AskUserQuestion), not as open questions to answer in
writing.
