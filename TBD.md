# TBD — for the owner to review

The build runs unattended and never stops to ask. Every important decision it makes on its own,
and everything it could not finish, is recorded here. Nothing in this file changes the spec: the
owner goes through the entries, then the spec or the code is updated, or the entry is accepted as
it is.

Only the build workflow's record step adds entries (agents working in parallel report them, one
agent writes them), so the numbering stays continuous. Entries are never deleted; the owner sets
their status.

## Entry format

```
## TBD-<n> · <title>
- **Kind:** decision | open item
- **Where:** MVP <n> · <phase> (<slice or scenario>)
- **Context:** what came up
- **Options:** the alternatives considered
- **Chosen:** what the build did, and why
- **If you decide otherwise:** what would change
- **Refs:** criteria, files, commits, run folders
- **Status:** open | accepted | changed
```

## Needed from the owner

These make sign-off possible; without them the build goes on and records an open item.

- **Real-AI quality runs (every MVP):** set `JOBFILLY_E2E_AI_PROVIDER` (`anthropic`, `openai`,
  `google` or `openai-compatible`) and `JOBFILLY_E2E_AI_KEY`, optionally `JOBFILLY_E2E_AI_BASE_URL`
  and `JOBFILLY_E2E_AI_MODEL`, in the environment the session runs in.
- **MVP 3, F3.3:** an Outlook.com test account for the one run with real Microsoft sign-in.
- **Helm chart, H5:** the name of your local cluster's kube context in
  `JOBFILLY_E2E_KUBE_CONTEXT`. The build never uses the current context or any other one.

## Entries

(none yet)
