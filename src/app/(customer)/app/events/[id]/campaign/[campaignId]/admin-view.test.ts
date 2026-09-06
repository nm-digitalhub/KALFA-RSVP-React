import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Regression guard for the admin "manage" button in /admin/campaigns, which
// dead-ended on this page for every event the admin did not own.
//
// The page already branched to getEventForAdminView for the EVENT, but then
// read the campaign through the owner path. `campaigns` has exactly one SELECT
// policy — can_access_event(...), which resolves to events.owner_id =
// auth.uid() — so RLS returned zero rows for staff and getCampaign() called
// notFound(). A bare 404 with nothing explaining why.
//
// Half a fix is the failure mode here: both reads must take the same branch.

const pageSrc = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
// Resolved from the repo root rather than by counting `..` up seven route
// segments — a route rename would silently break that count.
const adminLayerSrc = readFileSync(
  join(process.cwd(), 'src', 'lib', 'data', 'admin', 'campaigns.ts'),
  'utf8',
);

describe('campaign page — admin cross-tenant view', () => {
  it('branches BOTH the event and the campaign read on isAdmin()', () => {
    expect(pageSrc).toContain('getEventForAdminView');
    expect(pageSrc).toContain('getCampaignForAdminView');
    // The campaign read must be conditional, never a bare owner-path call.
    expect(pageSrc).toMatch(/admin\s*\n?\s*\?\s*await getCampaignForAdminView/);
  });

  it('still uses the owner path for non-admins — the fix must not widen access', () => {
    expect(pageSrc).toContain('getCampaign(campaignId)');
    expect(pageSrc).toContain('requireEventAccess');
  });

  it('the admin reader gates on a platform permission before touching data', () => {
    const fn = adminLayerSrc.slice(adminLayerSrc.indexOf('export async function getCampaignForAdminView'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
    expect(body).toContain("requirePlatformPermission('manage_billing')");
    // …and the gate must precede the service-role client, not follow it.
    expect(body.indexOf('requirePlatformPermission')).toBeLessThan(body.indexOf('createAdminClient'));
  });

  it('writes a fail-closed audit row BEFORE the cross-tenant read', () => {
    const fn = adminLayerSrc.slice(adminLayerSrc.indexOf('export async function getCampaignForAdminView'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
    expect(body).toContain('recordStaffAccess');
    expect(body).toContain("subjectType: 'campaign'");
    // This is the whole reason the fix is NOT an RLS policy: a policy grants the
    // read silently, and service-role carries no user identity, so "who read
    // this customer's campaign" can only be answered here.
    const auditAt = body.indexOf('recordStaffAccess');
    const selectAt = body.indexOf('CAMPAIGN_COLUMNS');
    expect(auditAt).toBeGreaterThan(-1);
    expect(selectAt).toBeGreaterThan(auditAt);
  });

  it('selects the same column list as the owner path, so the two cannot drift', () => {
    expect(adminLayerSrc).toContain("CAMPAIGN_COLUMNS");
    expect(adminLayerSrc).toContain("from '@/lib/data/campaigns'");
  });
});
