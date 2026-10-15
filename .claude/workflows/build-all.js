export const meta = {
  name: 'build-all',
  description:
    'Build JobFilly MVP 1, 2 and 3 in order, unattended, then the Helm chart. Skips what is already signed off and never stops to ask; decisions go to TBD.md.',
  whenToUse:
    'Unattended full build. Optional args: {"from": 1, "to": 3, "helm": true, "maxFixRounds": 4, "push": false}.',
  phases: [
    { title: 'MVPs', detail: 'build-mvp for each MVP, in order' },
    { title: 'Helm', detail: 'build-helm once MVP 3 is done' },
  ],
}

const FROM = Number((args && args.from) || 1)
const TO = Number((args && args.to) || 3)
const HELM = !(args && args.helm === false)
const shared = {}
if (args && args.maxFixRounds) shared.maxFixRounds = args.maxFixRounds
if (args && args.push) shared.push = true

const results = []
phase('MVPs')
for (let n = FROM; n <= TO; n++) {
  let r
  try {
    r = await workflow('build-mvp', { mvp: n, ...shared })
  } catch (e) {
    r = { mvp: n, status: 'failed to run', error: String(e) }
  }
  results.push(r || { mvp: n, status: 'no result' })
  log(`MVP ${n}: ${r ? r.status : 'no result'}`)
  // Later MVPs build on earlier ones; without a signed-off or accepted MVP there is nothing to build on.
  if (!r || !['signed off', 'accepted with open items', 'already done'].includes(r.status)) break
}

const last = results[results.length - 1]
if (HELM && last && last.mvp === 3 && ['signed off', 'accepted with open items', 'already done'].includes(last.status)) {
  phase('Helm')
  try {
    results.push(await workflow('build-helm', args && args.push ? { push: true } : {}))
  } catch (e) {
    results.push({ helm: true, status: 'failed to run', error: String(e) })
  }
}

return results
