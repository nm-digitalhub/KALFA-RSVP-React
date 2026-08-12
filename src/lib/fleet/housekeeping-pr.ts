// Pure logic for the `housekeeping-pr` verb (plans/fleet-maintenance-capability-plan.md
// §4) — the fleet's only git-writing verb. Everything here is deliberately free of
// filesystem/DB/git access so it can be unit-tested directly; fleet-agent-cli.ts
// wires these functions to the actual worktree/gh/git calls.
//
// Two independent guards gate a write, mirroring the plan's "narrow verb + approval
// gate" principle (§2):
//   1. validateApprovalVerdict — the request-id must carry an OWNER'S approving
//      verdict for role='fleet-maintainer', kind='approval'. A role's own judgment
//      is never sufficient on its own.
//   2. findPrEligibleEntry — the catalog-id must be a known-issues.json entry whose
//      remediation_kind='pr-eligible', whose fix.file lives under docs/fleet/** (the
//      only category approved for v1 — .claude/fleet/** and scripts/fleet-agent-cli.ts
//      stay human-only, per plan §6.1), and whose check.type is mechanical
//      (contains_line/absent_line) so it can be re-verified without an LLM.

import { z } from 'zod';

const knownIssueCheckSchema = z.object({
  type: z.enum(['contains_line', 'absent_line', 'custom']),
  file: z.string().min(1),
  match: z.string().min(1),
});

// A discriminated union (not one flat object with optional fields) because the
// real catalog data enforces this shape: `fix.type:"none"` entries carry no
// file/match/replace at all. Encoding that in the schema lets findPrEligibleEntry
// hand callers a narrowed PrEligibleEntry whose fix.match is guaranteed present,
// instead of every caller re-checking `?? fail(...)`.
const knownIssueFixSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({
    type: z.literal('replace_line'),
    file: z.string().min(1),
    match: z.string().min(1),
    replace: z.string(),
  }),
  z.object({
    type: z.literal('delete_line'),
    file: z.string().min(1),
    match: z.string().min(1),
    replace: z.string().optional(),
  }),
]);

const knownIssueEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.enum(['docs-drift', 'code-bug', 'config-drift', 'stray-file', 'correctness-gap']),
  target_file: z.string().min(1),
  remediation_kind: z.enum(['detect-only', 'pr-eligible']),
  check: knownIssueCheckSchema,
  fix: knownIssueFixSchema,
  status: z.enum(['open', 'resolved', 'recurred']),
  stale_after_days: z.number().int().positive(),
  notes: z.string().min(1),
});

const knownIssuesFileSchema = z.array(knownIssueEntrySchema);

export type KnownIssueEntry = z.infer<typeof knownIssueEntrySchema>;
export type KnownIssueCheck = KnownIssueEntry['check'];
export type KnownIssueFix = KnownIssueEntry['fix'];

// Fail-closed, matching loadFleetRoles' stance in fleet-agent-cli.ts: an
// unparsable catalog must block every catalog-scoped write, not silently skip
// validation.
export function parseKnownIssues(raw: unknown): KnownIssueEntry[] {
  return knownIssuesFileSchema.parse(raw);
}

export const DOCS_FLEET_PREFIX = 'docs/fleet/';
const MECHANICAL_CHECK_TYPES = ['contains_line', 'absent_line'] as const;

export type MechanicalFix = Extract<KnownIssueFix, { type: 'replace_line' | 'delete_line' }>;
export type PrEligibleEntry = KnownIssueEntry & { fix: MechanicalFix };

export type CatalogLookup = { ok: true; entry: PrEligibleEntry } | { ok: false; reason: string };

// Safety #2 from the plan (§4): mechanical, not a judgment call — every branch
// here is a hard reject, even for a catalog entry that a future edit mismarks as
// pr-eligible on a path outside docs/fleet/**.
export function findPrEligibleEntry(entries: KnownIssueEntry[], catalogId: string): CatalogLookup {
  const entry = entries.find((e) => e.id === catalogId);
  if (!entry) {
    return { ok: false, reason: `catalog-id "${catalogId}" not found in known-issues.json` };
  }
  if (entry.remediation_kind !== 'pr-eligible') {
    return {
      ok: false,
      reason: `catalog-id "${catalogId}" is remediation_kind="${entry.remediation_kind}", not "pr-eligible"`,
    };
  }
  if (entry.fix.type === 'none') {
    return { ok: false, reason: `catalog-id "${catalogId}" has fix.type="none" — nothing to apply` };
  }
  if (!entry.fix.file.startsWith(DOCS_FLEET_PREFIX)) {
    return {
      ok: false,
      reason: `catalog-id "${catalogId}" fix.file "${entry.fix.file}" is not under ${DOCS_FLEET_PREFIX} — only that tree is pr-eligible in v1`,
    };
  }
  if (!(MECHANICAL_CHECK_TYPES as readonly string[]).includes(entry.check.type)) {
    return {
      ok: false,
      reason: `catalog-id "${catalogId}" check.type="${entry.check.type}" is not mechanical (contains_line/absent_line) — cannot re-verify without a role's judgment`,
    };
  }
  // The `fix.type === 'none'` check above already excludes that branch of the
  // union at runtime; the cast only restates that guarantee for the return
  // type, since TS discriminated-union narrowing doesn't cross a `return`
  // into a differently-named (if structurally identical) type alias.
  return { ok: true, entry: entry as PrEligibleEntry };
}

