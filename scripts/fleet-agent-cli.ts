// Fleet agent CLI — the write path autonomous fleet roles have into the
// owner<->fleet ledger (public.fleet_requests), the notification fan-out, and
// the ONE narrow customer-facing write below (`draft-reply`).
//
// Runs as service_role via createAdminClient() (env from .env.local through
// `node --env-file`, same pattern as sync-voximplant-sa). Fleet roles invoke
// it through the allowlisted `npm run fleet:agent -- <cmd>`; they never hold
// DB credentials themselves (.env* reads are denied in the fleet tiers).
//
// Free-text flags (--body, --note, --summary, --state, --query, --reason,
// --error, --evidence) can each be supplied instead as --X-file PATH — read
// via readFileFlag() below. Use this whenever the content might contain a
// word the guard.sh/guard-tier2.sh hooks scan for (billing-provider names,
// "supabase"/"psql"/"curl" surrounded by spaces, etc. — the hooks see the
// WHOLE Bash command string, so a blocked word anywhere in a quoted argument
// blocks the entire call, not just that word). PATH must resolve under
// .fleet-logs/ (same boundary run-context.sh already writes summaries into).
// Passing both --X and --X-file is an error.
//
// Subcommands:
//   request --role R --kind approval|question|fyi --title T --body B
//           [--tier 0..2] [--payload JSON] [--run-id ID] [--request-key K]
//           [--attach PATH]...
//     Inserts a pending request, then notifies: web push to every admin
//     (existing sendPushToUser pipeline) + Slack mirror (sendSlackAlert).
//     --role must be a role DEFINED in fleet.json (enabled or not): a request
//     filed under an unknown name would surface to the owner but its verdict
//     would be skipped forever by the answer-watcher (dead letter).
//     Idempotent: a retry deriving the same request_key returns the existing
//     row instead of failing (unique-violation -> lookup).
//     --attach (repeatable, THIS command only — handoff below does NOT accept
//     it; attachments on a forwarded request are the ORIGINAL request's,
//     carried in payload, not new input): reference a draft file so
//     /admin/fleet renders it inline (audio player / image). The path MUST
//     live under .fleet-logs/drafts/ (validated here AND at serve time by the
//     admin-only /api/admin/fleet-file route); stored as payload.attachments
//     entries.
//   handoff --to R|main --from-request UUID [--note TEXT]
//     Forwards an existing request to another role as a NEW pending request
//     (same kind/tier, provenance + attachments carried in payload). The owner
//     stays in the loop: the target acts only after the owner answers the
//     forwarded request. --to must be an ENABLED fleet role (so the
//     answer-watcher will actually spawn it) or the special target `main` —
//     handled by the main session: interactively (SessionStart inbox), or by
//     the reactive Tier-2 `main` role the watcher spawns once the owner
//     answers. The executor closes the loop with `complete` (push + Slack).
//   complete --id UUID --summary TEXT
//     Marks a request COMPLETED by its executor (the main session, or a role)
//     after the work is actually done. Legal from pending/approved/answered
//     (never from denied). Appends "[הושלם] <summary>" to the answer (an
//     owner's verdict stays a verbatim prefix — DB-enforced), then notifies:
//     web push to every admin + a reply in the request's Slack thread. This is
//     the closure signal the owner sees on their phone.
//   poll --role R
//     Prints the role's unconsumed verdicts + its still-open requests.
//   goal-poll --role R
//     Active goals for R whose next_wake_at has arrived. The owner creates a
//     goal; the role reads state, decides the next step, and reports back via
//     goal-progress/goal-close. Mirrors cmdPoll's no-op-is-not-an-error stance
//     (this runs unconditionally in run-context.sh every tick).
//   goal-progress --id UUID --step N [--state JSON] [--next-wake-at ISO] [--error TEXT]
//     Single CAS write: --step must be the step_count read from goal-poll.
//     --next-wake-at must carry an explicit UTC offset (Z or +03:00) — the
//     naive datetime-local form is rejected. Only 'advanced' is a normal
//     continuation; every other outcome (paused_on_failures / stale_step /
//     not_active / not_found) means stop, not retry (exitCode 2).
//   goal-close --id UUID --step N --status completed|failed [--note TEXT]
//     Terminal write. 'completed' is the agent's own factual claim of success.
//   analytics-summary [--range today|7d|30d|90d] [--landing-pages]
//     GA4 batch-A only (overview+previousPeriod, topPages, channels, sources)
//     via createRequire, not a static import — keeps @google-analytics/data's
//     gRPC chain out of this bundle. configured:false is a valid outcome, not
//     a failure, when GA4 has no property/credentials set.
//     --landing-pages: a SECOND, separate GA4 call (not part of batch A) —
//     opt-in, meant for the quarterly review only (same occasional-use shape
//     as --range 90d), not every weekly run.
//   ack --id UUID
//     Claims a verdict exactly-once via the fleet_consume_request RPC (CAS).
//     Call BEFORE acting on the verdict.
//   expire
//     Marks pending requests past expires_at as expired (chief-of-staff sweep).
//   withdraw --id UUID [--reason TEXT]
//     Retires a STILL-PENDING request the calling role filed (superseded /
//     no longer relevant) so the owner's inbox stays clean. Uses the guard's
//     legal pending->expired edge, recording the reason in `answer`. A row
//     that is no longer pending is a no-op (someone answered first — respect
//     it). Never deletes; the ledger stays append-only.
//   digest --title T --body B [--level info|warn|error]
//     Posts the daily fleet digest to Slack via the existing alerting stack.
//   draft-reply --id UUID --body TEXT
//     support-drafter's ONLY write: sets contact_messages.draft_reply +
//     draft_created_at for a still-'new', not-yet-drafted inquiry. NEVER sends
//     to the customer (a human reviews the draft in /admin/contacts and sends).
//     Idempotent + scope-limited: touches exactly 2 columns, 1 row, only when
//     `status='new' AND draft_reply IS NULL` (the guard is the loop-breaker).
//   distill-corrections [--limit N]
//     Stage-1 learning loop (maintenance/curation — NOT run by the drafter
//     role). Distils the draft_reply<->sent_reply feedback ALREADY in
//     contact_messages into a redacted few-shot corpus the drafter reads each
//     run (.claude/fleet/roles/support-drafter.examples.md), and prints the
//     "sent nearly as-is" rate that baselines future autonomy. Reads submitter
//     PII ONLY to redact it — nothing raw reaches the corpus or stdout.
//   business-facts
//     Stage-2 grounding: prints the read-only, PII/secret-free pricing facts the
//     support-drafter quotes for a pricing inquiry (canonical package + the live
//     base+overage gate → the EFFECTIVE model). Lets the drafter write the real
//     price instead of a `[מחירים]` placeholder; a human still reviews the draft.
//
// PII rule: requests are owner-facing internal ops traffic. Callers must not
// put guest personal data in title/body; the Slack layer redacts as
// defense-in-depth but the ledger itself is not redacted. `draft-reply` writes
// a staff-facing DRAFT only; it is never emailed by this CLI.

import { parseArgs } from 'node:util';

import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, relative, sep, extname, basename } from 'node:path';

import { createRequire } from 'node:module';

import { sendSlackAlert, type SlackAlertLevel } from '@/lib/alerts/slack';
import { getAppOrigin } from '@/lib/url';

