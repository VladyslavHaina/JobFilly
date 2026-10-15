export const meta = {
  name: 'build-mvp',
  description:
    'Build one JobFilly MVP unattended: plan, foundation, parallel verified slices, integration, human-like E2E validation with logs, fix rounds, evidence audit, clean-up, sign-off. Never stops to ask; decisions go to TBD.md.',
  whenToUse:
    'Unattended build of one MVP from docs/mvp. Args: {"mvp": 1|2|3}; optional "maxFixRounds" (default 4), "from" ("plan" default, or "validate" to skip planning work and building), "push" (default false: never push).',
  phases: [
    { title: 'Preflight', detail: 'MVP branch, clean tree, previous MVP done, green baseline, tools' },
    { title: 'Plan', detail: 'slices with disjoint paths, every criterion assigned once, critic pass' },
    { title: 'Foundation', detail: 'shared contract and serial-first work, independently verified' },
    { title: 'Build', detail: 'slices in parallel worktrees, each verified through two lenses' },
    { title: 'Integrate', detail: 'merge verified work; check, build, unused' },
    { title: 'Validate', detail: 'fresh stack, Playwright MCP walkthrough, logs, leaks, probes' },
    { title: 'Fix', detail: 'triage, parallel fixes in worktrees, verification' },
    { title: 'Codify', detail: 'passed scenarios become Playwright specs' },
    { title: 'Confirm', detail: 'spec-only clean run, real-AI quality run, evidence audit' },
    { title: 'Record', detail: 'decisions and open items appended to TBD.md' },
    { title: 'Clean up', detail: 'unused code and dependencies, branches, worktrees, stacks, old reports' },
    { title: 'Sign-off', detail: 'status row in the sign-off table and the run summary' },
  ],
}

const MVP = Number(args && args.mvp)
if (![1, 2, 3].includes(MVP)) throw new Error('args.mvp must be 1, 2 or 3')
const MAX_FIX_ROUNDS = Number((args && args.maxFixRounds) || 4)
const FROM = (args && args.from) || 'plan'
const PUSH = Boolean(args && args.push)
const BRANCH = `mvp-${MVP}`
const DOC = `docs/mvp/MVP-${MVP}.md`

const CONTEXT = [
  `You are one agent in the unattended workflow that builds MVP ${MVP} of JobFilly.`,
  `Spec: ${DOC}. Build rules and the validation protocol: docs/mvp/README.md. Structure: docs/ARCHITECTURE.md.`,
  'The owner is away: never stop to ask and never wait for input. When an important decision comes up (an unclear, contradictory or impossible criterion; a choice users would notice; a hard-to-reverse data, architecture, dependency or security choice), choose what best serves the criterion and docs/NORTH_STAR.md, carry on, and report it under "decisions" in your result. Small implementation choices are not decisions.',
  'Never edit acceptance criteria or other spec text. Never delete or skip a failing test to get green. Never claim a check you did not run.',
  'Keep the tree clean: commit only source, tests, fixtures, config and the allowed docs; delete whatever your change made unnecessary; leave no stray files behind.',
].join('\n')

// ---------- schemas ----------
// The owner asked for every agent to run at high effort, never low or max.
const run = (prompt, opts) => agent(prompt, { ...opts, effort: 'high' })

