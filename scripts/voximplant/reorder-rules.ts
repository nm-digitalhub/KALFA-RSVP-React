// Align the PLATFORM's routing-rule order with voxfiles/applications/<app>/
// rules.config.json — the local file is the source of truth for order.
//
// WHY THIS EXISTS. Rule order decides which scenario runs: the platform
// evaluates rules top to bottom and executes the FIRST match, ignoring the
// rest (official docs; applies to SDK-originated calls too). AddRule APPENDS,
// so a rule created after a `.*` rule is born shadowed and can never fire.
// voxengine-ci only reorders as part of an APPLICATION-level upload, which
// also rebuilds and pushes every scenario the app's rules reference — too
// blunt when the only thing that needs fixing is the order.
//
// Read-then-write, and it prints the before/after order so the change is
// reviewable. Refuses to run unless the local and platform rule SETS match
// exactly: a missing rule would silently drop out of the order.
//
// Run (owner): npm run vox:reorder-rules -- --confirm
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getApplications, getRules, voxRetry, type VoximplantConfig } from '@/lib/voximplant/core';
import { reorderApplicationRules } from '@/lib/voximplant/mutations';

const APP_NAME = 'kalfa-rsvp.kalfarsvp.voximplant.com';
const VOXFILES = join(process.cwd(), 'voxfiles');

interface LocalRule {
  ruleName: string;
  rulePattern: string;
  scenarios: string[];
}

function loadConfig(): VoximplantConfig {
  const path =
    process.env.VOXIMPLANT_CREDENTIALS_FILE ??
    process.env.VOX_CI_CREDENTIALS ??
    'vox_ci_credentials.json';
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    account_id: number | string;
    key_id: string;
    private_key: string;
  };
  return { accountId: raw.account_id, keyId: raw.key_id, privateKey: raw.private_key };
}

function localRules(): LocalRule[] {
  const path = join(VOXFILES, 'applications', APP_NAME, 'rules.config.json');
  return JSON.parse(readFileSync(path, 'utf8')) as LocalRule[];
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const apps = await voxRetry(() => getApplications(cfg));
  const app = apps.result.find((a) => a.application_name === APP_NAME);
  if (!app) throw new Error(`application not found: ${APP_NAME}`);

  const platform = await voxRetry(() => getRules(cfg, app.application_id));
  const byName = new Map(platform.result.map((r) => [r.rule_name, r.rule_id]));
  const wanted = localRules();

  const missing = wanted.filter((r) => !byName.has(r.ruleName)).map((r) => r.ruleName);
  const extra = platform.result
    .filter((r) => !wanted.some((w) => w.ruleName === r.rule_name))
    .map((r) => r.rule_name);
  if (missing.length || extra.length) {
    throw new Error(
      `rule sets differ — local-only: [${missing.join(', ')}], platform-only: [${extra.join(', ')}]. ` +
        'Upload the missing rules first; this command only reorders.',
    );
  }

  const current = platform.result.map((r) => `${r.rule_name}(${r.rule_id})`);
  const orderedIds = wanted.map((r) => byName.get(r.ruleName) as number);
  const target = wanted.map((r, i) => `${r.ruleName}(${orderedIds[i]})`);

  console.log('current order :', current.join(' → '));
  console.log('target  order :', target.join(' → '));

  if (current.join() === target.join()) {
    console.log('[reorder] already aligned — no change');
    return;
  }
  if (!process.argv.includes('--confirm')) {
    console.log('[reorder] dry run — re-run with --confirm to apply');
    return;
  }

  const res = await reorderApplicationRules(cfg, orderedIds);
  if (res.error) throw new Error(`ReorderRules failed (code=${res.error.code})`);

  // Read back rather than trusting the response: order is the whole point.
  const after = await voxRetry(() => getRules(cfg, app.application_id));
  const actual = after.result.map((r) => `${r.rule_name}(${r.rule_id})`);
  console.log('applied order :', actual.join(' → '));
  if (actual.join() !== target.join()) {
    throw new Error('post-write verification: platform order does not match the target');
  }
  console.log('[reorder] done');
}

main().catch((e) => {
  console.error('[reorder] failed:', e instanceof Error ? e.message : 'unknown error');
  process.exit(1);
});
