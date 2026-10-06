import 'server-only';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { sendSlackAlert } from '@/lib/alerts/slack';

const execFileAsync = promisify(execFile);

// Weekly keep-current job for the Supabase CLI.
//
// WHY A JOB AND NOT CRON. The CLI ships an update NOTIFIER, not an updater —
// it prints "a new version is available" and stops there — so something has to
// run the upgrade. System cron is not available to this account (`crontab -l`
// is permission-denied under Plesk), and pg-boss is already the project's
// scheduler: monitored through QUEUE_EXPECTED_MAX_MINUTES, visible in
// /admin/jobs, and wired to the same Slack alerting as every other sweep.
//
// WHY THE WORK LIVES IN BASH. scripts/update-supabase-cli.sh drives the OFFICIAL
// upstream installer, npm, git worktrees and tsc. That is shell work, and it is
// runnable by hand for exactly the same result — which matters when the owner
// wants to upgrade off-schedule or debug a failed run. This module is the
// scheduler seam: it runs the script, reads back what happened, and reports.

const SCRIPT = 'scripts/update-supabase-cli.sh';
// The script downloads a ~100MB binary, runs an npm install, and may run a full
// `tsc --noEmit` inside a worktree. 20 minutes is generous on purpose; pg-boss
// would otherwise expire the job mid-upgrade and leave the versions split.
const TIMEOUT_MS = 20 * 60 * 1000;
// The upgrade path itself is bounded, but a runaway `tsc` could print a lot.
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface SupabaseCliUpdateResult {
  /** false when the script could not run at all (spawn/timeout). */
  ran: boolean;
  /** true only when the binary actually moved to a new version. */
  updated: boolean;
  from: string | null;
  to: string | null;
  /** true when the run ended in any ERROR line or a non-zero exit. */
  failed: boolean;
  /** Set when the regenerated Supabase types landed on the sync branch. */
  typesBranch: boolean;
}

// The script's log lines are its contract with this module. Parsing them keeps
// the shell side free to change HOW it upgrades without changing this file.
function parse(stdout: string): Omit<SupabaseCliUpdateResult, 'ran'> {
  const moved = stdout.match(/binary (\d+\.\d+\.\d+) -> (\d+\.\d+\.\d+)/);
  const current = stdout.match(/binary=(\d+\.\d+\.\d+)/);
  return {
    updated: moved !== null,
    from: moved?.[1] ?? current?.[1] ?? null,
    to: moved?.[2] ?? current?.[1] ?? null,
    failed: /^\S+ \S+ ERROR:/m.test(stdout),
    typesBranch: stdout.includes('committed to branch chore/supabase-types-sync'),
  };
}

/**
 * Run the updater and report the outcome to Slack.
 *
 * Never throws — a maintenance job must not be able to take the worker down,
 * and a failure here is a Slack alert, not an exception. Quiet on the common
 * path: when the CLI is already current, nothing is posted, because a weekly
 * "still up to date" message trains people to ignore the channel.
 */
export async function runSupabaseCliUpdate(): Promise<SupabaseCliUpdateResult> {
  let stdout = '';
  let ran = true;
  try {
    const res = await execFileAsync('bash', [SCRIPT], {
      cwd: process.cwd(),
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      // The script needs HOME (install dir, log) and PATH; it deliberately gets
      // the worker's own environment rather than a stripped one, because npm
      // and git both read config from there.
    });
    stdout = res.stdout;
  } catch (err) {
    // execFile rejects on a non-zero exit AND on timeout; both carry whatever
    // the script managed to print, which is what names the failure.
    const e = err as { stdout?: string; message?: string; killed?: boolean };
    stdout = e.stdout ?? '';
    ran = e.killed !== true;
    if (!stdout) {
      await sendSlackAlert({
        level: 'error',
        title: 'עדכון Supabase CLI נכשל',
        detail: e.killed
          ? 'הסקריפט לא הסתיים בזמן והופסק.'
          : `הסקריפט לא רץ: ${e.message ?? 'שגיאה לא ידועה'}`,
        source: 'supabase-cli-update',
        category: 'errors',
      });
      return { ran: false, updated: false, from: null, to: null, failed: true, typesBranch: false };
    }
  }

  const parsed = parse(stdout);

  if (parsed.failed) {
    await sendSlackAlert({
      level: 'error',
      title: 'עדכון Supabase CLI נכשל',
      detail: 'הריצה הסתיימה בשגיאה. הפרטים ביומן ~/.supabase/update.log.',
      source: 'supabase-cli-update',
      category: 'errors',
      fields: { מגרסה: parsed.from ?? '—', לגרסה: parsed.to ?? '—' },
    });
  } else if (parsed.updated) {
    await sendSlackAlert({
      level: 'info',
      title: 'Supabase CLI עודכן',
      detail: parsed.typesBranch
        ? 'הטיפוסים שנוצרו השתנו ועברו בדיקת טיפוסים. הם ממתינים בענף chore/supabase-types-sync לסקירה ומיזוג — עד אז פריסה תיחסם על פער טיפוסים.'
        : 'הבינארי, npx ו-package.json מסונכרנים לאותה גרסה. הטיפוסים לא השתנו.',
      source: 'supabase-cli-update',
      category: 'errors',
      fields: { מגרסה: parsed.from ?? '—', לגרסה: parsed.to ?? '—' },
    });
  }
  // Already current → silence.

  return { ran, ...parsed };
}