const STR = { type: 'string' }
const BOOL = { type: 'boolean' }
const STRS = { type: 'array', items: STR }
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties) })
const DECISIONS = {
  type: 'array',
  items: obj({
    title: STR,
    context: STR,
    options: STRS,
    chosen: STR,
    why: STR,
    ifOtherwise: STR,
    refs: STR,
  }),
}
const CHECKS = { type: 'array', items: obj({ id: STR, pass: BOOL, evidence: STR }) }
const PREFLIGHT = obj({
  ok: BOOL,
  alreadyDone: BOOL,
  canValidate: BOOL,
  realAiAvailable: BOOL,
  baseCommit: STR,
  problems: STRS,
  decisions: DECISIONS,
})
const PLAN = obj({
  criteria: STRS,
  scenarios: { type: 'array', items: obj({ id: STR, title: STR }) },
  foundation: obj({ summary: STR, criteria: STRS, ownedPaths: STRS, hotspots: STRS }),
  slices: {
    type: 'array',
    items: obj({
      id: STR,
      title: STR,
      criteria: STRS,
      ownedPaths: STRS,
      dependsOn: STRS,
      testPlan: STR,
    }),
  },
  decisions: DECISIONS,
})
const CRITIQUE = obj({ ok: BOOL, problems: STRS })
const WORK = obj({
  branch: STR,
  commits: STRS,
  criteriaDone: STRS,
  notDone: STRS,
  outsideChanges: STRS,
  summary: STR,
  decisions: DECISIONS,
})
const VERDICT = obj({
  pass: BOOL,
  failures: {
    type: 'array',
    items: obj({
      kind: { type: 'string', enum: ['criterion', 'test', 'rule', 'hygiene', 'scope'] },
      ref: STR,
      problem: STR,
      evidence: STR,
      fix: STR,
    }),
  },
})
const MERGE = obj({
  merged: STRS,
  notMerged: { type: 'array', items: obj({ branch: STR, reason: STR }) },
  green: BOOL,
  notes: STR,
  decisions: DECISIONS,
})
const STACK = obj({ ok: BOOL, runDir: STR, project: STR, specFailures: STRS, notes: STR })
const WALK = obj({
  id: STR,
  pass: BOOL,
  criteria: CHECKS,
  missingEvents: STRS,
  errorLogs: STRS,
  findings: {
    type: 'array',
    items: obj({
      severity: { type: 'string', enum: ['blocker', 'important', 'minor'] },
      description: STR,
      step: STR,
    }),
  },
  decisions: DECISIONS,
})
const CLOSE = obj({
  leaks: STRS,
  probes: CHECKS,
  criteria: CHECKS,
  bothReplicasServed: BOOL,
  stackRemoved: BOOL,
  reportPath: STR,
})
const TRIAGE = obj({
  tasks: {
    type: 'array',
    items: obj({ id: STR, title: STR, items: STRS, ownedPaths: STRS, continueBranch: STR }),
  },
  decisions: DECISIONS,
})
const QUALITY = obj({
  ran: BOOL,
  pass: BOOL,
  results: { type: 'array', items: obj({ threshold: STR, measured: STR, pass: BOOL }) },
  notes: STR,
})
const AUDIT = obj({ refuted: { type: 'array', items: obj({ ref: STR, why: STR }) } })
const CLEAN = obj({ clean: BOOL, removed: STRS, remaining: STRS, decisions: DECISIONS })
const SIGN = obj({ commit: STR, notes: STR })

// ---------- helpers ----------
const bullet = (xs) => (xs && xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- (none)')
const failureText = (fs) =>
  fs.map((f) => `[${f.kind}] ${f.ref}: ${f.problem} (evidence: ${f.evidence}; fix: ${f.fix})`)
const norm = (p) => p.replace(/(\/\*\*)?(\/\*)?$/, '').replace(/\/$/, '')
const overlaps = (a, b) => {
  const x = norm(a)
  const y = norm(b)
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
}

// Decisions and open items collected from every agent; one serial agent writes them to TBD.md.
const pending = []
function take(result, where) {
  if (result && Array.isArray(result.decisions)) {
    for (const d of result.decisions) pending.push({ kind: 'decision', where, ...d })
  }
  return result
}
function openItem(title, context, where) {
  return { kind: 'open item', where, title, context, options: [], chosen: '', why: '', ifOtherwise: '', refs: '' }
}
async function record(label) {
  if (!pending.length) return
  const batch = pending.splice(0, pending.length)
  await run(
    `${CONTEXT}\n\nAppend these ${batch.length} entries to TBD.md in the main checkout on branch ${BRANCH}, as new numbered entries in the format the file describes (continue its numbering; status "open"). Change nothing else. Commit with "docs(tbd): record ${batch.length} entr${batch.length === 1 ? 'y' : 'ies'} from ${label}".\n\n${JSON.stringify(batch, null, 2)}`,
    { label: `record:${label}`, phase: 'Record' },
  )
}

function planProblems(p) {
  const problems = []
  const counts = {}
  for (const c of p.foundation.criteria.concat(...p.slices.map((s) => s.criteria))) {
    counts[c] = (counts[c] || 0) + 1
  }
  for (const c of p.criteria) if (!counts[c]) problems.push(`criterion ${c} is not assigned`)
  for (const c of Object.keys(counts)) {
    if (counts[c] > 1) problems.push(`criterion ${c} is assigned ${counts[c]} times`)
    if (!p.criteria.includes(c)) problems.push(`criterion ${c} is not in ${DOC}`)
  }
  const ids = p.slices.map((s) => s.id)
  ids.forEach((id, i) => {
    if (ids.indexOf(id) !== i) problems.push(`slice id ${id} is used twice`)
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) problems.push(`slice id "${id}" is not kebab-case`)
  })
  for (const s of p.slices) {
    for (const d of s.dependsOn) if (!ids.includes(d)) problems.push(`slice ${s.id} depends on unknown slice ${d}`)
  }
  for (let i = 0; i < p.slices.length; i++) {
    for (let j = i + 1; j < p.slices.length; j++) {
      for (const a of p.slices[i].ownedPaths) {
        for (const b of p.slices[j].ownedPaths) {
          if (overlaps(a, b)) problems.push(`slices ${p.slices[i].id} and ${p.slices[j].id} both own ${a} / ${b}`)
        }
      }
    }
  }
  if (p.slices.length > 6) problems.push(`${p.slices.length} slices; keep it to 6 or fewer`)
  if (!p.scenarios.length) problems.push(`no scenarios were read from ${DOC}`)
  if (!levels(p.slices)) problems.push('the slice dependencies contain a cycle')
  return problems
}

