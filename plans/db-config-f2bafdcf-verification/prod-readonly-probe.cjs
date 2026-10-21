// READ-ONLY production probe for the stage-3 deploy (plan steps 0.5, 0.6, 3.5, 5.4).
//
//   node plans/db-config-f2bafdcf-verification/prod-readonly-probe.cjs [since-ISO]
//
// - Runs inside BEGIN READ ONLY ... ROLLBACK. Aggregates only: no row contents, no PII.
// - Slack settings are reported as booleans only; the bot token and channel id are never selected.
// - Refuses to run unless the target is a Supabase pooler hostname on 5432 / 6543.
// - Prints no host, user, password or connection string.
// `since` (default: 1 hour ago) bounds "done since" / "failed since" counts; pass the restart time.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
process.loadEnvFile(path.join(ROOT, '.env.local'));
const { Client } = require(path.join(ROOT, 'node_modules/pg'));

const e = process.env;
const host = (e.SUPABASE_DB_HOST || '').toLowerCase();
const labels = host.split('.');
const isPooler = labels.length >= 4 && labels.slice(-3).join('.') === 'pooler.supabase.com';
const port = (e.SUPABASE_DB_PORT || '').trim();
if (!isPooler || !['5432', '6543'].includes(port)) {
  console.error('unexpected database target (not a Supabase pooler host on 5432/6543) — refusing');
  process.exit(9);
}
const since = process.argv[2] || new Date(Date.now() - 3600_000).toISOString();
if (Number.isNaN(Date.parse(since))) { console.error('since must be an ISO timestamp'); process.exit(2); }

const c = new Client({
  host: e.SUPABASE_DB_HOST, port: Number(port), user: e.SUPABASE_DB_USER,
  password: e.SUPABASE_DB_PASSWORD, database: e.SUPABASE_DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false }, application_name: 'deploy-readonly-probe', statement_timeout: 20000,
});
const q = async (label, sql, params = []) => {
  try {
    const r = await c.query(sql, params);
    console.log(`\n== ${label}`);
    console.table(r.rows);
  } catch (err) {
    console.log(`\n== ${label}: ERROR ${err.code || ''} ${err.message}`);
  }
};
(async () => {
  await c.connect();
  await c.query('begin read only');
  await q('clock / since', `select now() at time zone 'Asia/Jerusalem' as now_il, $1::timestamptz at time zone 'Asia/Jerusalem' as since_il`, [since]);
  await q('alerts (booleans only; category used by register() = errors)', `
    select slack_alerts_enabled as enabled, slack_alert_errors as errors_category,
           (slack_bot_token is not null and slack_bot_token <> '') as has_token,
           (slack_alert_channel_id is not null and slack_alert_channel_id <> '') as has_channel
      from public.app_settings where id = true`);
  await q('pg-boss: per queue', `
    select name,
           count(*) filter (where state in ('created','retry') and start_after <= now()) due_waiting,
           count(*) filter (where state = 'retry') retry,
           count(*) filter (where state = 'active') active,
           count(*) filter (where state = 'created' and created_on >= $1) created_since,
           count(*) filter (where state = 'completed' and completed_on >= $1) done_since,
           count(*) filter (where state = 'failed' and coalesce(completed_on, created_on) >= $1) failed_since,
           to_char(min(created_on) filter (where state in ('created','retry') and start_after <= now()) at time zone 'Asia/Jerusalem', 'DD.MM HH24:MI') oldest_due,
           to_char(max(completed_on) filter (where state = 'completed') at time zone 'Asia/Jerusalem', 'DD.MM HH24:MI') last_done
      from pgboss.job
     where created_on >= $1::timestamptz - interval '1 day' or state in ('created','retry','active')
     group by name order by due_waiting desc, name`, [since]);
  await q('pg-boss: stuck active (> 15 min)', `
    select name, count(*) n, to_char(min(started_on) at time zone 'Asia/Jerusalem','DD.MM HH24:MI') oldest_start
      from pgboss.job where state = 'active' and started_on < now() - interval '15 minutes' group by name`);
  await q('webhook_inbox', `
    select count(*) filter (where processed_at is null and attempts < 5) pending,
           count(*) filter (where processed_at is null and attempts >= 5) dead,
           count(*) filter (where processed_at is null and attempts > 0) pending_with_errors,
           count(*) filter (where processed_at >= $1) processed_since
      from public.webhook_inbox`, [since]);
  await c.query('rollback');
  await c.end();
})().catch(async (err) => { console.error('probe failed:', err.code || '', err.message); try { await c.end(); } catch {} process.exit(1); });
