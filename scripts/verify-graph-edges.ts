/**
 * The risky paths the happy-path check does NOT cover, verified against the
 * live mailbox:
 *
 *   1. All-day events. Graph stores a wall-clock + named zone, so a UTC
 *      midnight lands on the WRONG DAY for an Israeli reader. This asserts the
 *      day survives a create → read round trip.
 *   2. Timed events across the DST-relevant offset — the stored instant must
 *      equal what the caller passed, to the minute.
 *   3. The recurring-series guard. Graph will happily PATCH an occurrence;
 *      our provider must refuse with 'recurring_locked' before it does.
 *   4. The `off` kill switch — must NOT report 'not_found', because two delete
 *      paths read that as "already gone" and drop our DB row for it.
 *
 * Everything it creates, it deletes.
 */
import { calendarProvider, selectedCalendarProvider } from '@/lib/exchange-ews/calendar-provider';
import { graphProvider } from '@/lib/exchange-ews/graph-impl';
import { ISRAEL_TIME_ZONE } from '@/lib/date';
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
function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${label.padEnd(30)} ${detail}`);
}

/** The calendar day a Date falls on, as a reader in Israel sees it. */
function israelDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Midnight in Israel on a given calendar day, as a real instant.
 *
 * Measures the zone's offset AT that date rather than assuming +2 or +3, so it
 * is correct on both sides of the DST switch. An earlier version guessed the
 * offset and silently fell back to the NEXT day's midnight when neither guess
 * matched — which is what made this very test report a false failure.
 */
function israelMidnight(y: number, m: number, day: number): Date {
  const asUtc = new Date(Date.UTC(y, m - 1, day, 0, 0, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ISRAEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(asUtc);
  const at = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const zoned = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour'), at('minute'), at('second'));
  return new Date(asUtc.getTime() - (zoned - asUtc.getTime()));
}

async function main() {
  const cfg = await liveConfig();
  console.log(`mailbox (from DB): ${cfg.mailboxEmail}`);
  console.log(`active provider: ${selectedCalendarProvider()}`);
  console.log('');

  // ---- 1. all-day, the wrong-day trap -------------------------------------
  const dayStart = israelMidnight(2026, 9, 3); // 3 Sep 2026, Israel midnight
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  const allDay = await graphProvider.createAppointment(cfg, {
    subject: 'KALFA — בדיקת יום שלם',
    start: dayStart,
    end: dayEnd,
    allDay: true,
    showAs: 'free', // an all-day info item must NOT black out the day
  });
  check('all-day created', allDay.ok, allDay.ok ? allDay.data.appointmentId.slice(0, 20) + '…' : allDay.error);

  if (allDay.ok) {
    const back = await graphProvider.getAppointment(cfg, allDay.data.appointmentId);
    if (back.ok) {
      const gotDay = israelDay(back.data.start);
      check('all-day lands on 2026-09-03', gotDay === '2026-09-03', `reads back as ${gotDay} (allDay=${back.data.allDay})`);
      check('all-day stays free', back.data.showAs === 'free', `showAs=${back.data.showAs}`);

      // Cancelling an event PATCHes the all-day RSVP-deadline marker with the
      // start/end it just read back. If updateAppointment wrote those as a
      // mailbox-zone wall clock, an out-of-Israel mailbox would make that a
      // non-midnight all-day item and Graph would reject it — so the create
      // leg alone is not enough to prove the path.
      const renamed = await graphProvider.updateAppointment(cfg, allDay.data.appointmentId, {
        start: back.data.start,
        end: back.data.end,
        subject: 'בוטל — KALFA — בדיקת יום שלם',
      });
      check('all-day update accepted', renamed.ok, renamed.ok ? 'PATCH על פריט יום-שלם עבר' : renamed.error);

      const after = await graphProvider.getAppointment(cfg, allDay.data.appointmentId);
      const stillOk = after.ok && after.data.allDay && israelDay(after.data.start) === '2026-09-03';
      check(
        'all-day survives update',
        stillOk,
        after.ok ? `allDay=${after.data.allDay}, יום=${israelDay(after.data.start)}` : 'read-back failed',
      );
    } else {
      check('all-day read back', false, back.error);
    }
    await graphProvider.deleteAppointment(cfg, allDay.data.appointmentId);
  }

  // ---- 2. timed event, exact instant ---------------------------------------
  const exact = new Date(Date.UTC(2026, 8, 3, 11, 30, 0)); // 11:30 UTC = 14:30 Israel
  const timed = await graphProvider.createAppointment(cfg, {
    subject: 'KALFA — בדיקת שעה מדויקת',
    start: exact,
    end: new Date(exact.getTime() + 30 * 60_000),
  });
  if (timed.ok) {
    const back = await graphProvider.getAppointment(cfg, timed.data.appointmentId);
    const drift = back.ok ? Math.abs(back.data.start.getTime() - exact.getTime()) : NaN;
    check('timed instant preserved', back.ok && drift === 0, back.ok ? `drift=${drift}ms, israel-local ${new Intl.DateTimeFormat('en-GB', { timeZone: ISRAEL_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(back.data.start)}` : 'read failed');
    await graphProvider.deleteAppointment(cfg, timed.data.appointmentId);
  } else {
    check('timed created', false, timed.error);
  }

  // ---- 3. the recurring-series guard ---------------------------------------
  const seriesStart = new Date(Date.UTC(2026, 8, 7, 6, 0, 0));
  const series = await graphProvider.createAppointment(cfg, {
    subject: 'KALFA — בדיקת סדרה',
    start: seriesStart,
    end: new Date(seriesStart.getTime() + 30 * 60_000),
    recurrence: { frequency: 'weekly', interval: 1, daysOfWeek: [1], occurrences: 3 },
  });
  check('series created', series.ok, series.ok ? '3 weekly occurrences' : series.error);

  if (series.ok) {
    const view = await graphProvider.listAppointments(cfg, {
      start: new Date(Date.UTC(2026, 8, 1)),
      end: new Date(Date.UTC(2026, 8, 30)),
    });
    const occurrences = view.ok ? view.data.filter((a) => a.subject === 'KALFA — בדיקת סדרה') : [];
    check('series expands to occurrences', occurrences.length === 3, `${occurrences.length} occurrence(s) in the window`);
    check('occurrences flagged seriesLinked', occurrences.every((o) => o.seriesLinked), `seriesLinked=${occurrences.map((o) => o.seriesLinked).join(',')}`);

    if (occurrences[0]) {
      const refuse = await graphProvider.updateAppointment(cfg, occurrences[0].id, {
        start: new Date(occurrences[0].start.getTime() + 3600_000),
        end: new Date(occurrences[0].end.getTime() + 3600_000),
      });
      check(
        'series edit refused',
        !refuse.ok && refuse.error === 'recurring_locked',
        !refuse.ok ? `error=${refuse.error}` : 'ACCEPTED — the server-side guard did not hold',
      );
    }
    await graphProvider.deleteAppointment(cfg, series.data.appointmentId);
  }

  // ---- 4. the kill switch --------------------------------------------------
  const prev = process.env.EXCHANGE_PROVIDER;
  process.env.EXCHANGE_PROVIDER = 'off';
  const offRes = await calendarProvider.testConnection(cfg);
  const offDel = await calendarProvider.deleteAppointment(cfg, 'anything');
  process.env.EXCHANGE_PROVIDER = prev;
  check('off: fails fast', !offRes.ok, !offRes.ok ? `error=${offRes.error}` : 'it CONTACTED the service');
  check(
    'off: never says not_found',
    !offDel.ok && offDel.error !== 'not_found',
    !offDel.ok ? `delete → ${offDel.error}` : 'returned ok',
  );
  check('provider restored', selectedCalendarProvider() !== 'off', `now ${selectedCalendarProvider()}`);

  console.log('');
  console.log(failures === 0 ? '✅ ALL EDGE CASES PASS' : `❌ ${failures} check(s) failed`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