function levels(slices) {
  const done = new Set()
  const out = []
  let rest = slices.slice()
  while (rest.length) {
    const ready = rest.filter((s) => s.dependsOn.every((d) => done.has(d)))
    if (!ready.length) return null
    out.push(ready)
    for (const s of ready) done.add(s.id)
    rest = rest.filter((s) => !ready.includes(s))
  }
  return out
}

async function verify(what, ref, base, checklist, phaseName) {
  const lenses = [
    [
      'criteria',
      `Lens: acceptance criteria and tests. For each item below decide, from the code and by running the tests, whether it is really met. A test only counts if it would fail without the code it covers. Items:\n${bullet(checklist)}`,
    ],
    [
      'rules',
      'Lens: architecture and hygiene. Check the change against the hard rules in CLAUDE.md and docs/ARCHITECTURE.md: workspace-scoped data access, schemas at every boundary, nothing market- or user-specific in code, secrets never logged or returned, AI only through packages/ai, Kubernetes readiness, no leftover or generated files, no dead or commented-out code, no TODOs or debug output, no unused dependencies, no edits outside the owned paths without a reason.',
    ],
  ]
  const verdicts = await parallel(
    lenses.map(
      ([key, lens]) =>
        () =>
          run(
            `${CONTEXT}\n\nYou are an independent verifier: you did not write this work, and your job is to refute that ${what} is done. In your worktree run "git checkout --detach ${ref}", then "pnpm install" and "pnpm check", and read "git diff ${base}...${ref}". Do not edit or commit anything and do not start the Docker test stack.\n\n${lens}\n\nWhen unsure, fail it. Every failure needs file:line evidence and the fix.`,
            { label: `verify-${key}:${what}`, phase: phaseName, schema: VERDICT, isolation: 'worktree' },
          ),
    ),
  )
  const got = verdicts.filter(Boolean)
  return {
    pass: got.length === lenses.length && got.every((v) => v.pass),
    failures: got.flatMap((v) => v.failures),
  }
}

async function buildSlice(slice) {
  const branch = `${BRANCH}-${slice.id}`
  const where = `MVP ${MVP} · Build (${slice.id})`
  const work = take(
    await run(
      `${CONTEXT}\n\nBuild slice "${slice.id}": ${slice.title}.\nCriteria: ${slice.criteria.join(', ')}\nOwned paths (edit only these; justify anything else under outsideChanges):\n${bullet(slice.ownedPaths)}\nTest plan: ${slice.testPlan}\n\nYou are in a fresh git worktree. If branch "${branch}" exists, "git checkout ${branch}" and continue it; otherwise "git checkout -b ${branch} ${BRANCH}". Implement the criteria with tests that would fail without your code. Tests are hermetic (PGlite, fakes): never start the Docker test stack. Run "pnpm install" and "pnpm check" until green and commit in small Conventional Commits on ${branch}. Finish with "git checkout --detach" so the branch is free for the verifiers. List anything you could not finish under notDone.`,
      { label: `build:${slice.id}`, phase: 'Build', schema: WORK, isolation: 'worktree' },
    ),
    where,
  )
  if (!work) return { id: slice.id, branch, verified: false, failures: [`the builder for ${slice.id} returned nothing`] }
  let v = await verify(
    `slice ${slice.id}`,
    branch,
    BRANCH,
    slice.criteria.concat(work.notDone.map((n) => `reported not done: ${n}`)),
    'Build',
  )
  for (let round = 1; !v.pass && round <= 2; round++) {
    take(
      await run(
        `${CONTEXT}\n\nFix slice "${slice.id}". In your fresh worktree run "git checkout ${branch}". Fix exactly these verifier findings and keep everything else, run "pnpm install" and "pnpm check", commit on ${branch}, and finish with "git checkout --detach":\n${bullet(failureText(v.failures))}`,
        { label: `fix:${slice.id}:${round}`, phase: 'Build', schema: WORK, isolation: 'worktree' },
      ),
      where,
    )
    v = await verify(`slice ${slice.id}`, branch, BRANCH, slice.criteria, 'Build')
  }
  return { id: slice.id, branch, verified: v.pass, failures: failureText(v.failures) }
}

