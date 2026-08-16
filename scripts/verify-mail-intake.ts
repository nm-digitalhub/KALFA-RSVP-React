/**
 * Brings up (or heals) the Outlook mail-intake subscription and reports the
 * live state — the S1 gate for plans/m365-fleet-mail-intake.md.
 *
 * Runs the SAME function the worker cron runs, rather than a parallel
 * implementation, so a pass here means the cron path works and not merely that
 * Graph would accept some request.
 *
 * IMPORTANT: Graph validates the notification URL synchronously while creating
 * a subscription — it POSTs a validationToken and requires it echoed within 10
 * seconds. The webhook route must therefore be DEPLOYED before this can pass;
 * a locally-running route is not reachable from Microsoft.
 *
 * Build + run:
 *   npx esbuild scripts/verify-mail-intake.ts --bundle --platform=node \
 *     --format=cjs --target=node20 --outfile=dist/verify-mail-intake.cjs \
 *     --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js \
 *     --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js \
 *     --alias:next/cache=./worker/empty.js --external:pg-native --external:deasync
 *   node --env-file=.env.local dist/verify-mail-intake.cjs
 */
import { runGraphIntakeSubscriptionSweep } from '@/lib/data/inquiry-mail-intake';
import { graphConfigured, primaryMailbox } from '@/lib/microsoft/graph-client';
import { ensureMailFolder } from '@/lib/microsoft/mail';
import {
  intakeFolderName,
  intakeResource,
  listSubscriptions,
  notificationUrl,
} from '@/lib/microsoft/subscriptions';

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${label.padEnd(32)} ${detail}`);
}

async function main() {
  check('Graph מוגדר', graphConfigured(), graphConfigured() ? 'תעודה + טננט + לקוח' : 'חסר');
  if (!graphConfigured()) process.exit(1);

  const mailbox = primaryMailbox();
  console.log(`תיבה  : ${mailbox}`);
  const target = await notificationUrl();
  console.log(`יעד   : ${target}\n`);

  const folderId = await ensureMailFolder(mailbox, intakeFolderName());
  check('תיקיית הקליטה', Boolean(folderId), `${intakeFolderName()} → ${folderId.slice(0, 24)}…`);

  // The cron path itself. It swallows its own errors and alerts instead, so the
  // assertion below — not this call — is what decides whether it worked.
  await runGraphIntakeSubscriptionSweep();

  const wanted = intakeResource(mailbox, folderId).toLowerCase();
  const mine = (await listSubscriptions()).filter(
    (s) => (s.resource ?? '').toLowerCase() === wanted,
  );

  check('מנוי קיים', mine.length > 0, `${mine.length} מנויים על התיקייה`);
  // More than one would deliver every message twice, and every duplicate
  // becomes a second inquiry the dedupe then has to absorb.
  check('מנוי יחיד', mine.length <= 1, mine.length <= 1 ? 'אין כפילות' : 'יש כפילות!');

  if (mine[0]) {
    const hoursLeft = (Date.parse(mine[0].expirationDateTime) - Date.now()) / 3_600_000;
    check(
      'תוקף סביר',
      hoursLeft > 24,
      `${hoursLeft.toFixed(1)} שעות (חידוש מופעל מתחת ל-24)`,
    );
    check(
      'מצביע לנתיב שלנו',
      mine[0].notificationUrl === target,
      mine[0].notificationUrl,
    );
  }

  console.log('');
  console.log(failures === 0 ? '✅ קליטת הדואר פעילה' : `❌ ${failures} בדיקות נכשלו`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