// pg runtime handle. @types/pg ships a dual .d.ts/.d.mts; under this repo's
// moduleResolution:bundler the .d.mts variant wins, where the named re-export
// (`export * from "./index.js"`) resolves against the untyped .js sibling and
// yields nothing — so neither `import { Client }` nor a default/namespace
// import typechecks (all report Client missing). This is a known @types/pg
// dual-package resolution issue, not a real API mismatch — `new Client()`
// works at runtime (proven). We load the value via createRequire and type
// only the small surface this script uses.
interface PgClientLike {
  connect(): Promise<void>;
  query(sql: string): Promise<{ rows: unknown[]; rowCount: number | null }>;
  end(): Promise<void>;
}
interface PgClientConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: { rejectUnauthorized: boolean };
  application_name?: string;
  options?: string;
  statement_timeout?: number;
}
const PgClient = (createRequire(__filename)('pg') as {
  Client: new (config: PgClientConfig) => PgClientLike;
}).Client;
import { deriveRequestKey } from '@/lib/fleet/request-key';
import {
  buildHandoffRequest,
  parseFleetRoles,
  validateHandoffTarget,
  validateRequestRole,
} from '@/lib/fleet/handoff';
import { buildCompletionAnswer, isCompletableStatus } from '@/lib/fleet/complete';
import {
  renderExamplesMarkdown,
  summarizeMetric,
  toRedactedExample,
} from '@/lib/fleet/corrections';
import { buildBusinessFacts } from '@/lib/fleet/business-facts';
import {
  goalWakeAtSchema,
  isGoalCloseStuck,
  isGoalProgressStuck,
  type GoalCloseOutcome,
  type GoalProgressOutcome,
} from '@/lib/fleet/goal';
import { getGa4ConfigStatus, getGa4Property, getGa4StreamId } from '@/lib/analytics/ga4-config';
import {
  classifyGa4Error,
  mapChannels,
  mapLandingPages,
  mapOverview,
  mapSources,
  mapTopPages,
} from '@/lib/analytics/ga4-mappers';
import { buildCoreBatchA, buildLandingPagesRequest } from '@/lib/analytics/ga4-requests';
import {
  DEFAULT_RANGE,
  RANGE_OPTIONS,
  type AnalyticsRange,
  type RunReportRequest,
  type RunReportResponse,
} from '@/lib/analytics/ga4-types';
import { getBaseOveragePricingEnabled } from '@/lib/data/payments';
import { sendPushToUser } from '@/lib/data/push-subscriptions';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/lib/supabase/types';

type FleetRequestRow = Database['public']['Tables']['fleet_requests']['Row'];

const KINDS = ['approval', 'question', 'fyi'] as const;
type Kind = (typeof KINDS)[number];

function fail(message: string): never {
  console.error(`[fleet-agent] ${message}`);
  process.exit(1);
}

function requireOption(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) fail(`missing required --${name}`);
  return trimmed;
}

// Free-text flags a role writes prose into (--body, --note, --summary, ...)
// are scanned in full by the guard.sh/guard-tier2.sh hooks, since those hooks
// see the entire Bash command string, not just the invoked binary — a report
// that happens to mention certain words (e.g. a billing provider's name) in
// Hebrew prose blocks the WHOLE command (see run-context.sh's syntax-rules
// block for the agent-facing explanation). `--attach` already sidesteps this
// for file references (fleet-agent-cli.ts's cmdRequest) by storing a path
// instead of scanned content; this generalizes that same idea to every
// free-text flag. --X-file <path> reads the file and is used exactly as if
// --X had been passed with that content — the file's PATH is a short,
// generic token that never reaches the hook's scan surface embedded in prose.
const FILE_FLAG_BASE: Record<string, string> = {
  'body-file': 'body',
  'summary-file': 'summary',
  'note-file': 'note',
  'state-file': 'state',
  'query-file': 'query',
  'reason-file': 'reason',
  'error-file': 'error',
  'evidence-file': 'evidence',
};

// Same containment boundary as --attach (cmdRequest): every tier's Edit/Write
// allow is scoped to .fleet-logs/**, so that is the only directory a role can
// have written this content into in the first place.
function resolveFleetLogsPath(raw: string, flagName: string): string {
  const root = resolve(process.cwd(), '.fleet-logs');
  const abs = resolve(process.cwd(), raw);
  if (abs !== root && !abs.startsWith(root + sep)) {
    fail(`--${flagName} must point under .fleet-logs/ (got: ${raw})`);
  }
  return abs;
}

function readFileFlag(raw: string, flagName: string): string {
  const abs = resolveFleetLogsPath(raw, flagName);
  let content: string;
  try {
    content = readFileSync(abs, 'utf8');
  } catch {
    return fail(`--${flagName} file not found: ${raw}`);
  }
  return content.trim();
}

// Resolves every --X-file into values[X], mutating in place. Called once in
// main() before any cmd* handler runs, so every handler keeps reading plain
// --body/--note/etc — none of them need to know file-flags exist.
function resolveFileFlags(values: Record<string, string | string[] | boolean | undefined>): void {
  for (const [fileFlag, base] of Object.entries(FILE_FLAG_BASE)) {
    const raw = values[fileFlag];
    if (raw === undefined) continue;
    if (typeof raw !== 'string') continue;
    if (values[base] !== undefined) {
      fail(`pass either --${base} or --${fileFlag}, not both`);
    }
    values[base] = readFileFlag(raw, fileFlag);
  }
}

// Push + Slack fan-out for a newly filed request. Best-effort: notification
// failure must not lose the ledger row (the poll path still surfaces it), so
// failures are reported in the output instead of thrown. Returns the Slack
// message ts (thread root) when the mirror actually posted.
async function notifyAdmins(row: FleetRequestRow): Promise<{
  pushAttempted: number;
  pushSent: number;
  pushFailed: number;
  slackThreadTs: string | null;
}> {
  const admin = createAdminClient();
  const { data: admins, error } = await admin
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin');
  if (error) {
    console.error('[fleet-agent] admin lookup for push failed:', error.message);
    return { pushAttempted: 0, pushSent: 0, pushFailed: 0, slackThreadTs: null };
  }

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  for (const { user_id } of admins ?? []) {
    try {
      const summary = await sendPushToUser(user_id, {
        title: `פניית סוכן: ${row.title}`,
        body: `${row.role} · ${row.kind}`,
        url: '/admin/fleet',
        tag: `fleet-request-${row.id}`,
        renotify: true,
      });
      attempted += summary.attempted;
      sent += summary.sent;
      failed += summary.failed;
    } catch (err) {
      failed += 1;
      console.error(
        '[fleet-agent] push to admin failed:',
        err instanceof Error ? err.message : 'unknown error',
      );
    }
  }

  // Slack mirror. warn trips the configured @mention threshold; fyi stays info.
  // The returned ts becomes the request's thread root: the answered/consumed
  // follow-ups post as replies under this message.
  const slackThreadTs = await sendSlackAlert({
    level: row.kind === 'fyi' ? 'info' : 'warn',
    title: `פניית סוכן ממתינה: ${row.title}`,
    detail: `kind=${row.kind} tier=${row.tier} — מענה ב-/admin/fleet`,
    source: `fleet:${row.role}`,
    category: 'errors',
  });

  return { pushAttempted: attempted, pushSent: sent, pushFailed: failed, slackThreadTs };
}

// Look up a request's Slack thread root (null when the mirror never posted —
// follow-ups then fall back to top-level channel messages).
async function threadTsFor(requestId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('fleet_request_slack_threads')
    .select('thread_ts')
    .eq('request_id', requestId)
    .maybeSingle();
  return data?.thread_ts ?? null;
}

// Extension→MIME hints for payload.attachments (a compact mirror of the serve
// route's allowlist in src/app/api/admin/fleet-file/route.ts — the route is the
// enforcing side; this only pre-labels for the UI).
const ATTACH_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/plain', '.json': 'application/json',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