async function integrate(branches, label) {
  if (!branches.length) return null
  return take(
    await run(
      `${CONTEXT}\n\nIntegrate into ${BRANCH} in the main checkout ("git checkout ${BRANCH}"). Merge these branches one at a time with "git merge --no-ff", in this order:\n${bullet(branches)}\nResolve conflicts by keeping the intent of both sides; the shared registration points come from the foundation. Then run "pnpm install", "pnpm check", "pnpm build" and "pnpm unused", fix only integration problems, and commit. Delete each merged branch ("git branch -d") and run "git worktree prune". Do not start the Docker test stack.`,
      { label: `integrate:${label}`, phase: 'Integrate', schema: MERGE },
    ),
    `MVP ${MVP} · Integrate (${label})`,
  )
}

function assess(stack, walks, close, criteria, mode) {
  const failing = []
  const minor = []
  if (!stack || !stack.ok) failing.push(`the test stack did not start: ${stack ? stack.notes : 'no result'}`)
  if (stack) for (const f of stack.specFailures) failing.push(`spec failed: ${f}`)
  const passed = new Set()
  for (const w of walks) {
    if (!w.pass) failing.push(`scenario ${w.id} failed`)
    for (const c of w.criteria) {
      if (c.pass) passed.add(c.id)
      else failing.push(`${c.id} failed in ${w.id}: ${c.evidence}`)
    }
    for (const e of w.missingEvents) failing.push(`${w.id}: log event missing: ${e}`)
    for (const e of w.errorLogs) failing.push(`${w.id}: error logged: ${e}`)
    for (const f of w.findings) {
      const line = `${w.id} (${f.severity}): ${f.description} [step: ${f.step}]`
      if (f.severity === 'minor') minor.push(line)
      else failing.push(line)
    }
  }
  if (!close) failing.push('closing the validation run returned nothing')
  else {
    for (const l of close.leaks) failing.push(`leak: ${l}`)
    for (const p of close.probes) if (!p.pass) failing.push(`probe failed: ${p.id}: ${p.evidence}`)
    for (const c of close.criteria) {
      if (c.pass) passed.add(c.id)
      else failing.push(`${c.id} failed: ${c.evidence}`)
    }
    if (!close.bothReplicasServed) failing.push('requests were not served by both replicas')
    if (!close.stackRemoved) failing.push('the test stack was not fully removed')
  }
  if (mode === 'walkthrough') {
    for (const c of criteria) if (!passed.has(c)) failing.push(`${c} has no passing evidence in this run`)
  }
  return { failing, minor, runDir: stack ? stack.runDir : '' }
}

async function validate(round, mode, scenarios, criteria) {
  const specs =
    mode === 'specs'
      ? `every codified spec of MVP 1 to ${MVP}`
      : MVP > 1
        ? `the codified specs of MVP 1 to ${MVP - 1} (they bring the stack to the state this MVP starts from)`
        : 'no specs (none exist before MVP 1)'
  const stack = await run(
    `${CONTEXT}\n\nOpen validation run ${round} (${mode}) for MVP ${MVP}. In the main checkout on ${BRANCH} with a clean tree: create the run folder e2e/reports/mvp-${MVP}/<UTC timestamp>-r${round}-${mode}; bring up a fresh test stack with "pnpm e2e:stack up" (docs/mvp/README.md); start capturing the logs of every app replica (app-a and app-b, plus app-c from MVP 3) into <run folder>/app.log in the background and note the capture's process id in the run folder; then run ${specs} against the running stack with "pnpm e2e:specs". Return the run folder, the compose project and every failing spec.`,
    { label: `stack:r${round}:${mode}`, phase: 'Validate', schema: STACK },
  )
  const walks = []
  if (mode === 'walkthrough' && stack && stack.ok) {
    for (const s of scenarios) {
      const w = take(
        await run(
          `${CONTEXT}\n\nWalk scenario ${s.id} ("${s.title}") of ${DOC} on the running stack at http://127.0.0.1:8080 (compose project ${stack.project}), exactly as the validation protocol in docs/mvp/README.md describes: Playwright MCP, like a person — visible buttons, fields and the keyboard only; no API calls or database reads during the walkthrough; infrastructure steps, verification steps and probes only where the scenario lists them (probes use curl with their own session, as the protocol says). Earlier specs in this run: ${stack.specFailures.length ? `failing: ${stack.specFailures.join('; ')}` : 'all passed'}. Save screenshots of the camera-marked steps into ${stack.runDir}. Afterwards check ${stack.runDir}/app.log for the events the scenario lists and for error or fatal lines. Report every criterion the scenario covers with evidence, and every finding a person would trip over.`,
          { label: `walk:${s.id}:r${round}`, phase: 'Validate', schema: WALK },
        ),
        `MVP ${MVP} · Validate (${s.id})`,
      )
      walks.push(
        w || {
          id: s.id,
          pass: false,
          criteria: [],
          missingEvents: [],
          errorLogs: [`the walker for ${s.id} returned nothing`],
          findings: [],
        },
      )
    }
  }
  const close = await run(
    `${CONTEXT}\n\nClose validation run ${round} (${mode}) of MVP ${MVP}${stack ? ` in ${stack.runDir}` : ''}: run the leak checks (app.log and a pg_dump; if a real AI key was used, look for it too); check the criteria listed under "Proven outside the walkthrough" in ${DOC} that this run can show (for example the migrations at the start of the run, the log rules, the stack's own up and down) and report the rest as passed only if their tests exist and pass; check from the http.request lines that every replica served requests; write report.md in the run folder from the stack result and the walkthrough results below. Then stop the log capture and take the stack down with "pnpm e2e:stack down", confirming no containers, networks or volumes of the project remain. Keep only the three newest run folders of this MVP and delete older ones.\n\n${JSON.stringify({ stack, walks })}`,
    { label: `close:r${round}:${mode}`, phase: 'Validate', schema: CLOSE },
  )
  return assess(stack, walks, close, criteria, mode)
}

