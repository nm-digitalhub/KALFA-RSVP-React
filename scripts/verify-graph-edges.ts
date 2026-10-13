/**
 * The risky paths the happy-path check does NOT cover, verified against the
 * live mailbox:
 *
 *   1. All-day events. Graph stores a wall-clock + named zone, so a UTC
 *      midnight lands on the WRONG DAY for an Israeli reader. This asserts the
 *      day survives a create → read round trip — for an ordinary 24h day, for
 *      the 25-hour day clocks go back (2026-10-25) and for the 23-hour day
 *      they go forward (2026-03-27). Each is ONE all-day item: the window runs
 *      from Israel midnight to the Israel midnight of the NEXT calendar day,
 *      never start + 24h.
 *   2. Timed events across the DST-relevant offset — the stored instant must
 *      equal what the caller passed, to the minute.
 *   3. The recurring-series guard. Graph will happily PATCH an occurrence;
 *      our provider must refuse with 'recurring_locked' before it does.
 *   4. The `off` kill switch — must NOT report 'not_found', because two delete
 *      paths read that as "already gone" and drop our DB row for it.
 *
 * Everything it creates, it deletes.
 *
 * Modes (no flag = every check above):
 *   --windows-only   only the offline all-day window arithmetic; touches neither
 *                    the database nor the mailbox.
 *   --all-day-live   the offline windows, then ONLY the three all-day cases
 *                    against the real mailbox (create → read → update → read,
 *                    delete in a `finally`); no timed event, series or kill switch.
 */
import { randomBytes } from 'node:crypto';

import { calendarProvider, selectedCalendarProvider } from '@/lib/exchange-ews/calendar-provider';
import { graphProvider } from '@/lib/exchange-ews/graph-impl';
import { ilWallTimeToIso } from '@/lib/data/event-date';
import { ISRAEL_TIME_ZONE, addCalendarDays } from '@/lib/date';
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
 * An all-day item's window: Israel midnight of `ymd` to Israel midnight of the NEXT calendar day (Graph reads an
 * all-day `end` as exclusive). Both instants come from the shared wall-clock primitive, so the window is 25 hours
 * on the day clocks go back and 23 on the day they go forward — it is never start + 24h.
 */
function allDayWindow(ymd: string): { start: Date; end: Date } {
  const next = addCalendarDays(ymd, 1);
  if (next === null) throw new Error(`not a calendar date: ${ymd}`);
  return { start: new Date(ilWallTimeToIso(ymd, '00:00')), end: new Date(ilWallTimeToIso(next, '00:00')) };
}

// Israel 2026: clocks go back on Sun 25.10 (a 25-hour day) and forward on Fri 27.3 (a 23-hour day).
const ALL_DAY_CASES = [
  { day: '2026-09-03', hours: 24, what: 'ordinary day' },
  { day: '2026-10-25', hours: 25, what: 'clocks go back' },
  { day: '2026-03-27', hours: 23, what: 'clocks go forward' },
] as const;

// ---- --all-day-live ----------------------------------------------------------
// The three all-day cases only, against the real mailbox. Each item carries a per-run token in its subject so
// that what this run created can be told from anything else, and is deleted in a `finally` even when a check
// fails or a call throws. A scan before and after reports any test item left in the mailbox.
const ALL_DAY_SUBJECT = 'KALFA — בדיקת יום שלם';

type ReadBack = Awaited<ReturnType<typeof graphProvider.getAppointment>>;

function describeReadBack(label: string, back: ReadBack, c: (typeof ALL_DAY_CASES)[number]) {
  if (!back.ok) {
    check(`${label}: read`, false, back.error);
    return;
  }
  const { start, end, allDay, showAs, subject } = back.data;
  const nextDay = addCalendarDays(c.day, 1);
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  console.log(`   ${label}: start=${start.toISOString()} (יום ${israelDay(start)}) end=${end.toISOString()} (יום ${israelDay(end)}) · ${hours}h · allDay=${allDay} · showAs=${showAs} · subject="${subject}"`);
  check(`${label}: start day`, israelDay(start) === c.day, `${israelDay(start)} (expected ${c.day})`);
  check(`${label}: end day`, israelDay(end) === nextDay, `${israelDay(end)} (expected ${nextDay}: one calendar day, not zero)`);
  check(`${label}: allDay`, allDay === true, `allDay=${allDay}`);
  check(`${label}: showAs`, showAs === 'free', `showAs=${showAs}`);
}

async function scanTestItems(cfg: ExchangeConnectionConfig, token: string): Promise<{ mine: string[]; older: string[] }> {
  const mine: string[] = [];
  const older: string[] = [];
  for (const c of ALL_DAY_CASES) {
    const { start, end } = allDayWindow(c.day);
    const view = await graphProvider.listAppointments(cfg, {
      start: new Date(start.getTime() - 36 * 3_600_000),
      end: new Date(end.getTime() + 36 * 3_600_000),
    });
    if (!view.ok) {
      check(`scan ${c.day}`, false, view.error);
      continue;
    }
    for (const a of view.data) {
      if (!a.subject.includes('בדיקת יום שלם')) continue;
      (a.subject.includes(token) ? mine : older).push(`${a.id} · "${a.subject}" · ${israelDay(a.start)}`);
    }
  }
  return { mine, older };
}