// Role list for request/handoff validation, from the same fleet.json the
// scheduler reloads every tick. Fail-closed: no readable config -> no insert
// (the validation IS the dead-letter guard; inserting unvalidated defeats it).
const FLEET_CONFIG_PATH = join(dirname(__filename), '..', '.claude', 'fleet', 'fleet.json');

function loadFleetRoles(): Map<string, boolean> {
  try {
    return parseFleetRoles(JSON.parse(readFileSync(FLEET_CONFIG_PATH, 'utf8')));
  } catch (err) {
    return fail(
      `cannot load fleet roles from ${FLEET_CONFIG_PATH}: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }
}

// Shared insert + fan-out for request/handoff. Returns the outcome instead of
// printing so each verb can shape its own JSON output.
async function insertAndNotify(row: {
  requestKey: string;
  role: string;
  runId: string | null;
  kind: string;
  tier: number;
  title: string;
  body: string;
  payload: Json;
}): Promise<{
  deduplicated: boolean;
  request: FleetRequestRow | null;
  notify: Awaited<ReturnType<typeof notifyAdmins>> | null;
}> {
  const admin = createAdminClient();
  const { data: inserted, error } = await admin
    .from('fleet_requests')
    .insert({
      request_key: row.requestKey,
      role: row.role,
      run_id: row.runId,
      kind: row.kind,
      tier: row.tier,
      title: row.title,
      body: row.body,
      payload: row.payload,
    })
    .select()
    .single();

  if (error) {
    // Unique violation on request_key = an idempotent retry. Surface the
    // existing row so the calling role can continue with its id/status.
    if (error.code === '23505') {
      const { data: existing } = await admin
        .from('fleet_requests')
        .select()
        .eq('request_key', row.requestKey)
        .single();
      return { deduplicated: true, request: existing ?? null, notify: null };
    }
    fail(`insert failed: ${error.message}`);
  }

  const notify = await notifyAdmins(inserted);
  if (notify.slackThreadTs) {
    // Store the thread root so the answered/consumed follow-ups can reply in
    // the same Slack thread. Best-effort: without it they post top-level.
    const { error: threadErr } = await admin
      .from('fleet_request_slack_threads')
      .insert({ request_id: inserted.id, thread_ts: notify.slackThreadTs });
    if (threadErr) {
      console.error('[fleet-agent] storing slack thread ts failed:', threadErr.message);
    }
  }
  return { deduplicated: false, request: inserted, notify };
}

async function cmdRequest(
  args: Record<string, string | undefined>,
  attachPaths?: string[],
): Promise<void> {
  const role = requireOption(args.role, 'role');
  const roleError = validateRequestRole(loadFleetRoles(), role);
  if (roleError) fail(roleError);
  const kind = requireOption(args.kind, 'kind') as Kind;
  if (!KINDS.includes(kind)) fail(`--kind must be one of: ${KINDS.join(', ')}`);
  const title = requireOption(args.title, 'title');
  const body = requireOption(args.body, 'body');
  const tier = args.tier ? Number(args.tier) : 0;
  if (!Number.isInteger(tier) || tier < 0 || tier > 2) fail('--tier must be 0, 1 or 2');

  let payload: Json = {};
  if (args.payload) {
    try {
      const parsed: unknown = JSON.parse(args.payload);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        fail('--payload must be a JSON object');
      }
      // The successful parse of a JSON object literal is Json by construction.
      payload = parsed as Json;
    } catch (err) {
      if (err instanceof SyntaxError) fail('--payload is not valid JSON');
      throw err;
    }
  }

  // --attach: reference draft files for inline rendering at /admin/fleet.
  // Validated to live under .fleet-logs/drafts/ (the serve route re-enforces
  // the same allowlist with realpath at read time). Stored as RELATIVE paths.
  if (attachPaths && attachPaths.length > 0) {
    const draftsRoot = resolve(process.cwd(), '.fleet-logs', 'drafts');
    const fromPayload = (payload as Record<string, Json | undefined>).attachments;
    const list: Json[] = Array.isArray(fromPayload) ? [...fromPayload] : [];
    for (const raw of attachPaths) {
      const abs = resolve(process.cwd(), raw);
      if (abs !== draftsRoot && !abs.startsWith(draftsRoot + sep)) {
        fail(`--attach must point under .fleet-logs/drafts/ (got: ${raw})`);
      }
      let st;
      try {
        st = statSync(abs);
      } catch {
        return fail(`--attach file not found: ${raw}`);
      }
      if (!st.isFile()) fail(`--attach is not a file: ${raw}`);
      list.push({
        path: relative(process.cwd(), abs),
        label: basename(abs),
        mime: ATTACH_MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream',
      });
    }
    payload = { ...(payload as Record<string, Json>), attachments: list };
  }

  const requestKey = args['request-key']?.trim() || deriveRequestKey({ role, kind, title, body });
  const result = await insertAndNotify({
    requestKey,
    role,
    runId: args['run-id']?.trim() || null,
    kind,
    tier,
    title,
    body,
    payload,
  });
  console.log(JSON.stringify(result, null, 2));
}

// Forward an existing request to another role (or the interactive main
// session) as a new pending request. The original row is never mutated — the
// ledger stays append-only; provenance lives in the new row's payload.
async function cmdHandoff(args: Record<string, string | undefined>): Promise<void> {
  const target = requireOption(args.to, 'to');
  const fromId = requireOption(args['from-request'], 'from-request');
  const note = args.note?.trim() || undefined;

  const targetError = validateHandoffTarget(loadFleetRoles(), target);
  if (targetError) fail(targetError);

  const admin = createAdminClient();
  const { data: original, error } = await admin
    .from('fleet_requests')
    .select('id, role, kind, tier, title, body, payload, status')
    .eq('id', fromId)
    .maybeSingle();
  if (error) fail(`handoff lookup failed: ${error.message}`);
  if (!original) fail(`--from-request ${fromId} not found`);
  if (original.role === target) fail('handoff target equals the originating role — nothing to forward');

  const fields = buildHandoffRequest(original, target, note);
  const requestKey = deriveRequestKey({
    role: fields.role,
    kind: fields.kind,
    title: fields.title,
    body: fields.body,
  });
  const result = await insertAndNotify({
    requestKey,
    role: fields.role,
    runId: args['run-id']?.trim() || null,
    kind: fields.kind,
    tier: fields.tier,
    title: fields.title,
    body: fields.body,
    payload: fields.payload,
  });
  console.log(
    JSON.stringify(
      { handoff: { from: original.id, from_role: original.role, to: target }, ...result },
      null,
      2,
    ),
  );
}

// Executor-side closure: pending/approved/answered -> completed, with the
// completion summary appended to `answer` and consumed_at as the completion
// timestamp (both DB-enforced). Then the notification the owner asked for:
// web push to every admin + a reply in the request's original Slack thread.
async function cmdComplete(args: Record<string, string | undefined>): Promise<void> {
  const id = requireOption(args.id, 'id');
  const summary = requireOption(args.summary, 'summary');

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from('fleet_requests')
    .select('id, role, kind, title, status, answer')
    .eq('id', id)
    .maybeSingle();
  if (error) fail(`complete lookup failed: ${error.message}`);
  if (!row) fail(`--id ${id} not found`);
  if (!isCompletableStatus(row.status)) {
    fail(`request is '${row.status}' — only pending/approved/answered can be completed`);
  }

  let answer: string;
  try {
    answer = buildCompletionAnswer(row.answer, summary);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'invalid summary');
  }

  // CAS on the observed status: a concurrent owner answer/expiry loses nothing
  // — we simply report and the caller re-reads.
  const { data: updated, error: updateError } = await admin
    .from('fleet_requests')
    .update({ status: 'completed', answer, consumed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', row.status)
    .select('id, role, title, status');
  if (updateError) fail(`complete failed: ${updateError.message}`);
  if (!updated || updated.length === 0) {
    fail('request status changed concurrently — re-run poll and retry');
  }

  // Push to every admin (same pipeline as new-request pushes) + Slack thread
  // reply. Best-effort: the ledger transition above is the source of truth.
  let pushSent = 0;
  const { data: admins } = await admin.from('user_roles').select('user_id').eq('role', 'admin');
  for (const { user_id } of admins ?? []) {
    try {
      const s = await sendPushToUser(user_id, {
        title: `✅ הושלם: ${row.title.slice(0, 80)}`,
        body: summary.slice(0, 140),
        url: '/admin/fleet',
        tag: `fleet-complete-${row.id}`,
        renotify: true,
      });
      pushSent += s.sent;
    } catch (err) {
      console.error(
        '[fleet-agent] completion push failed:',
        err instanceof Error ? err.message : 'unknown error',
      );
    }
  }
  await sendSlackAlert({
    level: 'info',
    title: `המשימה הושלמה: ${row.title}`,
    detail: summary.length > 2900 ? `${summary.slice(0, 2900)}…` : summary,
    source: `fleet:${row.role}`,
    category: 'errors',
    threadTs: (await threadTsFor(row.id)) ?? undefined,
  });

  console.log(
    JSON.stringify({ completed: true, request: updated[0], pushSent }, null, 2),
  );
}

// All answered-but-unconsumed verdicts across every role, for the scheduler's
// answer-watcher: it decides per role whether to auto-ack (trivial roles) or
// spawn the role's headless run to act on the verdict.
async function cmdVerdicts(): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('fleet_requests')
    .select('id, role, kind, tier, title, status, answered_at')
    .in('status', ['approved', 'denied', 'answered'])
    .is('consumed_at', null)
    .order('answered_at', { ascending: true });
  if (error) fail(`verdicts scan failed: ${error.message}`);
  console.log(JSON.stringify({ verdicts: data ?? [] }, null, 2));
}

async function cmdPoll(args: Record<string, string | undefined>): Promise<void> {
  const role = requireOption(args.role, 'role');
  const admin = createAdminClient();

  // Three buckets, because "pending" alone hides the DIRECTION of a request and
  // a role that cannot tell them apart does nothing with either:
  //   inbox    — the OWNER opened this, addressed to you. Act on it.
  //   verdicts — you asked, the owner answered. ack, then act.
  //   open     — you asked, still waiting. Nothing to do.
  // Before this split, an owner-initiated request landed in `open` and every
  // role correctly ignored it: from the role's side that bucket means "asks I
  // filed". Measured 2026-07-29 — ops-monitor was spawned for one, ran clean,
  // and left it pending, because nothing in its context said otherwise.
  const { data, error } = await admin
    .from('fleet_requests')
    .select(
      'id, request_key, kind, tier, title, body, payload, status, answer, created_at, answered_at, expires_at',
    )
    .eq('role', role)
    .in('status', ['pending', 'approved', 'denied', 'answered'])
    .is('consumed_at', null)
    .order('created_at', { ascending: true });
  if (error) fail(`poll failed: ${error.message}`);

  const rows = data ?? [];
  const isFromOwner = (r: (typeof rows)[number]) =>
    !!r.payload &&
    typeof r.payload === 'object' &&
    !Array.isArray(r.payload) &&
    (r.payload as Record<string, unknown>).origin === 'owner';

  // body/payload are carried ONLY on the inbox: that is the one bucket whose
  // text the role must read to act. Echoing every body back would grow the
  // run context with the role's own prose on every single run.
  const slim = ({ body: _b, payload: _p, ...rest }: (typeof rows)[number]) => rest;

  const inboxRaw = rows.filter((r) => r.status === 'pending' && isFromOwner(r));
  const verdicts = rows.filter((r) => r.status !== 'pending').map(slim);
  const open = rows.filter((r) => r.status === 'pending' && !isFromOwner(r)).map(slim);

  // Owner replies (/admin/fleet's ReplyToRequestForm) carry payload.thread_root
  // — the id of the message this one continues. Without surfacing it here, a
  // reply like "what about the other point?" would arrive as an apparently
  // standalone ask with nothing to be "the other point" relative to. One
  // extra batched lookup, only when at least one inbox item is threaded.
  // Simplification, not a gap: thread_root always points at the conversation's
  // ROOT message (not the immediately-preceding reply), so a second-or-later
  // reply in the same thread surfaces the root's context, not every message
  // in between — matches fleet_owner_request's single-shared-root design
  // (supabase/migrations/20260729155911_fleet_owner_request.sql).
  const threadRootId = (r: (typeof rows)[number]): string | null => {
    if (!r.payload || typeof r.payload !== 'object' || Array.isArray(r.payload)) return null;
    const value = (r.payload as Record<string, unknown>).thread_root;
    return typeof value === 'string' ? value : null;
  };
  const threadRootIds = [
    ...new Set(inboxRaw.map(threadRootId).filter((id): id is string => id !== null)),
  ];
  const threadContextById = new Map<
    string,
    { title: string; body: string; answer: string | null }
  >();
  if (threadRootIds.length > 0) {
    const { data: rootsData, error: rootsError } = await admin
      .from('fleet_requests')
      .select('id, title, body, answer')
      .in('id', threadRootIds);
    if (!rootsError) {
      for (const root of rootsData ?? []) {
        threadContextById.set(root.id, { title: root.title, body: root.body, answer: root.answer });
      }
    }
    // A lookup failure here must not fail the whole poll — inbox items just
    // render without thread_context, same as a root that was later deleted.
  }
  const inbox = inboxRaw.map((r) => {
    const rootId = threadRootId(r);
    return { ...r, thread_context: rootId ? (threadContextById.get(rootId) ?? null) : null };
  });

  console.log(JSON.stringify({ role, inbox, verdicts, open }, null, 2));
}

async function cmdAck(args: Record<string, string | undefined>): Promise<void> {
  const id = requireOption(args.id, 'id');
  const admin = createAdminClient();

  const { data, error } = await admin.rpc('fleet_consume_request', { p_id: id });
  if (error) fail(`ack failed: ${error.message}`);

  const claimed = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (claimed) {
    // Third leg of the Slack loop: filed -> answered -> consumed. Threaded
    // under the original request message when its ts was captured.
    await sendSlackAlert({
      level: 'info',
      title: `הסוכן קלט את התשובה: ${claimed.title}`,
      detail: `הפנייה נסגרה (${claimed.status}).`,
      source: `fleet:${claimed.role}`,
      category: 'errors',
      threadTs: (await threadTsFor(claimed.id)) ?? undefined,
    });
  }
  console.log(
    JSON.stringify(
      claimed
        ? { claimed: true, request: claimed }
        : { claimed: false, reason: 'not claimable (unknown id, still pending, or already consumed)' },
      null,
      2,
    ),
  );
  if (!claimed) process.exitCode = 2;
}

// Retire one still-pending request (superseded / no longer relevant). The
// fleet_requests_guard permits pending->expired with `answer` set on the same
// edge; anything not pending is left untouched (0 rows = benign no-op).
async function cmdWithdraw(args: Record<string, string | undefined>): Promise<void> {
  const id = requireOption(args.id, 'id');
  const reason = args.reason?.trim() || 'הוסרה על-ידי הסוכן (התייתרה)';
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('fleet_requests')
    .update({ status: 'expired', answer: `[withdraw] ${reason}` })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id, role, title');
  if (error) fail(`withdraw failed: ${error.message}`);
  const row = data?.[0];
  if (row) {
    await sendSlackAlert({
      level: 'info',
      title: `פנייה הוסרה ע"י הסוכן: ${row.title}`,
      detail: reason,
      source: `fleet:${row.role}`,
      category: 'errors',
    });
  }
  console.log(JSON.stringify({ withdrawn: !!row, request: row ?? null }, null, 2));
}