async function fixRound(round, problems, deep) {
  const triage = take(
    await run(
      `${CONTEXT}\n\nTriage fix round ${round} of MVP ${MVP}${deep ? ' — a deep round: earlier rounds did not fix these' : ''}. Problems:\n${bullet(problems)}\nGroup them into independent fix tasks: each task lists its problems and the paths it may change, and no two tasks share a path. If a task continues an unmerged slice branch, name it in continueBranch, otherwise use an empty string. If a problem can only be solved by deviating from a criterion or the north star, still make the best task for it and report the deviation under decisions.`,
      { label: `triage:r${round}`, phase: 'Fix', schema: TRIAGE },
    ),
    `MVP ${MVP} · Fix round ${round}`,
  )
  if (!triage || !triage.tasks.length) return problems
  const results = await pipeline(
    triage.tasks,
    (task) => {
      const branch = `${BRANCH}-fix-r${round}-${task.id}`
      const start = task.continueBranch || BRANCH
      return run(
        `${CONTEXT}\n\nFix task "${task.id}": ${task.title}\nProblems:\n${bullet(task.items)}\nPaths you may change:\n${bullet(task.ownedPaths)}\n\nIn your fresh worktree run "git checkout -b ${branch} ${start}". Find the root cause${deep ? ' — the current approach already failed, so a different one is allowed within these paths' : ''}, fix it with a test that would have caught it, run "pnpm install" and "pnpm check", commit on ${branch}, and finish with "git checkout --detach". Never start the Docker test stack; validation happens after integration.`,
        {
          label: `fix:r${round}:${task.id}`,
          phase: 'Fix',
          schema: WORK,
          isolation: 'worktree',
        },
      ).then((w) => take(w, `MVP ${MVP} · Fix round ${round} (${task.id})`))
    },
    (work, task) =>
      work
        ? verify(`fix ${task.id}`, work.branch, BRANCH, task.items, 'Fix').then((v) => ({
            branch: work.branch,
            ok: v.pass,
            failures: failureText(v.failures),
          }))
        : null,
  )
  const good = results.filter((r) => r && r.ok).map((r) => r.branch)
  const bad = results.filter((r) => r && !r.ok)
  if (bad.length) log(`${bad.length} fix(es) in round ${round} failed verification and go back to triage`)
  await integrate(good, `fix-r${round}`)
  return bad.flatMap((b) => b.failures)
}

// ---------- run ----------
phase('Preflight')
const pre = take(
  await run(
    `${CONTEXT}\n\nPreflight for MVP ${MVP}, in the main checkout:\n- If ${DOC} already has a row in its sign-off table, return alreadyDone=true and stop.\n- If the tree is not clean, stash everything ("git stash push -u -m 'before build-mvp ${MVP}'") and report it as a decision.\n${MVP > 1 ? `- MVP ${MVP - 1} must have a row in the sign-off table of docs/mvp/MVP-${MVP - 1}.md, on main or on branch mvp-${MVP - 1}; if not, return ok=false.\n` : ''}- Check out ${BRANCH} if it exists; otherwise create it from ${MVP > 1 ? `main if MVP ${MVP - 1} is merged there, else from mvp-${MVP - 1}` : 'main'}.\n- "pnpm install --frozen-lockfile", "pnpm check" and "pnpm unused" must be green; fix small environment problems yourself.\n- canValidate: Docker answers "docker info" and the Playwright MCP tools are available (ToolSearch for mcp__playwright__browser_navigate).\n- realAiAvailable: JOBFILLY_E2E_AI_PROVIDER and JOBFILLY_E2E_AI_KEY are set.\nReturn the commit ${BRANCH} starts from as baseCommit, and anything you could not fix under problems.`,
    { label: 'preflight', phase: 'Preflight', schema: PREFLIGHT },
  ),
  `MVP ${MVP} · Preflight`,
)
if (pre && pre.alreadyDone) return { mvp: MVP, status: 'already done', branch: BRANCH }
if (!pre || !pre.ok) {
  return { mvp: MVP, status: 'not started', branch: BRANCH, problems: pre ? pre.problems : ['preflight returned nothing'] }
}

