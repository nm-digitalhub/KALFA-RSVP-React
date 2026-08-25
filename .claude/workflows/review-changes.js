// /review-changes [base]
// Reviews every changed source file (vs a base ref, default main, plus uncommitted
// changes) through KALFA's own domain reviewers, then adversarially verifies each
// finding before it is reported. Read-only.
export const meta = {
  name: 'review-changes',
  description: 'Review every changed file vs main with KALFA domain reviewers (authz, RLS/schema, public-token surface, RTL), then adversarially verify each finding',
  whenToUse: 'Before declaring a branch done, before a PR, or when the owner asks for a thorough review of what changed',
  phases: [
    { title: 'Diff', detail: 'collect changed source files' },
    { title: 'Review', detail: 'two reviewers per file' },
    { title: 'Verify', detail: '3 refuters per finding, majority vote' },
    { title: 'Summary', detail: 'ranked Hebrew summary' },
  ],
}

const base = typeof args === 'string' && args.trim()
  ? args.trim()
  : (args && typeof args === 'object' && args.base) || 'main'

// Budget: ≤15 files × 2 reviewers + ≤3 findings/file × 3 refuters ≈ 30–165 agents
// worst case; typical branches (few findings) land near 30–40. Split large
// diffs by passing a narrower base or reviewing per directory.
const MAX_FILES = 15
const MAX_FINDINGS_PER_FILE = 3

const FILES = { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } }
const FINDINGS = {
  type: 'object', required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', required: ['title', 'severity', 'line', 'detail'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          line: { type: 'integer' },
          detail: { type: 'string' },
        },
      },
    },
  },
}
const VOTE = { type: 'object', required: ['refuted', 'reason'], properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } } }

const GUARD = 'Read-only review: never edit files, never run git write commands, never touch .env*. Report facts with file:line.'

phase('Diff')
const found = await agent(
  `Collect the changed source files in this repo: run "git diff --name-only ${base}...HEAD" and "git status --short" (uncommitted + untracked), merge them, and keep only files under src/, worker/, scripts/, supabase/migrations/ with extensions .ts .tsx .sql .mjs .cjs. Exclude deleted files, node_modules, dist, .next. Return repo-relative paths. ${GUARD}`,
  { label: 'diff', phase: 'Diff', schema: FILES, effort: 'low' },
)
const files = (found && found.files ? found.files : []).slice(0, MAX_FILES)
if (found && found.files && found.files.length > MAX_FILES) log(`capped at ${MAX_FILES} of ${found.files.length} changed files`)
if (files.length === 0) return { base, files: 0, confirmed: [], summary: 'אין קבצי מקור שהשתנו מול ' + base }
log(`${files.length} changed files to review vs ${base}`)

// Second reviewer chosen by path: schema/RLS for SQL, the public-token sentinel for
// anonymous surfaces, otherwise a general correctness + RTL/a11y pass.
function specialistFor(f) {
  if (f.endsWith('.sql')) return { agentType: 'rls-schema-engineer', lens: 'RLS, grants, SECURITY DEFINER safety, indexes, rollback, and ownership scoping. Review ONLY — do not write migrations.' }
  if (f.includes('/(public)/') || f.includes('/api/voximplant/') || f.includes('[token]')) return { agentType: 'public-rsvp-sentinel', lens: 'token validation, enumeration/rate limiting, guest PII exposure, caching and referrer leakage on this anonymous surface.' }
  return { agentType: 'general-purpose', lens: 'correctness, error handling, Zod validation at boundaries, Server/Client component split, Hebrew RTL and accessibility (logical CSS properties, focus states, contrast), and reuse of existing lib/ui primitives.' }
}

const reviewed = await pipeline(
  files,
  (f) => parallel([
    () => agent(
      `Review the CURRENT content of ${f} (read it in full; use "git diff ${base} -- ${f}" to see what changed) for authentication/authorization defects: missing server-side gates, trusting browser-submitted ids/roles, ownership not scoped through the event boundary, admin checks not from a trusted role source, service-role client used where the cookie client belongs. Return up to ${MAX_FINDINGS_PER_FILE} findings with severity and line. Empty list if none. ${GUARD}`,
      { label: `authz:${f}`, phase: 'Review', schema: FINDINGS, agentType: 'auth-authz-guardian' },
    ),
    () => {
      const s = specialistFor(f)
      return agent(
        `Review the CURRENT content of ${f} (read it in full; use "git diff ${base} -- ${f}" for what changed) with this lens: ${s.lens} Return up to ${MAX_FINDINGS_PER_FILE} concrete findings with severity and line. Empty list if none. ${GUARD}`,
        { label: `${s.agentType}:${f}`, phase: 'Review', schema: FINDINGS, agentType: s.agentType },
      )
    },
  ]).then((pair) => pair.filter(Boolean).flatMap((r) => (r.findings || []).map((x) => ({ ...x, file: f })))),
  (findings, f) => parallel(
    findings.slice(0, MAX_FINDINGS_PER_FILE * 2).map((x) => () =>
      parallel([1, 2, 3].map((i) => () =>
        agent(
          `Adversarially try to REFUTE this review finding about ${x.file} line ${x.line}: "${x.title}" — ${x.detail}. Read the actual code and its callers. If the finding is wrong, already mitigated elsewhere (middleware/DAL/RLS/hook), or not reachable, set refuted=true with the reason and file:line. Default to refuted=true when uncertain. Perspective #${i}: ${i === 1 ? 'correctness' : i === 2 ? 'security reachability' : 'does the surrounding code already guard it'}. ${GUARD}`,
          { label: `refute${i}:${f}`, phase: 'Verify', schema: VOTE },
        ),
      )).then((votes) => {
        const v = votes.filter(Boolean)
        const notRefuted = v.filter((r) => !r.refuted).length
        return { ...x, votes: v.length, notRefuted, confirmed: notRefuted >= 2 }
      }),
    ),
  ),
)

const all = reviewed.filter(Boolean).flat().filter(Boolean)
const confirmed = all.filter((x) => x.confirmed)
const order = { critical: 0, high: 1, medium: 2, low: 3 }
confirmed.sort((a, b) => order[a.severity] - order[b.severity])
log(`${confirmed.length} findings confirmed of ${all.length} raised`)

phase('Summary')
const summary = await agent(
  `Write a concise Hebrew review summary (identifiers in English) of these CONFIRMED findings (each survived a 3-refuter vote): ${JSON.stringify(confirmed)}. Also list, in one line each, the ${all.length - confirmed.length} findings that were refuted (title + why), so the owner sees what was considered. Rank by severity; for each confirmed finding give file:line, the risk in one sentence, and the smallest fix. No fixes are applied by this workflow.`,
  { label: 'summary', phase: 'Summary' },
)

return { base, files: files.length, raised: all.length, confirmed, summary }