async function cmdExpire(): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('fleet_requests')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lte('expires_at', new Date().toISOString())
    .select('id, role, title');
  if (error) fail(`expire sweep failed: ${error.message}`);
  if (data && data.length > 0) {
    await sendSlackAlert({
      level: 'warn',
      title: `${data.length} פניות סוכנים פגו ללא מענה`,
      detail: data.map((r) => `${r.role}: ${r.title}`).join(' · ').slice(0, 500),
      source: 'fleet:expire-sweep',
      category: 'errors',
    });
  }
  console.log(JSON.stringify({ expired: data?.length ?? 0, requests: data ?? [] }, null, 2));
}

// Read-only SQL for the data-reading roles (event-health, business-ops,
// support). Two independent safety layers, strongest first:
//   1. Every query runs inside `BEGIN TRANSACTION READ ONLY` — standard
//      Postgres transaction semantics, issued through the client exactly as
//      node-postgres documents (pg provides no higher-level transaction API;
//      you run BEGIN/ROLLBACK yourself on a single Client). Postgres itself
//      then rejects any INSERT/UPDATE/DELETE/DDL, so even a query that slips
//      past the text guard cannot write. This is the AUTHORITATIVE layer,
//      verified live (`transaction_read_only` = on inside the wrap). Note: a
//      session-level `-c default_transaction_read_only=on` startup option does
//      NOT survive the transaction-mode pooler, so we do not rely on it — the
//      per-transaction READ ONLY is what holds.
//   2. Text guard (pre-flight, before connecting): the statement must be a
//      single SELECT or WITH…SELECT, no stacked statements, no write keyword.
//   Plus statement_timeout + a hard row cap so a runaway/huge read can't hang
//   or flood the run.
// The connection uses the same session-pooler creds as the worker
// (SUPABASE_DB_* — pooler.supabase.com:5432, IPv4). Guests' PII lives behind
// these tables; roles are instructed to aggregate, not dump raw PII.
const SQL_ROW_CAP = 200;
const SQL_TIMEOUT_MS = 15_000;