phase('Plan')
let plan = take(
  await run(
    `${CONTEXT}\n\nPlan MVP ${MVP}. Read all of ${DOC}, docs/ARCHITECTURE.md, docs/mvp/README.md and the current code on ${BRANCH}. Return:\n- criteria: every acceptance criterion id in ${DOC} (like F1.1)\n- scenarios: every end-to-end scenario id and title in ${DOC}, in order\n- foundation: the shared contract every slice needs (schema types, database tables and migrations, API route stubs registered in the server, page stubs registered in the web app, the fixtures layout, test-stack services), plus the criteria that must exist before any parallel work (follow the build order in ${DOC}${MVP === 1 ? '; for MVP 1 that is F7 and F1' : ''}). List every shared registration file under hotspots: the foundation creates them so slices never edit the same file.\n- slices: 3 to 6 parts that can be built in parallel, each with a kebab-case id, the criteria it owns, the paths it owns (disjoint from every other slice), dependsOn (empty unless truly needed) and a test plan.\nEvery criterion belongs to exactly one of the foundation or a slice.`,
    { label: 'plan', phase: 'Plan', schema: PLAN },
  ),
  `MVP ${MVP} · Plan`,
)
if (!plan) throw new Error('the planner returned nothing')
for (let attempt = 1; attempt <= 3; attempt++) {
  const problems = planProblems(plan)
  if (!problems.length) {
    const critique = await run(
      `${CONTEXT}\n\nCritique this build plan for MVP ${MVP} against ${DOC}: slices that would edit the same files, shared registration points missing from the foundation, slices too large for one agent, build-order violations, missing scenarios or criteria. Return ok=false if you would not bet on this plan.\n\n${JSON.stringify(plan)}`,
      { label: `plan-critic:${attempt}`, phase: 'Plan', schema: CRITIQUE },
    )
    if (!critique || critique.ok) break
    problems.push(...critique.problems)
  }
  if (attempt === 3) {
    pending.push(
      openItem(
        'Build plan accepted with known problems',
        `After two revisions the plan still had: ${problems.join('; ')}`,
        `MVP ${MVP} · Plan`,
      ),
    )
    break
  }
  plan =
    take(
      await run(
        `${CONTEXT}\n\nRevise this build plan for MVP ${MVP} so these problems are gone, keeping everything else:\n${bullet(problems)}\n\n${JSON.stringify(plan)}`,
        { label: `plan-revise:${attempt}`, phase: 'Plan', schema: PLAN },
      ),
      `MVP ${MVP} · Plan`,
    ) || plan
}
await record('planning')

const carry = []
if (FROM !== 'validate') {
  phase('Foundation')
  const f = plan.foundation
  take(
    await run(
      `${CONTEXT}\n\nBuild the foundation of MVP ${MVP} in the main checkout on ${BRANCH}: ${f.summary}\nCriteria: ${f.criteria.join(', ') || '(none)'}\nShared registration points to create, so slices never edit the same file:\n${bullet(f.hotspots)}\nOwned paths:\n${bullet(f.ownedPaths)}\nSlices that will build on it:\n${bullet(plan.slices.map((s) => `${s.id}: ${s.title} (owns ${s.ownedPaths.join(', ')})`))}\n\nImplement with tests that would fail without your code (hermetic: PGlite and fakes). Run "pnpm install" and "pnpm check" until green and commit in small Conventional Commits.`,
      { label: 'foundation', phase: 'Foundation', schema: WORK },
    ),
    `MVP ${MVP} · Foundation`,
  )
  const foundationChecklist = f.criteria.concat(f.hotspots.map((h) => `exists and is registered: ${h}`))
  let fv = await verify('the foundation', BRANCH, pre.baseCommit, foundationChecklist, 'Foundation')
  for (let round = 1; !fv.pass && round <= 2; round++) {
    take(
      await run(
        `${CONTEXT}\n\nFix the foundation of MVP ${MVP} in the main checkout on ${BRANCH}. Fix exactly these findings, run "pnpm check", and commit:\n${bullet(failureText(fv.failures))}`,
        { label: `foundation-fix:${round}`, phase: 'Foundation', schema: WORK },
      ),
      `MVP ${MVP} · Foundation`,
    )
    fv = await verify('the foundation', BRANCH, pre.baseCommit, foundationChecklist, 'Foundation')
  }
  if (!fv.pass) carry.push(...failureText(fv.failures).map((t) => `foundation: ${t}`))
  await record('the foundation')

  phase('Build')
  const lv = levels(plan.slices) || [plan.slices]
  for (let i = 0; i < lv.length; i++) {
    const built = await pipeline(lv[i], (s) => buildSlice(s))
    const verified = built.filter((b) => b && b.verified).map((b) => b.branch)
    for (const b of built.filter((x) => x && !x.verified)) {
      carry.push(`slice ${b.id} (branch ${b.branch}, not merged) still fails: ${b.failures.join(' | ')}`)
    }
    const merge = await integrate(verified, `level-${i + 1}`)
    if (merge) for (const n of merge.notMerged) carry.push(`branch ${n.branch} was not merged: ${n.reason}`)
    await record(`build level ${i + 1}`)
  }
}