async function runAllDayLive(cfg: ExchangeConnectionConfig) {
  const token = randomBytes(4).toString('hex');
  const subject = `${ALL_DAY_SUBJECT} — ${token}`;
  console.log(`run token: ${token}`);

  const before = await scanTestItems(cfg, token);
  console.log(`test items already in the mailbox before this run (older runs): ${before.older.length}`);
  for (const line of before.older) console.log(`   • ${line}`);

  for (const c of ALL_DAY_CASES) {
    const { start, end } = allDayWindow(c.day);
    console.log('');
    console.log(`── ${c.day} · ${c.what} · ${(end.getTime() - start.getTime()) / 3_600_000}h absolute ──`);
    console.log(`   sent: start=${start.toISOString()} end=${end.toISOString()}`);
    let id: string | null = null;
    try {
      const made = await graphProvider.createAppointment(cfg, { subject, start, end, allDay: true, showAs: 'free' });
      check(`${c.day} create`, made.ok, made.ok ? `id=${made.data.appointmentId}` : made.error);
      if (!made.ok) continue;
      id = made.data.appointmentId;
      console.log(`   appointment id: ${id}`);

      const first = await graphProvider.getAppointment(cfg, id);
      describeReadBack(`${c.day} read after create`, first, c);
      if (!first.ok) continue;

      // The PATCH a cancellation sends: the start/end just read back, plus a new subject.
      const updated = await graphProvider.updateAppointment(cfg, id, {
        start: first.data.start,
        end: first.data.end,
        subject: `בוטל — ${subject}`,
      });
      check(`${c.day} update`, updated.ok, updated.ok ? 'PATCH accepted' : updated.error);

      const second = await graphProvider.getAppointment(cfg, id);
      describeReadBack(`${c.day} read after update`, second, c);
      if (second.ok) {
        check(`${c.day} subject renamed`, second.data.subject.startsWith('בוטל'), `subject="${second.data.subject}"`);
      }
    } catch (e) {
      check(`${c.day} threw`, false, e instanceof Error ? e.message : String(e));
    } finally {
      if (id) {
        const deleted = await graphProvider.deleteAppointment(cfg, id);
        check(`${c.day} delete`, deleted.ok, deleted.ok ? `deleted ${id}` : deleted.error);
        const gone = await graphProvider.getAppointment(cfg, id);
        check(`${c.day} gone after delete`, !gone.ok && gone.error === 'not_found', gone.ok ? 'STILL THERE' : `read → ${gone.error}`);
      }
    }
  }

  console.log('');
  const after = await scanTestItems(cfg, token);
  check('no item of this run left', after.mine.length === 0, after.mine.length === 0 ? '0 left in the three day windows' : after.mine.join(' | '));
  console.log(`test items from OLDER runs still in the mailbox: ${after.older.length}`);
  for (const line of after.older) console.log(`   • ${line}`);
}

async function main() {
  // Offline first: the all-day windows are computed and checked before the database or the mailbox is touched.
  for (const c of ALL_DAY_CASES) {
    const { start, end } = allDayWindow(c.day);
    const hours = (end.getTime() - start.getTime()) / 3_600_000;
    check(`window ${c.day}`, hours === c.hours && israelDay(start) === c.day && israelDay(end) === addCalendarDays(c.day, 1), `${hours}h absolute (${c.what}), one calendar day`);
  }
  if (failures) {
    console.log('❌ all-day window is wrong — not contacting the mailbox');
    process.exit(1);
  }
  if (process.argv.includes('--windows-only')) {
    console.log('✅ all-day windows OK (offline, --windows-only)');
    return;
  }

  const cfg = await liveConfig();
  console.log(`mailbox (from DB): ${cfg.mailboxEmail}`);
  console.log(`active provider: ${selectedCalendarProvider()}`);
  console.log('');

  if (process.argv.includes('--all-day-live')) {
    await runAllDayLive(cfg);
    console.log('');
    console.log(failures === 0 ? '✅ ALL-DAY LIVE CHECKS PASS' : `❌ ${failures} check(s) failed`);
    if (failures) process.exit(1);
    return;
  }

  // ---- 1. all-day, the wrong-day trap -------------------------------------
  for (const c of ALL_DAY_CASES) {
    const { start: dayStart, end: dayEnd } = allDayWindow(c.day);
    const tag = `${c.day} ${c.hours}h`;
    const allDay = await graphProvider.createAppointment(cfg, {
      subject: 'KALFA — בדיקת יום שלם',
      start: dayStart,
      end: dayEnd,
      allDay: true,
      showAs: 'free', // an all-day info item must NOT black out the day
    });
    check(`all-day created ${tag}`, allDay.ok, allDay.ok ? allDay.data.appointmentId.slice(0, 20) + '…' : allDay.error);

    if (allDay.ok) {
      const back = await graphProvider.getAppointment(cfg, allDay.data.appointmentId);
      if (back.ok) {
        const gotDay = israelDay(back.data.start);
        check(`all-day lands on ${c.day}`, gotDay === c.day, `reads back as ${gotDay} (allDay=${back.data.allDay})`);
        const endDay = israelDay(back.data.end);
        check(`all-day ends ${addCalendarDays(c.day, 1)}`, endDay === addCalendarDays(c.day, 1), `end reads back as ${endDay}: one calendar day, not zero`);
        check(`all-day stays free ${tag}`, back.data.showAs === 'free', `showAs=${back.data.showAs}`);

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
        check(`all-day update accepted ${tag}`, renamed.ok, renamed.ok ? 'PATCH על פריט יום-שלם עבר' : renamed.error);

        const after = await graphProvider.getAppointment(cfg, allDay.data.appointmentId);
        const stillOk = after.ok && after.data.allDay && israelDay(after.data.start) === c.day;
        check(
          `all-day survives update ${tag}`,
          stillOk,
          after.ok ? `allDay=${after.data.allDay}, יום=${israelDay(after.data.start)}` : 'read-back failed',
        );
      } else {
        check(`all-day read back ${tag}`, false, back.error);
      }
      await graphProvider.deleteAppointment(cfg, allDay.data.appointmentId);
    }
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
