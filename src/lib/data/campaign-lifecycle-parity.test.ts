import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard: the campaign lifecycle has exactly ONE implementation.
//
// WHY THIS EXISTS. `campaigns.status` is guarded by more than the from/to pair.
// activateCampaign additionally enforces the J5 hold (capture_status =
// 'authorized'), refuses a past event (L1), requires a published event (R9),
// fires the ops alert, and seeds the auto-thankyou schedule. Only two of those
// are visible at the call site; the rest live inside transitionCampaignStatus.
//
// So anyone writing a second path — say a Bearer route that cannot reach the
// cookie DAL — reproduces what they can see and silently drops the rest. That
// is not hypothetical: the first draft of the console status route did exactly
// this, and shipped without the past-event guard. It would have let staff
// activate a campaign for an event that had already happened, after which every
// dial is refused by the dispatcher's own gate and nothing sends — a campaign
// that reads "active" and does nothing, which is the hardest kind of bug to see.
//
// The rule enforced here: no route handler may write campaigns.status itself.
// Transitions go through src/lib/data/campaigns.ts, which is where the guards
// are. A route decides WHO may ask; the domain layer decides whether it is
// allowed and what else must happen.

const API_ROOT = join(__dirname, '..', '..', 'app', 'api');

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

describe('campaign status transitions have a single implementation', () => {
  const files = routeFiles(API_ROOT);

  // Anti-no-op: if the API tree moves or the walk breaks, fail loudly rather
  // than silently guarding zero files.
  it('finds route handlers to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const rel = file.slice(file.indexOf('src/'));
    it(`${rel} does not write campaigns.status itself`, () => {
      const body = readFileSync(file, 'utf8');
      const touchesCampaigns = /\.from\(\s*['"]campaigns['"]\s*\)/.test(body);
      // A status write is an update whose payload names `status`. Reads and
      // updates of other columns (capture_status on the hold path, charge_status
      // on close-charge) are legitimate and must not trip this.
      const writesStatus = /\.update\(\s*\{[^}]*\bstatus\s*:/.test(body);
      expect(
        touchesCampaigns && writesStatus,
        `${rel} appears to set campaigns.status directly. Call activateCampaign / ` +
          'pauseCampaign / closeCampaign from src/lib/data/campaigns.ts instead — ' +
          'they carry the J5 hold check, the past-event refusal, the active-event ' +
          'requirement, the ops alert and the auto-thankyou seed, none of which are ' +
          'visible from the call site.',
      ).toBe(false);
    });
  }
});