const runDirs = []
let minor = []
let status = ''
let round = 0
let fixRoundsRun = 0
let deepDone = false
let problemsIn = carry
while (true) {
  if (!pre.canValidate) {
    pending.push(
      openItem(
        'Validation could not run',
        'Docker or the Playwright MCP tools were not available, so no end-to-end validation was done.',
        `MVP ${MVP} · Validate`,
      ),
    )
    status = 'accepted with open items'
    break
  }
  phase('Validate')
  const walk = await validate(round, 'walkthrough', plan.scenarios, plan.criteria)
  runDirs.push(walk.runDir)
  minor = walk.minor
  let failing = walk.failing
  if (!failing.length) {
    phase('Codify')
    take(
      await run(
        `${CONTEXT}\n\nCodify MVP ${MVP}: for every scenario in ${DOC} that passed in ${walk.runDir}, write or update a Playwright spec in e2e/specs/mvp-${MVP}/ that repeats the same human steps with role- and label-based locators (the only shortcuts allowed are the infrastructure steps a scenario lists). Remove specs of scenarios that no longer exist. In the main checkout on ${BRANCH}, run "pnpm e2e" until every spec of MVP 1 to ${MVP} passes on a fresh stack, then commit. "pnpm e2e" takes its stack down at the end; make sure it did.`,
        { label: `codify:r${round}`, phase: 'Codify', schema: WORK },
      ),
      `MVP ${MVP} · Codify`,
    )
    phase('Confirm')
    const second = await validate(round, 'specs', plan.scenarios, plan.criteria)
    runDirs.push(second.runDir)
    failing = second.failing
    if (!failing.length) {
      const q = await run(
        `${CONTEXT}\n\nReal-AI quality run for MVP ${MVP} (round ${round}). If JOBFILLY_E2E_AI_PROVIDER or JOBFILLY_E2E_AI_KEY is not set, return ran=false and say so in notes. Otherwise: bring up a fresh test stack, replay what is needed to measure every threshold in the section "Quality with a real AI provider" of ${DOC}, with the real provider configured through the UI (Playwright MCP); measure each threshold against e2e/fixtures/<persona>/expected.json; check the real key appears in neither app.log nor a pg_dump; write quality.md into a new run folder; take the stack down.`,
        { label: `quality:r${round}`, phase: 'Confirm', schema: QUALITY },
      )
      if (q && q.ran && !q.pass) {
        failing = q.results.filter((r) => !r.pass).map((r) => `quality: ${r.threshold} — measured ${r.measured}`)
      } else {
        if (!q || !q.ran) {
          pending.push(
            openItem(
              'Real-AI quality run not done',
              `${q ? q.notes : 'the quality agent returned nothing'} Set JOBFILLY_E2E_AI_PROVIDER and JOBFILLY_E2E_AI_KEY, then run build-mvp with mvp ${MVP} and from "validate".`,
              `MVP ${MVP} · Confirm`,
            ),
          )
        }
        if (MVP === 3) {
          const soak = await run(
            `${CONTEXT}\n\nSoak for MVP 3 (round ${round}): run "pnpm e2e:soak" as F10.3 in ${DOC} describes, record the memory, job and latency figures in a soak.md in a new run folder under e2e/reports/mvp-3/, update the observed resource use in docs/ARCHITECTURE.md (F10.4) and commit that, and make sure the soak stack is gone afterwards.`,
            { label: `soak:r${round}`, phase: 'Confirm', schema: QUALITY },
          )
          if (!soak || !soak.ran || !soak.pass) {
            failing = soak
              ? soak.results.filter((r) => !r.pass).map((r) => `soak: ${r.threshold} — measured ${r.measured}`).concat(soak.ran ? [] : [`soak did not run: ${soak.notes}`])
              : ['the soak agent returned nothing']
          }
        }
        const audit = failing.length ? null : await run(
          `${CONTEXT}\n\nEvidence audit for MVP ${MVP}. Try to refute that MVP ${MVP} is done. Read ${DOC}, the run reports in ${runDirs.join(', ')} and the code on ${BRANCH}. For every acceptance criterion check that the evidence is real and enough: a scenario step that was actually performed and observed, a test that would fail without the code, a log line that exists. Also look for stubs, fakes or test-only shortcuts in production code paths. Refute whenever the evidence is missing or thin.`,
          { label: `audit:r${round}`, phase: 'Confirm', schema: AUDIT },
        )
        if (failing.length) {
          // the soak failed; fall through to the fix round
        } else if (audit && audit.refuted.length) {
          failing = audit.refuted.map((r) => `audit: ${r.ref}: ${r.why}`)
        } else {
          status = q && q.ran ? 'signed off' : 'accepted with open items'
          break
        }
      }
    }
  }
  round++
  if (round > MAX_FIX_ROUNDS) {
    if (!deepDone) {
      deepDone = true
      phase('Fix')
      log(`still failing after ${MAX_FIX_ROUNDS} fix rounds; running one deep round`)
      problemsIn = await fixRound(round, failing.concat(problemsIn), true)
      fixRoundsRun++
      await record(`deep fix round ${round}`)
      continue
    }
    for (const f of failing.concat(problemsIn)) {
      pending.push(openItem('Unresolved after the fix rounds', f, `MVP ${MVP} · Validate`))
    }
    status = 'accepted with open items'
    break
  }
  phase('Fix')
  problemsIn = await fixRound(round, failing.concat(problemsIn), false)
  fixRoundsRun++
  await record(`fix round ${round}`)
}
await record('validation')

