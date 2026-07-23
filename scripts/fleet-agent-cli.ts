// Fleet agent CLI — the ONLY write path autonomous fleet roles have into the
// owner<->fleet ledger (public.fleet_requests) and the notification fan-out.
//
// Runs as service_role via createAdminClient() (env from .env.local through
// `node --env-file`, same pattern as sync-voximplant-sa). Fleet roles invoke
// it through the allowlisted `npm run fleet:agent -- <cmd>`; they never hold
// DB credentials themselves (.env* reads are denied in the fleet tiers).
//
// Subcommands:
//   request --role R --kind approval|question|fyi --title T --body B
//           [--tier 0..2] [--payload JSON] [--run-id ID] [--request-key K]
//     Inserts a pending request, then notifies: web push to every admin
//     (existing sendPushToUser pipeline) + Slack mirror (sendSlackAlert).
//     Idempotent: a retry deriving the same request_key returns the existing
//     row instead of failing (unique-violation -> lookup).
//   poll --role R
//     Prints the role's unconsumed verdicts + its still-open requests.
//   ack --id UUID
//     Claims a verdict exactly-once via the fleet_consume_request RPC (CAS).
//     Call BEFORE acting on the verdict.
//   expire
//     Marks pending requests past expires_at as expired (chief-of-staff sweep).
//   digest --title T --body B [--level info|warn|error]
//     Posts the daily fleet digest to Slack via the existing alerting stack.
//
// PII rule: requests are owner-facing internal ops traffic. Callers must not
// put guest personal data in title/body; the Slack layer redacts as
// defense-in-depth but the ledger itself is not redacted.

import { parseArgs } from 'node:util';

import { createRequire } from 'node:module';

import { sendSlackAlert, type SlackAlertLevel } from '@/lib/alerts/slack';

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

async function cmdRequest(args: Record<string, string | undefined>): Promise<void> {
  const role = requireOption(args.role, 'role');
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

  const requestKey = args['request-key']?.trim() || deriveRequestKey({ role, kind, title, body });
  const admin = createAdminClient();

  const { data: inserted, error } = await admin
    .from('fleet_requests')
    .insert({
      request_key: requestKey,
      role,
      run_id: args['run-id']?.trim() || null,
      kind,
      tier,
      title,
      body,
      payload,
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
        .eq('request_key', requestKey)
        .single();
      console.log(
        JSON.stringify({ deduplicated: true, request: existing ?? null }, null, 2),
      );
      return;
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
  console.log(JSON.stringify({ deduplicated: false, request: inserted, notify }, null, 2));
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

  // Verdicts waiting to be acted on (ack first!), then the role's open asks.
  const { data, error } = await admin
    .from('fleet_requests')
    .select('id, request_key, kind, tier, title, status, answer, created_at, answered_at, expires_at')
    .eq('role', role)
    .in('status', ['pending', 'approved', 'denied', 'answered'])
    .is('consumed_at', null)
    .order('created_at', { ascending: true });
  if (error) fail(`poll failed: ${error.message}`);

  const verdicts = (data ?? []).filter((r) => r.status !== 'pending');
  const open = (data ?? []).filter((r) => r.status === 'pending');
  console.log(JSON.stringify({ role, verdicts, open }, null, 2));
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
      'run-id': { type: 'string' },
      'request-key': { type: 'string' },
      id: { type: 'string' },
      level: { type: 'string' },
      query: { type: 'string' },
    },
  });

  const command = positionals[0];
  switch (command) {
    case 'request':
      return cmdRequest(values);
    case 'poll':
      return cmdPoll(values);
    case 'verdicts':
      return cmdVerdicts();
    case 'ack':
      return cmdAck(values);
    case 'expire':
      return cmdExpire();
    case 'digest':
      return cmdDigest(values);
    case 'sql':
      return cmdSql(values);
    default:
      fail('usage: fleet-agent-cli <request|poll|verdicts|ack|expire|digest|sql> [options]');
  }
}

main().catch((e) => {
  console.error('[fleet-agent] failed:', e instanceof Error ? e.message : 'unknown error');
  process.exit(1);
});
