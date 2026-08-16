/**
 * Exercises every method of the Graph calendar provider against the real
 * Microsoft 365 mailbox — the S2 gate from plans/m365-graph-migration.md.
 *
 * The write cycle creates one appointment, reads it back, updates it, then
 * deletes it, so nothing is left behind. NO attendees are used, so no meeting
 * invitations are dispatched.
 *
 * Build + run:
 *   npx esbuild scripts/verify-graph-provider.ts --bundle --platform=node --format=cjs \
 *     --target=node20 --outfile=dist/verify-graph.cjs --tsconfig=tsconfig.json \
 *     --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js \
 *     --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js \
 *     --external:pg-native --external:deasync
 *   node --env-file=.env.local dist/verify-graph.cjs
 */
import { graphProvider } from '@/lib/exchange-ews/graph-impl';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ExchangeConnectionConfig } from '@/lib/exchange-ews/types';

// The mailbox is NOT hardcoded: production reads it from exchange_connections,
// so the check reads it from exactly the same place. Credentials are the app's
// certificate (env) — `password`/`authMethod` exist only to satisfy the shared
// interface and are ignored by the Graph provider.
async function liveConfig(): Promise<ExchangeConnectionConfig> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('exchange_connections')
    .select('mailbox_email')
    .eq('status', 'verified')
    .limit(2);
  if (error) throw new Error('failed to read exchange_connections');
  if (!data || data.length !== 1) throw new Error(`expected exactly 1 verified connection, got ${data?.length ?? 0}`);
  return { mailboxEmail: data[0].mailbox_email, password: '', authMethod: 'ntlm' };
}


let failures = 0;
function report(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${label.padEnd(22)} ${detail}`);
}

async function main() {
  const cfg = await liveConfig();
  console.log(`mailbox (from DB): ${cfg.mailboxEmail}`);
  const conn = await graphProvider.testConnection(cfg);
  report('testConnection', conn.ok, conn.ok ? `${conn.data.emailAddress} (${conn.data.displayName ?? 'no name'})` : conn.error);

  const cals = await graphProvider.listCalendars(cfg);
  report('listCalendars', cals.ok, cals.ok ? cals.data.map((c) => `${c.displayName}:${c.totalCount}`).join(', ') : cals.error);

  const now = Date.now();
  const range = { start: new Date(now - 7 * 864e5), end: new Date(now + 30 * 864e5) };

  const list = await graphProvider.listAppointments(cfg, range);
  report('listAppointments', list.ok, list.ok ? `${list.data.length} items` : list.error);

  // The method that could NOT work on the old hosting.
  const avail = await graphProvider.getAvailability(cfg, range);
  report('getAvailability', avail.ok, avail.ok ? `${avail.data.length} busy windows (via /getSchedule)` : avail.error);

  const cats = await graphProvider.listCategories(cfg);
  report('listCategories', cats.ok, cats.ok ? cats.data.map((c) => `${c.name}#${c.colorIndex}`).join(', ') : cats.error);

  // ---- write cycle ----
  const start = new Date(now + 3 * 864e5);
  start.setUTCHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 45 * 60_000);

  const created = await graphProvider.createAppointment(cfg, {
    subject: 'KALFA — בדיקת ספק Graph',
    start,
    end,
    body: 'נוצר על ידי verify-graph-provider. נמחק אוטומטית.',
    location: 'בדיקה',
    showAs: 'busy',
    category: 'KALFA',
    reminderMinutes: 15,
    private: true,
  });
  report('createAppointment', created.ok, created.ok ? created.data.appointmentId.slice(0, 28) + '…' : created.error);
  if (!created.ok) return;

  const id = created.data.appointmentId;

  const got = await graphProvider.getAppointment(cfg, id);
  report(
    'getAppointment',
    got.ok,
    got.ok
      ? `"${got.data.subject}" ${got.data.start.toISOString().slice(0, 16)} loc="${got.data.location}" showAs=${got.data.showAs} sens=${got.data.sensitivity} cat="${got.data.category}" reminder=${got.data.reminderMinutes}`
      : got.error,
  );

  const moved = new Date(start.getTime() + 2 * 3600_000);
  const upd = await graphProvider.updateAppointment(cfg, id, {
    start: moved,
    end: new Date(moved.getTime() + 45 * 60_000),
    subject: 'KALFA — בדיקת ספק Graph (עודכן)',
  });
  report('updateAppointment', upd.ok, upd.ok ? 'moved +2h, subject changed' : upd.error);

  const after = await graphProvider.getAppointment(cfg, id);
  const movedOk = after.ok && Math.abs(after.data.start.getTime() - moved.getTime()) < 60_000;
  report('update verified', movedOk, after.ok ? `now ${after.data.start.toISOString().slice(0, 16)} "${after.data.subject}"` : 'read-back failed');

  const del = await graphProvider.deleteAppointment(cfg, id);
  report('deleteAppointment', del.ok, del.ok ? 'removed' : del.error);

  const gone = await graphProvider.getAppointment(cfg, id);
  report('delete verified', !gone.ok && gone.error === 'not_found', !gone.ok ? `error=${gone.error} (expected not_found)` : 'STILL PRESENT');

  console.log('');
  console.log(failures === 0 ? '✅ ALL PROVIDER METHODS PASS' : `❌ ${failures} check(s) failed`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
