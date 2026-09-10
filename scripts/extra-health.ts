// Run the ExtrA API-key check once, by hand, and print the verdict.
//   npm run extra:health
//
// Read-only: one GET /auth/key/. No SMS is composed and none is sent, so this costs
// nothing and reaches no handset. It is the same code path the daily
// `extra-key-check` queue runs, so a green result here is evidence about the
// scheduled job and not just about this script.
//
// Bundled with esbuild first (server-only and the next/* request APIs aliased to
// worker/empty.js) — the established pattern for every operator script here.
//
// The API key never reaches stdout: GET /auth/key/ echoes it back in its response
// and extra-client.ts drops it before returning, which its tests assert.

import { runExtraKeyCheck, EXTRA_KEY_WARN_DAYS } from '@/lib/sms/run-key-check';

async function main() {
  const started = Date.now();
  const { outcome, health } = await runExtraKeyCheck();
  const seconds = ((Date.now() - started) / 1000).toFixed(2);

  console.log(`outcome:   ${outcome}  (${seconds}s)`);
  if (!health) {
    console.log('detail:    nothing configured to probe');
    return;
  }
  if (!health.ok) {
    console.log(`kind:      ${health.kind}`);
    console.log(`message:   ${health.message}`);
    return;
  }
  console.log(`account:   ${health.accountEmail ?? '—'}`);
  console.log(`created:   ${health.createdAt ?? '—'}`);
  console.log(`expires:   ${health.expireAt ?? '—'}`);
  const d = health.daysToExpiry;
  console.log(
    `days left: ${d ?? 'unknown'}${d !== null && d <= EXTRA_KEY_WARN_DAYS ? '  ⚠️' : ''}`,
  );
  console.log(`scopes:    ${health.scopes === null ? 'null (legacy key — full account access)' : JSON.stringify(health.scopes)}`);
}

main().catch((e) => {
  console.error('extra key check could not run:', e instanceof Error ? e.message : e);
  process.exit(1);
});