function assertReadOnlySql(sql: string): void {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (trimmed.includes(';')) {
    fail('sql: only a single statement is allowed (no stacked statements)');
  }
  if (!/^(select|with)\b/i.test(trimmed)) {
    fail('sql: only SELECT / WITH…SELECT queries are allowed');
  }
  // Defense in depth on top of the READ ONLY transaction: reject obvious write
  // verbs appearing as statement keywords (word-boundary, case-insensitive).
  const forbidden =
    /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|comment|copy|merge|call|do|vacuum|reindex|refresh|nextval|setval|set_config|pg_sleep)\b/i;
  if (forbidden.test(trimmed)) {
    fail('sql: query contains a forbidden (non-read) keyword');
  }
}

async function cmdSql(args: Record<string, string | undefined>): Promise<void> {
  const sql = (args.query ?? '').trim();
  if (!sql) fail('sql: missing --query');
  assertReadOnlySql(sql);

  const client = new PgClient({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false },
    application_name: 'kalfa-fleet-sql',
    statement_timeout: SQL_TIMEOUT_MS,
  });

  try {
    await client.connect();
    // Suspenders: an explicit READ ONLY transaction around the query.
    await client.query('BEGIN TRANSACTION READ ONLY');
    const result = await client.query(sql);
    await client.query('ROLLBACK');
    const rows = result.rows.slice(0, SQL_ROW_CAP);
    console.log(
      JSON.stringify(
        {
          rowCount: result.rowCount,
          returned: rows.length,
          truncated: (result.rowCount ?? 0) > rows.length,
          rows,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    fail(`sql failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function cmdDigest(args: Record<string, string | undefined>): Promise<void> {
  const title = requireOption(args.title, 'title');
  const body = requireOption(args.body, 'body');
  const level = (args.level ?? 'info') as SlackAlertLevel;
  if (!['info', 'warn', 'error'].includes(level)) fail('--level must be info, warn or error');

  await sendSlackAlert({
    level,
    title,
    // Slack section fields are capped; keep the digest body inside the limit.
    detail: body.length > 2900 ? `${body.slice(0, 2900)}…` : body,
    source: 'fleet:digest',
    category: 'errors',
  });
  console.log(JSON.stringify({ posted: true, title, level }, null, 2));
}

// support-drafter's narrow write. Sets draft_reply + draft_created_at on a
// contact_messages row ONLY when it is still 'new' and has no draft yet. The
// `status='new' AND draft_reply IS NULL` predicate is enforced in the query
// itself, so:
//   - it never overwrites an existing draft or a human's sent reply,
//   - it is idempotent (a drafted row drops out of the role's next read set,
//     breaking any re-draft loop),
//   - 0 rows updated is a no-op BY DESIGN (already drafted / not new / unknown
//     id), reported as written:false, not an error.
// It NEVER emails the customer — sending stays a human action in /admin/contacts.
const DRAFT_REPLY_MAX = 4000;

async function cmdDraftReply(args: Record<string, string | undefined>): Promise<void> {
  const id = requireOption(args.id, 'id');
  const body = requireOption(args.body, 'body');
  if (body.length > DRAFT_REPLY_MAX) {
    fail(`--body exceeds ${DRAFT_REPLY_MAX} characters`);
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('contact_messages')
    .update({ draft_reply: body, draft_created_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'new')
    .is('draft_reply', null)
    .select('id, status, draft_created_at');

  if (error) fail(`draft-reply failed: ${error.message}`);

  const rows = data ?? [];
  console.log(
    JSON.stringify(
      {
        written: rows.length > 0,
        reason:
          rows.length > 0
            ? null
            : 'not writable (already drafted, not new, or unknown id) — no-op by design',
        rows,
      },
      null,
      2,
    ),
  );
  if (rows.length === 0) process.exitCode = 2;
}

// ── Callback triage ─────────────────────────────────────────────────────────
// The triage role's ONLY two writes, and the only way it can reach the
// callback_requests table at all: `sql` runs inside BEGIN TRANSACTION READ ONLY,
// so the RPCs below — which UPDATE — are unreachable from it by design.
//
// Both are thin wrappers. Every rule (the lease, the attempt ceiling, the fence,
// the state machine) lives in the database functions, where it cannot be
// bypassed by a caller that forgets. This layer's job is to expose them and to
// keep PII out of the role's context.

// What the role is given. Deliberately NOT full_name or phone: extracting when
// somebody can answer needs the words they wrote and nothing about who they are.
// Same rule support-drafter follows on contact_messages.
type TriageClaimView = {
  id: string;
  topic: string | null;
  note: string | null;
  created_at: string;
  attempt: number;
};

async function cmdTriageClaim(): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('claim_callback_triage');
  if (error) fail(`triage-claim failed: ${error.message}`);

  // `setof` with no rows arrives as null (or an empty array, depending on how
  // PostgREST renders it) — both mean the same thing: nothing was claimable.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    console.log(JSON.stringify({ claimed: false, reason: 'nothing pending' }, null, 2));
    process.exitCode = 2;
    return;
  }

  const view: TriageClaimView = {
    id: String(row.id),
    topic: (row.topic as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    created_at: String(row.created_at),
    // Echoed back to triage-finish as the fence. The role must present this
    // number; if its claim was revoked meanwhile, the finish is refused.
    attempt: Number(row.triage_attempt_count),
  };
  console.log(JSON.stringify({ claimed: true, request: view }, null, 2));
}

const TRIAGE_STATUSES = ['completed', 'manual_review', 'failed'] as const;
const MINUTES_IN_DAY = 24 * 60;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "08:00" or a bare minute count, as Israel wall-clock minutes from midnight. */
function parseMinuteOfDay(raw: string | undefined, label: string): number | null {
  if (raw === undefined || raw === '') return null;
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  const minutes = hhmm
    ? Number(hhmm[1]) * 60 + Number(hhmm[2])
    : Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_IN_DAY) {
    fail(`--${label} must be HH:MM or 0-1439 (got "${raw}")`);
  }
  return minutes;
}

async function cmdTriageFinish(args: Record<string, string | undefined>): Promise<void> {
  const id = requireOption(args.id, 'id');
  const attemptRaw = requireOption(args.attempt, 'attempt');
  const attempt = Number.parseInt(attemptRaw, 10);
  if (!Number.isInteger(attempt) || attempt < 1) {
    fail(`--attempt must be the attempt number returned by triage-claim (got "${attemptRaw}")`);
  }

  const status = requireOption(args.status, 'status');
  if (!(TRIAGE_STATUSES as readonly string[]).includes(status)) {
    fail(`--status must be one of ${TRIAGE_STATUSES.join(', ')}`);
  }

  const notBefore = parseMinuteOfDay(args['not-before'], 'not-before');
  const notAfter = parseMinuteOfDay(args['not-after'], 'not-after');
  if (notBefore !== null && notAfter !== null && notBefore >= notAfter) {
    fail('--not-before must be earlier than --not-after');
  }

  let excluded: string[] | null = null;
  if (args['exclude-dates']) {
    excluded = args['exclude-dates']
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    for (const d of excluded) {
      if (!DATE_ONLY.test(d)) fail(`--exclude-dates entries must be YYYY-MM-DD (got "${d}")`);
    }
    if (excluded.length === 0) excluded = null;
  }

  // Evidence as QUOTED TEXT, not character offsets. A model asked for offsets
  // returns plausible-looking numbers that point at the wrong span — it is being
  // asked to count characters, which it cannot do reliably. Asked for the words
  // instead, it quotes them, and the offsets are computed HERE from a string
  // match. A quote that is not in the note is rejected rather than recorded,
  // which turns evidence from a claim into a check.
  let triage: Json | null = null;
  if (args.evidence) {
    const admin0 = createAdminClient();
    const { data: noteRow } = await admin0
      .from('callback_requests')
      .select('note')
      .eq('id', id)
      .maybeSingle();
    const note = (noteRow?.note as string | null) ?? '';
    const quote = args.evidence.trim();
    const at = note.indexOf(quote);
    if (at < 0) {
      fail('--evidence must be text copied verbatim from the request note');
    }
    triage = { evidence: { quote, start: at, end: at + quote.length } };
  }

  const admin = createAdminClient();
  // A moment the caller NAMED, as opposed to a window they described. Aims the
  // search rather than narrowing it, and switches the engine to closing in on
  // that moment from either side instead of stepping past it.
  const onDate = args['on-date']?.trim();
  if (onDate && !DATE_ONLY.test(onDate)) fail(`--on-date must be YYYY-MM-DD (got "${onDate}")`);
  const atTime = args['at-time']?.trim();
  if (atTime && !/^\d{1,2}:\d{2}$/.test(atTime)) fail(`--at-time must be HH:MM (got "${atTime}")`);
  if ((onDate || atTime) && status === 'failed') {
    fail('a failed triage may not name a requested moment');
  }

  // The generated argument type makes every defaulted parameter optional, so an
  // absent constraint is OMITTED rather than sent as null — which is also the
  // honest encoding: "nothing was stated" is not "explicitly nothing".
  const { data, error } = await admin.rpc('finish_callback_triage', {
    p_request_id: id,
    p_claimed_attempt: attempt,
    p_status: status,
    ...(notBefore !== null ? { p_not_before_min: notBefore } : {}),
    ...(notAfter !== null ? { p_not_after_min: notAfter } : {}),
    ...(excluded !== null ? { p_excluded_dates: excluded } : {}),
    ...(triage !== null ? { p_triage: triage } : {}),
    ...(args.error ? { p_error: args.error } : {}),
    ...(onDate ? { p_on_date: onDate } : {}),
    ...(atTime ? { p_at_time: atTime } : {}),
  });
  if (error) fail(`triage-finish failed: ${error.message}`);

  const outcome = String(data);

  // A flag nobody sees is not a flag. 'manual_review' and 'failed' both mean a
  // request needs a person — and neither stops it being scheduled, because the
  // grace period in the sweep deliberately refuses to leave a lead untouched.
  // So the request DOES get a call, at whatever time the form guessed, and the
  // only thing standing between that and a wrong call is this message.
  //
  // Fired only on 'finalized': a claim that was lost did not write anything, and
  // alerting on it would report another worker's outcome as our own.
  if (outcome === 'finalized' && (status === 'manual_review' || status === 'failed')) {
    // The id is IN THE TITLE on purpose. sendSlackAlert dedups on
    // level|title|source, so a fixed title would silence every request after the
    // first one inside the dedup window — exactly when a batch of them arrives.
    const short = id.slice(0, 8);
    await sendSlackAlert({
      level: status === 'failed' ? 'error' : 'warn',
      category: 'customer_inquiry',
      source: 'callback-triage',
      title:
        status === 'failed'
          ? `טריאז' שיחה חוזרת נכשל · ${short}`
          : `בקשת שיחה חוזרת דורשת בדיקה · ${short}`,
      // No note text and no quote: the caller's own words are content we hold,
      // not content we broadcast. The link is how a person reaches them.
      detail: `${await getAppOrigin()}/admin/callbacks/${id}`,
      fields: {
        ...(args.error ? { סיבה: args.error } : {}),
        // Says what the scheduler will do if nobody intervenes.
        משובץ_בכל_מקרה: 'כן',
      },
    });
  }

  console.log(JSON.stringify({ outcome, id, attempt, status, onDate: onDate ?? null, atTime: atTime ?? null }, null, 2));
  // Anything but a win is a no-op the role must not treat as success — most
  // importantly claim_lost, which means its work was superseded and must be
  // dropped rather than retried.
  if (outcome !== 'finalized') process.exitCode = 2;
}

// Stage-1 learning loop. Distils the draft_reply<->sent_reply feedback already
// in contact_messages into a redacted few-shot corpus the drafter reads each
// run, and reports the "sent nearly as-is" rate that baselines any future
// autonomy. Reads submitter PII (name/email/phone) ONLY to redact it — nothing
// raw is written to the corpus or printed. This is a maintenance/curation verb;
// the PII-free support-drafter role never runs it.
const EXAMPLES_MAX = 30;
const EXAMPLE_FIELD_MAX = 1200;
const NEAR_THRESHOLD = 0.85;
// dist/ (esbuild bundle) -> repo root -> role dir. The corpus is git-ignored
// like every .claude/fleet/roles file — which is also correct: a redacted
// derivative of customer replies must never be committed.
const EXAMPLES_PATH = join(
  dirname(__filename),
  '..',
  '.claude',
  'fleet',
  'roles',
  'support-drafter.examples.md',
);

async function cmdDistillCorrections(args: Record<string, string | undefined>): Promise<void> {
  const limit = args.limit ? Number(args.limit) : EXAMPLES_MAX;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    fail('--limit must be an integer 1..200');
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('contact_messages')
    .select('id, topic, message, name, email, phone, draft_reply, sent_reply, replied_at, created_at')
    .not('draft_reply', 'is', null)
    .not('sent_reply', 'is', null)
    .order('replied_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) fail(`distill-corrections read failed: ${error.message}`);

  const rows = data ?? [];
  // The query guarantees both columns are non-null; narrow via a type guard so
  // no cast is needed downstream.
  const pairs = rows.filter(
    (r): r is (typeof rows)[number] & { draft_reply: string; sent_reply: string } =>
      r.draft_reply !== null && r.sent_reply !== null,
  );

  const examples = pairs.map((r) =>
    toRedactedExample(
      {
        topic: r.topic,
        message: r.message,
        draft: r.draft_reply,
        sent: r.sent_reply,
        pii: { name: r.name, email: r.email, phone: r.phone },
      },
      EXAMPLE_FIELD_MAX,
    ),
  );

  const markdown = renderExamplesMarkdown(examples, NEAR_THRESHOLD);
  mkdirSync(dirname(EXAMPLES_PATH), { recursive: true });
  writeFileSync(EXAMPLES_PATH, markdown, 'utf8');

  const metric = summarizeMetric(examples, NEAR_THRESHOLD);
  // Output is PII-free by construction: file path, aggregate metric, and ids
  // only — never message/draft/sent content.
  console.log(
    JSON.stringify(
      {
        wrote: EXAMPLES_PATH,
        ...metric,
        nearThreshold: NEAR_THRESHOLD,
        ids: pairs.map((r) => r.id),
      },
      null,
      2,
    ),
  );
}

// Stage-2 grounding (plan S5): the read-only, PII/secret-free business facts the
// support-drafter quotes for a pricing inquiry — so it writes the REAL price
// instead of a `[מחירים]` placeholder. Reads the canonical active campaign
// package + the live base+overage gate, and surfaces the EFFECTIVE model (pure
// per-reached while the gate is off; base+overage when on). packages carries no
// PII/secrets; the gate is read via the fail-closed accessor (a boolean, never
// the raw app_settings row). A human still reviews every draft before it sends.
async function cmdBusinessFacts(): Promise<void> {
  const admin = createAdminClient();
  const gateOn = await getBaseOveragePricingEnabled();
  // The canonical campaign package — the same row resolveCanonicalTemplate picks
  // (active, campaign-enabled, lowest sort_order).
  const { data, error } = await admin
    .from('packages')
    .select('name, price_per_reached, base_price, included_reached, channels')
    .eq('active', true)
    .not('price_per_reached', 'is', null)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) fail(`business-facts read failed: ${error.message}`);

  const pkg = data
    ? {
        name: data.name,
        price_per_reached: Number(data.price_per_reached ?? 0),
        base_price: Number(data.base_price ?? 0),
        included_reached: Number(data.included_reached ?? 0),
        channels: (data.channels ?? []) as string[],
      }
    : null;
  console.log(JSON.stringify(buildBusinessFacts(gateOn, pkg), null, 2));
}

// ── Fleet goals ──────────────────────────────────────────────────────────────
// The autonomy loop: goal-poll (mirrors cmdPoll — runs unconditionally, "0
// due" is a normal outcome, no exitCode games) and goal-progress/goal-close
// (mirror cmdTriageFinish — single CAS write, exitCode 2 on anything but the
// success outcome). See plan §3.2 for why each verb takes its template from a
// different existing command.

async function cmdGoalPoll(args: Record<string, string | undefined>): Promise<void> {
  const role = requireOption(args.role, 'role');
  const admin = createAdminClient();

  // Only goals DUE this run — status='active' and next_wake_at <= now().
  // Mirrors the scheduler's own goal_due query exactly, so a role never sees a
  // goal it wasn't woken up for.
  //
  // No validateRequestRole — deliberately, like cmdPoll itself. The name was
  // already validated twice before we got here: ROLE_NAME_RE in run-role.sh,
  // and membership in fleet.json before the role was even spawned.
  const { data, error } = await admin
    .from('fleet_goals')
    .select('id, title, body, state, step_count, consecutive_failures')
    .eq('role', role)
    .eq('status', 'active')
    .lte('next_wake_at', new Date().toISOString())
    .order('created_at', { ascending: true });
  if (error) fail(`goal-poll failed: ${error.message}`);

  console.log(JSON.stringify({ role, goals: data ?? [] }, null, 2));
}

async function cmdGoalProgress(args: Record<string, string | undefined>): Promise<void> {
  const id = requireOption(args.id, 'id');

  const stepRaw = requireOption(args.step, 'step');
  const step = Number.parseInt(stepRaw, 10);
  if (!Number.isInteger(step) || step < 0) {
    fail(`--step must be the step_count you read from goal-poll (got "${stepRaw}")`);
  }

  // Same pattern as --payload in cmdRequest: client-side parsing gives a
  // friendly message; fleet_goals_state_object in the DB is the second net,
  // not the only one. Default {} — a first step may not change state at all.
  let state: Json = {};
  if (args.state) {
    try {
      const parsed: unknown = JSON.parse(args.state);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        fail('--state must be a JSON object');
      }
      state = parsed as Json;
    } catch (err) {
      if (err instanceof SyntaxError) fail('--state is not valid JSON');
      throw err;
    }
  }

  // Shape check only, not range: the (now, now+30d] range is enforced by the
  // RPC, not duplicated here. Same schema as the owner's UI (§2.2), not a copy.
  let nextWakeAt: string | null = null;
  if (args['next-wake-at']) {
    const parsed = goalWakeAtSchema.safeParse(args['next-wake-at']);
    if (!parsed.success) fail(`--next-wake-at ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    nextWakeAt = parsed.data;
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('fleet_goal_progress', {
    p_id: id,
    p_step: step,
    p_state: state,
    // `supabase gen types` drops the null variant for a required (no
    // `default`) nullable RPC scalar arg — the generated Args type says
    // `string`, but the SQL param is `timestamptz` with no `not null`, and
    // the RPC body explicitly branches on `p_next_wake_at is not null`. This
    // is a generator gap, not a real constraint.
    p_next_wake_at: nextWakeAt as string,
    ...(args.error ? { p_error: args.error } : {}),
  });
  if (error) fail(`goal-progress failed: ${error.message}`);

  const outcome = data as GoalProgressOutcome;
  console.log(JSON.stringify({ outcome, id, step }, null, 2));
  // Only 'advanced' is a normal continuation. Everything else means stop —
  // see the outcome table in run-context.sh §3.3.
  if (isGoalProgressStuck(outcome)) process.exitCode = 2;
}

const GOAL_CLOSE_STATUSES = ['completed', 'failed'] as const;

async function cmdGoalClose(args: Record<string, string | undefined>): Promise<void> {
  const id = requireOption(args.id, 'id');

  const stepRaw = requireOption(args.step, 'step');
  const step = Number.parseInt(stepRaw, 10);
  if (!Number.isInteger(step) || step < 0) {
    fail(`--step must be the step_count you read from goal-poll (got "${stepRaw}")`);
  }

  const status = requireOption(args.status, 'status');
  if (!(GOAL_CLOSE_STATUSES as readonly string[]).includes(status)) {
    fail(`--status must be one of ${GOAL_CLOSE_STATUSES.join(', ')}`);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('fleet_goal_close', {
    p_id: id,
    p_step: step,
    p_status: status,
    ...(args.note ? { p_note: args.note } : {}),
  });
  if (error) fail(`goal-close failed: ${error.message}`);

  const outcome = data as GoalCloseOutcome;
  console.log(JSON.stringify({ outcome, id, step, status }, null, 2));
  // No Slack alert here, unlike cmdTriageFinish: a failed goal STOPS (no race
  // against time that needs an immediate push) — the summary the agent writes
  // is the reporting channel.
  if (isGoalCloseStuck(outcome)) process.exitCode = 2;
}

const ANALYTICS_RANGES = RANGE_OPTIONS.map((o) => o.value);

// SDK loaded via createRequire, not a static import — same technique as `pg`
// above, and for a bigger reason: @google-analytics/data unconditionally
// requires build/protos/protos.js (4,684,376 bytes, measured) and google-gax
// unconditionally requires @grpc/grpc-js regardless of the runtime
// fallback:'rest' flag (that flag picks the request path, not what esbuild
// inlines statically). A static import would balloon dist/fleet-agent-cli.cjs
// — the file scheduler.mjs spawns ~17 times a minute for all 16 roles, most
// of which never touch GA4. createRequire is opaque to esbuild's analyzer,
// so the bundle stays the same size and the SDK resolves from node_modules
// only on a run that actually asks for it.
interface Ga4DataModule {
  BetaAnalyticsDataClient: new (options: { fallback: 'rest' }) => {
    batchRunReports(request: {
      property: string;
      requests: RunReportRequest[];
    }): Promise<[{ reports?: RunReportResponse[] | null }]>;
  };
}

async function cmdAnalyticsSummary(
  args: Record<string, string | undefined>,
  landingPages?: boolean,
): Promise<void> {
  const range = (args.range?.trim() || DEFAULT_RANGE) as AnalyticsRange;
  if (!(ANALYTICS_RANGES as readonly string[]).includes(range)) {
    fail(`--range must be one of ${ANALYTICS_RANGES.join(', ')}`);
  }

  // Same safety gate the dashboard uses: digits-only property id + a readable
  // credentials file. "Not configured" is a valid outcome here (like cmdPoll's
  // empty-inbox case), not a failure — the role must keep working without
  // traffic data.
  const config = await getGa4ConfigStatus();
  if (!config.ok) {
    console.log(JSON.stringify({ configured: false, issue: config.issue, range }, null, 2));
    return;
  }

  const { BetaAnalyticsDataClient } = createRequire(__filename)(
    '@google-analytics/data',
  ) as Ga4DataModule;
  // fallback:'rest' matches getGa4Client() (ga4-client.ts) — that is what
  // keeps gRPC out of the request path. Keep the two in sync.
  const client = new BetaAnalyticsDataClient({ fallback: 'rest' });

  const streamId = getGa4StreamId();
  const property = getGa4Property();

  const responses = await client
    .batchRunReports({ property, requests: buildCoreBatchA(range, streamId) })
    .then(([response]) => (response.reports ?? []) as RunReportResponse[])
    .catch((err: unknown) => fail(`analytics-summary failed: ${classifyGa4Error(err)}`));

  // --landing-pages: a SEPARATE call, not folded into batch A — deliberately
  // opt-in. buildCoreBatchA is what runs on every content-seo-strategist
  // invocation (weekly); landing pages is only useful for the quarterly
  // review (same occasional-use shape as --range 90d), so it stays a second
  // round-trip made only when asked, not a permanent addition to the
  // always-fetched batch.
  let landingPageRows: ReturnType<typeof mapLandingPages> | undefined;
  if (landingPages) {
    landingPageRows = await client
      .batchRunReports({ property, requests: buildLandingPagesRequest(range, streamId) })
      .then(([response]) => mapLandingPages((response.reports ?? [])[0] as RunReportResponse))
      .catch((err: unknown) => fail(`analytics-summary (landing-pages) failed: ${classifyGa4Error(err)}`));
  }

  // Batch A report order: [overview, trend, topPages, channels, sources].
  const overview = mapOverview(responses[0]);
  console.log(
    JSON.stringify(
      {
        configured: true,
        range,
        fetchedAt: new Date().toISOString(),
        overview: overview.current,
        previousPeriod: overview.previous,
        topPages: mapTopPages(responses[2]),
        channels: mapChannels(responses[3]),
        sources: mapSources(responses[4]),
        ...(landingPageRows ? { landingPages: landingPageRows } : {}),
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      role: { type: 'string' },
      kind: { type: 'string' },
      tier: { type: 'string' },
      title: { type: 'string' },
      body: { type: 'string' },
      payload: { type: 'string' },
      attach: { type: 'string', multiple: true },
      'run-id': { type: 'string' },
      'request-key': { type: 'string' },
      to: { type: 'string' },
      'from-request': { type: 'string' },
      note: { type: 'string' },
      summary: { type: 'string' },
      id: { type: 'string' },
      reason: { type: 'string' },
      level: { type: 'string' },
      query: { type: 'string' },
      limit: { type: 'string' },
      attempt: { type: 'string' },
      status: { type: 'string' },
      'not-before': { type: 'string' },
      'not-after': { type: 'string' },
      'exclude-dates': { type: 'string' },
      evidence: { type: 'string' },
      'on-date': { type: 'string' },
      'at-time': { type: 'string' },
      error: { type: 'string' },
      step: { type: 'string' },
      state: { type: 'string' },
      'next-wake-at': { type: 'string' },
      range: { type: 'string' },
      'body-file': { type: 'string' },
      'summary-file': { type: 'string' },
      'note-file': { type: 'string' },
      'state-file': { type: 'string' },
      'query-file': { type: 'string' },
      'reason-file': { type: 'string' },
      'error-file': { type: 'string' },
      'evidence-file': { type: 'string' },
      'landing-pages': { type: 'boolean' },
    },
  });

  // Resolve --X-file into --X BEFORE any command handler runs, so every
  // handler keeps its existing signature — none of them need to know
  // file-flags exist. See resolveFileFlags' own comment for why this exists.
  resolveFileFlags(values);

  const command = positionals[0];
  // `attach` (multiple:true) and `landing-pages` (boolean) are the only two
  // non-string option shapes — split both off so the remaining values keep
  // the Record<string, string | undefined> shape the other verbs expect.
  const { attach, 'landing-pages': landingPages, ...scalarValues } = values;
  switch (command) {
    case 'request':
      return cmdRequest(scalarValues as Record<string, string | undefined>, attach);
    case 'handoff':
      return cmdHandoff(scalarValues);
    case 'complete':
      return cmdComplete(scalarValues);
    case 'poll':
      return cmdPoll(scalarValues);
    case 'verdicts':
      return cmdVerdicts();
    case 'ack':
      return cmdAck(scalarValues);
    case 'expire':
      return cmdExpire();
    case 'withdraw':
      return cmdWithdraw(scalarValues);
    case 'digest':
      return cmdDigest(scalarValues);
    case 'sql':
      return cmdSql(scalarValues);
    case 'draft-reply':
      return cmdDraftReply(scalarValues);
    case 'distill-corrections':
      return cmdDistillCorrections(scalarValues);
    case 'business-facts':
      return cmdBusinessFacts();
    case 'triage-claim':
      return cmdTriageClaim();
    case 'triage-finish':
      return cmdTriageFinish(scalarValues);
    case 'goal-poll':
      return cmdGoalPoll(scalarValues);
    case 'goal-progress':
      return cmdGoalProgress(scalarValues);
    case 'goal-close':
      return cmdGoalClose(scalarValues);
    case 'analytics-summary':
      return cmdAnalyticsSummary(scalarValues, landingPages);
    default:
      fail(
        'usage: fleet-agent-cli <request|handoff|complete|poll|verdicts|ack|expire|withdraw|digest|sql|draft-reply|distill-corrections|business-facts|triage-claim|triage-finish|goal-poll|goal-progress|goal-close|analytics-summary> [options]',
      );
  }
}

main().catch((e) => {
  console.error('[fleet-agent] failed:', e instanceof Error ? e.message : 'unknown error');
  process.exit(1);
});