phase('Clean up')
const cleaned = take(
  await run(
    `${CONTEXT}\n\nClean up after MVP ${MVP} in the main checkout on ${BRANCH}:\n- Run "pnpm unused" and remove every unused file, export and dependency it reports; drop entries from the ignore lists in knip.jsonc that are now used, keeping only dependencies a later MVP needs.\n- Remove dead code, commented-out code, TODO/FIXME notes, debug output and one-off scripts; no stubs or fakes outside tests and e2e/.\n- Delete branches already merged into ${BRANCH}. For unmerged ${BRANCH}-* branches holding work that is not in ${BRANCH}, keep them and list them under remaining; delete the others. Remove the worktrees this workflow created and run "git worktree prune".\n- Make sure no test stack, log capture or browser started by this workflow is still running, and no containers, networks or volumes of e2e compose projects remain.\n- Keep only the three newest report folders per MVP under e2e/reports.\n- Update docs/ARCHITECTURE.md if a boundary changed, and report that as a decision.\nThen run "pnpm check", "pnpm build" and "pnpm unused", commit with "chore(repo): clean up after MVP ${MVP}", and confirm "git status" is clean.`,
    { label: 'clean-up', phase: 'Clean up', schema: CLEAN },
  ),
  `MVP ${MVP} · Clean up`,
)
if (cleaned && !cleaned.clean) {
  for (const r of cleaned.remaining) pending.push(openItem('Left after clean-up', r, `MVP ${MVP} · Clean up`))
}
await record('clean-up')

phase('Sign-off')
const summary = [
  `Status: ${status}.`,
  `Fix rounds: ${fixRoundsRun}${deepDone ? ' (including a deep round)' : ''}.`,
  `Run folders: ${runDirs.filter(Boolean).join(', ') || '(none)'}.`,
  minor.length ? `Minor findings left: ${minor.join(' | ')}` : 'No minor findings left.',
].join('\n')
const signed = await run(
  `${CONTEXT}\n\nSign off MVP ${MVP} with status "${status}". In the main checkout on ${BRANCH}, add a row to the sign-off table at the end of ${DOC}: today's date, the status, the current commit, the newest run folder, the real AI provider used or "not run", and in Notes the TBD.md entries still open for MVP ${MVP} plus the summary below. Commit with "docs(mvp-${MVP}): sign off" and confirm "git status" is clean.${PUSH ? ` Then push ${BRANCH} to origin (never main).` : ' Do not push.'}\n\n${summary}`,
  { label: 'sign-off', phase: 'Sign-off', schema: SIGN },
)

return {
  mvp: MVP,
  status,
  branch: BRANCH,
  fixRounds: fixRoundsRun,
  deepRound: deepDone,
  runDirs: runDirs.filter(Boolean),
  minorFindings: minor,
  signOffCommit: signed ? signed.commit : '',
}