export const FLEET_MAINTAINER_ROLE = 'fleet-maintainer';
export const APPROVAL_KIND = 'approval';
export const APPROVED_STATUS = 'approved';

export type ApprovalRequestRow = { role: string; kind: string; status: string } | null | undefined;

// Safety #1 from the plan (§4): an owner verdict, never a role's own reasoning.
// "not pending/denied" in the plan's wording means exactly one thing in practice
// for kind='approval' rows (fleet_answer_request only ever resolves an approval
// request to 'approved' or 'denied') — the single acceptable value is 'approved'.
export function validateApprovalVerdict(row: ApprovalRequestRow): string | null {
  if (!row) return 'request-id not found';
  if (row.role !== FLEET_MAINTAINER_ROLE) {
    return `request-id belongs to role "${row.role}", not "${FLEET_MAINTAINER_ROLE}"`;
  }
  if (row.kind !== APPROVAL_KIND) {
    return `request-id has kind "${row.kind}", not "${APPROVAL_KIND}"`;
  }
  if (row.status !== APPROVED_STATUS) {
    // 'consumed' specifically means the caller ran `ack` on this verdict
    // first. Unlike every other verb that acts on a verdict, housekeeping-pr
    // must be called BEFORE ack, not after — status alone can no longer tell
    // an approved-then-consumed row apart from a denied-then-consumed one, so
    // this stays a hard reject rather than trying to infer the original verdict.
    const hint =
      row.status === 'consumed'
        ? ' — did `ack` run first? housekeeping-pr must be called on the still-"approved" verdict, before ack, not after'
        : '';
    return `request-id status is "${row.status}", not "${APPROVED_STATUS}" — no approving owner verdict yet${hint}`;
  }
  return null;
}

// Safety #3 from the plan (§4): the mechanical re-check, re-run by the verb
// itself against live content immediately before writing — never trusting the
// role's earlier read. Returns true when the issue is STILL PRESENT (i.e. the
// fix is still needed).
export function runMechanicalCheck(check: Pick<KnownIssueCheck, 'type' | 'match'>, content: string): boolean {
  const present = content.includes(check.match);
  return check.type === 'contains_line' ? present : !present;
}

export type FixResult = { ok: true; content: string } | { ok: false; reason: string };

// Operates at line granularity (matching the "_line" fix types): finds the
// first line containing fix.match and replaces/removes that whole line. A
// match no longer present means the file changed since the catalog entry was
// written — reported as a failure, never applied blind.
export function applyFix(fix: MechanicalFix, content: string): FixResult {
  const lines = content.split('\n');
  const idx = lines.findIndex((line) => line.includes(fix.match));
  if (idx === -1) {
    return {
      ok: false,
      reason: `fix.match not found in file — file may have changed since the catalog entry was written`,
    };
  }
  if (fix.type === 'delete_line') {
    lines.splice(idx, 1);
  } else {
    lines[idx] = lines[idx].replace(fix.match, fix.replace);
  }
  return { ok: true, content: lines.join('\n') };
}

const BRANCH_PREFIX = 'fleet/maintenance-';

// UTC, not local time: the branch name only needs to be a stable, unique-enough
// slug for the day — not a wall-clock claim.
export function branchNameFor(catalogId: string, now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${BRANCH_PREFIX}${catalogId}-${y}${m}${d}`;
}

// The idempotency check (safety #6) deliberately omits the date suffix: `gh pr
// list --head` is a PREFIX match, not glob, so searching on this prefix alone
// finds an already-open PR for this catalog-id regardless of which day it was
// opened on.
export function prHeadPrefixFor(catalogId: string): string {
  return `${BRANCH_PREFIX}${catalogId}-`;
}

export interface PrMetadata {
  title: string;
  body: string;
  commitMessage: string;
}

export function buildPrMetadata(entry: PrEligibleEntry): PrMetadata {
  const title = `fleet housekeeping: ${entry.title}`;
  const body = [
    `קטגוריה: ${entry.category}`,
    `קובץ יעד: \`${entry.target_file}\``,
    '',
    entry.notes,
    '',
    '---',
    `נפתח אוטומטית ע"י \`housekeeping-pr\` (kalfa-fleet, catalog-id: \`${entry.id}\`). דורש מיזוג ידני — הוא לעולם לא ממוזג אוטומטית.`,
  ].join('\n');
  const commitMessage = `fleet housekeeping: ${entry.title}\n\ncatalog-id: ${entry.id}`;
  return { title, body, commitMessage };
}
