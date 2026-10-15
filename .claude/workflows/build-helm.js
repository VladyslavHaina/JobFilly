export const meta = {
  name: 'build-helm',
  description:
    'Build and validate the JobFilly Helm chart ("After sign-off" in docs/mvp/MVP-3.md), unattended; decisions go to TBD.md.',
  whenToUse:
    'After MVP 3 is signed off or accepted with open items. Optional args: {"push": false}. Installs only into the kube context named in JOBFILLY_E2E_KUBE_CONTEXT.',
  phases: [
    { title: 'Build chart', detail: 'H1 to H4 on branch helm-chart' },
    { title: 'Verify', detail: 'criteria lens and Kubernetes-practice lens' },
    { title: 'Install', detail: 'H5 on the named local cluster, then remove everything' },
    { title: 'Record', detail: 'decisions and open items appended to TBD.md' },
    { title: 'Sign-off', detail: 'clean-up and a row in the MVP 3 sign-off table' },
  ],
}

const PUSH = Boolean(args && args.push)
const BRANCH = 'helm-chart'
const CONTEXT = [
  'You are one agent in the unattended workflow that builds the JobFilly Helm chart, specified under "After sign-off: the Helm chart" in docs/mvp/MVP-3.md (criteria H1 to H5).',
  'The owner is away: never stop to ask. When an important decision comes up, choose what best serves the criteria and docs/NORTH_STAR.md, carry on, and report it under "decisions". Never edit spec text. Keep the tree clean and delete whatever your change made unnecessary.',
].join('\n')

// The owner asked for every agent to run at high effort, never low or max.
const run = (prompt, opts) => agent(prompt, { ...opts, effort: 'high' })

const STR = { type: 'string' }
const BOOL = { type: 'boolean' }
const STRS = { type: 'array', items: STR }
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties) })
const DECISIONS = {
  type: 'array',
  items: obj({ title: STR, context: STR, options: STRS, chosen: STR, why: STR, ifOtherwise: STR, refs: STR }),
}
const WORK = obj({ ok: BOOL, commits: STRS, notDone: STRS, summary: STR, decisions: DECISIONS })
const VERDICT = obj({
  pass: BOOL,
  failures: { type: 'array', items: obj({ ref: STR, problem: STR, evidence: STR, fix: STR }) },
})
const INSTALL = obj({ ran: BOOL, pass: BOOL, results: STRS, removed: BOOL, notes: STR, decisions: DECISIONS })
const SIGN = obj({ commit: STR, notes: STR })

