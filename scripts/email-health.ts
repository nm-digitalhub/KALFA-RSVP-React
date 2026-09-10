// Run the outgoing-mail health check once, by hand, and print the verdict.
//   npm run email:health
//
// It is bundled with esbuild first (server-only and the next/* request APIs aliased to
// worker/empty.js) because it reaches into the same `server-only` modules the worker
// runs — the established pattern for every operator script here, see worker:build.
//
// Read-only: two GETs against Resend's domain registry, or an SMTP connect+AUTH. No
// message is composed and none is sent. It is the same code path the hourly
// `email-health-check` queue runs, so a green result here is evidence about the
// scheduled job and not just about this script.
//
// Prints the classified verdict only. The API key and the SMTP password never reach
// stdout — by construction in src/lib/email/health.ts, and asserted by its tests.

import { runEmailHealthCheck } from '@/lib/email/run-health-check';
import { selectedEmailProvider } from '@/lib/email/sender';

async function main() {
  const started = Date.now();
  console.log(`transport: ${selectedEmailProvider()}`);

  const { outcome, health } = await runEmailHealthCheck();
  const seconds = ((Date.now() - started) / 1000).toFixed(2);

  console.log(`outcome:   ${outcome}  (${seconds}s)`);
  if (!health) {
    console.log('detail:    nothing configured to probe');
    return;
  }
  if (!health.ok) {
    console.log(`kind:      ${health.kind}`);
    console.log(`message:   ${health.message}`);
    if (health.observedStatus) console.log(`status:    ${health.observedStatus}`);
    // A failing probe is a finding, not a script error — exit 0 so a caller can tell
    // "the check ran and found a problem" from "the check could not run".
    return;
  }
  console.log(`from:      ${health.from}`);
  console.log(`domain:    ${health.domain ?? '—'}  status=${health.domainStatus ?? '—'}`);
  console.log(`verified:  ${health.fullyVerified === null ? 'n/a (smtp)' : health.fullyVerified}`);
  for (const r of health.records) console.log(`  ${r.record.padEnd(5)} ${r.status}`);
}

main().catch((e) => {
  console.error('email health check could not run:', e instanceof Error ? e.message : e);
  process.exit(1);
});