const bullet = (xs) => (xs && xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- (none)')
const pending = []
const take = (r, where) => {
  if (r && Array.isArray(r.decisions)) for (const d of r.decisions) pending.push({ kind: 'decision', where, ...d })
  return r
}
const openItem = (title, context) => ({
  kind: 'open item',
  where: 'Helm chart',
  title,
  context,
  options: [],
  chosen: '',
  why: '',
  ifOtherwise: '',
  refs: '',
})

phase('Build chart')
const built = take(
  await run(
    `${CONTEXT}\n\nIn the main checkout with a clean tree: check out ${BRANCH} if it exists, otherwise create it from main if MVP 3 is merged there, else from mvp-3. Build deploy/helm/jobfilly to meet H1 to H4, using the environment variables, port, probes, migrate command and resource figures in docs/ARCHITECTURE.md. Run "helm lint" and "helm template" until both are clean, then "pnpm check", and commit in small Conventional Commits.`,
    { label: 'chart', phase: 'Build chart', schema: WORK },
  ),
  'Helm · Build',
)

phase('Verify')
const lenses = [
  'Lens: criteria. Check H1 to H4 one by one against the chart, by reading it and running "helm lint" and "helm template".',
  'Lens: Kubernetes practice and security. Non-root, read-only root filesystem, probes on the health endpoints, resource requests and limits, a PodDisruptionBudget, secrets never in plain values or ConfigMaps, an existing Secret supported, a pinned image tag, the migration hook ordered before the Deployment, nothing that needs a shared disk.',
]
let failures = []
for (let round = 0; round <= 2; round++) {
  const verdicts = (
    await parallel(
      lenses.map(
        (lens, i) => () =>
          run(
            `${CONTEXT}\n\nYou are an independent verifier and your job is to refute that the chart on ${BRANCH} is done. In your worktree run "git checkout --detach ${BRANCH}". Do not edit or commit anything.\n\n${lens}\n\nWhen unsure, fail it, with file:line evidence and the fix.`,
            { label: `verify-${i + 1}:r${round}`, phase: 'Verify', schema: VERDICT, isolation: 'worktree' },
          ),
      ),
    )
  ).filter(Boolean)
  failures = verdicts.flatMap((v) => v.failures)
  if (verdicts.length === lenses.length && verdicts.every((v) => v.pass)) break
  if (round === 2) break
  take(
    await run(
      `${CONTEXT}\n\nFix the chart on ${BRANCH} in the main checkout. Fix exactly these findings, rerun "helm lint", "helm template" and "pnpm check", and commit:\n${bullet(failures.map((f) => `${f.ref}: ${f.problem} (evidence: ${f.evidence}; fix: ${f.fix})`))}`,
      { label: `chart-fix:${round + 1}`, phase: 'Verify', schema: WORK },
    ),
    'Helm · Verify',
  )
}
for (const f of failures) pending.push(openItem('Chart finding left after verification', `${f.ref}: ${f.problem}`))

phase('Install')
const install = take(
  await run(
    `${CONTEXT}\n\nCheck H5. If JOBFILLY_E2E_KUBE_CONTEXT is not set, return ran=false and say so: never use the current kube context or any other one. Otherwise, using only that context ("--context" on every kubectl and helm call): put the test services (Postgres, the test mail server, the fake AI) in namespace jobfilly-e2e-deps, install the chart in namespace jobfilly-e2e with an image built from ${BRANCH}, run the full MVP 1 to 3 Playwright suite against it, run "helm upgrade" to a new image tag while a scan is running and check it finishes with no errors and no signed-out users. Then uninstall everything and delete both namespaces, and confirm they are gone.`,
    { label: 'install', phase: 'Install', schema: INSTALL },
  ),
  'Helm · Install',
)
if (!install || !install.ran) {
  pending.push(
    openItem(
      'Helm chart not installed on a cluster (H5)',
      `${install ? install.notes : 'the install agent returned nothing'} Set JOBFILLY_E2E_KUBE_CONTEXT to your local cluster's context and run build-helm again.`,
    ),
  )
} else if (!install.pass) {
  for (const r of install.results) pending.push(openItem('H5 check failed', r))
}
if (built && built.notDone.length) for (const n of built.notDone) pending.push(openItem('Chart work not finished', n))

phase('Record')
if (pending.length) {
  await run(
    `${CONTEXT}\n\nAppend these ${pending.length} entries to TBD.md in the main checkout on ${BRANCH}, as new numbered entries in the format the file describes (continue its numbering; status "open"). Change nothing else. Commit with "docs(tbd): record entries from the Helm chart build".\n\n${JSON.stringify(pending, null, 2)}`,
    { label: 'record', phase: 'Record' },
  )
}

phase('Sign-off')
const ok = failures.length === 0 && install && install.ran && install.pass
const signed = await run(
  `${CONTEXT}\n\nFinish the Helm chart build in the main checkout on ${BRANCH}: make sure nothing from the install is still running and no stray files remain, then add a row to the sign-off table of docs/mvp/MVP-3.md with today's date, status "${ok ? 'Helm chart done' : 'Helm chart with open items'}", the current commit, and in Notes the open TBD.md entries for the chart. Commit with "docs(helm): record the chart sign-off" and confirm "git status" is clean.${PUSH ? ` Then push ${BRANCH} to origin (never main).` : ' Do not push.'}`,
  { label: 'sign-off', phase: 'Sign-off', schema: SIGN },
)

return {
  helm: true,
  status: ok ? 'helm chart done' : 'helm chart with open items',
  branch: BRANCH,
  commit: signed ? signed.commit : '',
}
