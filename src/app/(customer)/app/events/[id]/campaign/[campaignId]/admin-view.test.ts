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
// Half a fix is the failure mode here, and the first pass proved it: reaching
// the page fixed nothing for the DELIVERY and THANK-YOU reads, which kept using
// the owner path. Those return null for staff rather than throwing, so the page
// rendered "add contacts and start activity" over a customer's live campaign.
// Every read on this page must take the same branch.

const pageSrc = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
// Resolved from the repo root rather than by counting `..` up seven route
// segments — a route rename would silently break that count.
const adminLayerSrc = readFileSync(
  join(process.cwd(), 'src', 'lib', 'data', 'admin', 'campaigns.ts'),
  'utf8',
);

/** The body of a top-level function declaration, up to its closing brace. */
function bodyOf(src: string, decl: string): string {
  const at = src.indexOf(decl);
  expect(at, `${decl} not found`).toBeGreaterThan(-1);
  const fn = src.slice(at);
  return fn.slice(0, fn.indexOf('\n}\n') + 1);
}

describe('campaign page — admin cross-tenant view', () => {
  it('branches EVERY customer-data read on isAdmin(), not just the campaign', () => {
    for (const reader of [
      'getEventForAdminView',
      'getCampaignForAdminView',
      'getCampaignDeliveryForAdminView',
      'getThankyouScheduleForAdminView',
    ]) {
      expect(pageSrc, reader).toContain(reader);
    }
    // Each branch must be conditional, never a bare owner-path call.
    expect(pageSrc).toMatch(/admin\s*\n?\s*\?\s*await getCampaignForAdminView/);
    expect(pageSrc).toMatch(/admin\s*\n?\s*\?\s*await getCampaignDeliveryForAdminView/);
    expect(pageSrc).toMatch(/admin\s*\n?\s*\?\s*await getThankyouScheduleForAdminView/);
  });

  it('still uses the owner path for non-admins — the fix must not widen access', () => {
    expect(pageSrc).toContain('getCampaign(campaignId)');
    expect(pageSrc).toContain('getCampaignDeliveryBreakdown(campaignId)');
    expect(pageSrc).toContain('getThankyouSchedule(campaignId)');
    expect(pageSrc).toContain('requireEventAccess');
  });

  it('gates on a platform permission before touching data, and audits first', () => {
    const gate = bodyOf(adminLayerSrc, 'async function auditedCampaignAccess');
    expect(gate).toContain("requirePlatformPermission('manage_billing')");
    // The gate must precede the service-role client, not follow it.
    expect(gate.indexOf('requirePlatformPermission')).toBeLessThan(
      gate.indexOf('createAdminClient'),
    );
    // …and the fail-closed audit row must precede the caller getting anything back.
    expect(gate).toContain('recordStaffAccess');
    expect(gate).toContain("subjectType: 'campaign'");
    expect(gate.indexOf('recordStaffAccess')).toBeLessThan(gate.indexOf('return {'));
  });

  it('routes every admin reader through that one audited gate', () => {
    // This is the whole reason the fix is NOT an RLS policy: a policy grants the
    // read silently, and service-role carries no user identity, so "who read
    // this customer's campaign" can only be answered here. A reader that skips
    // the gate is an unlogged cross-tenant read.
    for (const decl of [
      'export async function getCampaignForAdminView',
      'export async function getCampaignDeliveryForAdminView',
      'export async function getThankyouScheduleForAdminView',
    ]) {
      const body = bodyOf(adminLayerSrc, decl);
      expect(body, decl).toContain('await auditedCampaignAccess(campaignId)');
      expect(body.indexOf('auditedCampaignAccess'), decl).toBeLessThan(
        body.indexOf('createAdminClient'),
      );
    }
  });

  it('selects the same columns / runs the same query as the owner path, so the two cannot drift', () => {
    expect(adminLayerSrc).toContain('CAMPAIGN_COLUMNS');
    expect(adminLayerSrc).toContain("from '@/lib/data/campaigns'");
    // The delivery breakdown is one shared fetch, parameterised by client.
    expect(adminLayerSrc).toContain('fetchDeliveryBreakdown(createAdminClient(), campaignId)');
    const ownerSrc = readFileSync(
      join(process.cwd(), 'src', 'lib', 'data', 'campaign-delivery.ts'),
      'utf8',
    );
    expect(ownerSrc).toContain('return fetchDeliveryBreakdown(supabase, campaignId)');
  });
});

// A read that returned nothing was rendered as a statement about the customer's
// campaign ("add contacts and start activity") on a campaign that had both.
// Loaded, could-not-load and genuinely-empty are three different facts.
describe('campaign page — a failed read must never read as an empty campaign', () => {
  it('never swallows an error into a silent null', () => {
    // `catch {}` with no binding is the shape that produced this bug.
    expect(pageSrc).not.toMatch(/catch\s*\{/);
    // Next's own control-flow throws must still propagate.
    expect(pageSrc).toContain('unstable_rethrow');
  });

  it('tracks each read failure separately', () => {
    for (const flag of ['summaryFailed', 'deliveryFailed', 'thankyouFailed']) {
      expect(pageSrc, flag).toContain(flag);
    }
    // A null delivery means "invisible to this reader", not "no contacts".
    expect(pageSrc).toContain('if (!delivery) deliveryFailed = true');
  });

  it('renders the failure instead of the empty state', () => {
    const manage = readFileSync(join(__dirname, 'manage-client.tsx'), 'utf8');
    expect(manage).toContain('LoadFailureNotice');
    // The failure branch must be checked BEFORE the "no data yet" branch.
    const failAt = manage.indexOf('deliveryFailed ? (');
    const emptyAt = manage.indexOf('נתוני המסירה והתוצאות יוצגו לאחר');
    expect(failAt).toBeGreaterThan(-1);
    expect(failAt).toBeLessThan(emptyAt);
  });

  it('does not ask for contacts the campaign already has', () => {
    const manage = readFileSync(join(__dirname, 'manage-client.tsx'), 'utf8');
    expect(manage).toContain('authorizedCount != null && authorizedCount > 0');
  });
});

// The form must render exactly where the write can succeed — no wider, no
// narrower. updateThankyouSchedule accepts the event's owner OR platform staff
// holding manage_billing (the same permission behind close/settle/cancel on this
// page); an org member with campaigns:view is neither, and would get a control
// whose submit is guaranteed to be refused.
describe('thank-you schedule — form only where the write can succeed', () => {
  it('mirrors the write gate: owner OR platform staff', () => {
    expect(pageSrc).toContain('admin || (await viewerOwnsCampaignEvent(campaignId))');
    expect(pageSrc).toContain('canEditThankyou={canEditThankyou}');
  });

  it('the write itself accepts both, and audits the staff branch', () => {
    const campaignsSrc = readFileSync(
      join(process.cwd(), 'src', 'lib', 'data', 'campaigns.ts'),
      'utf8',
    );
    const body = bodyOf(campaignsSrc, 'export async function updateThankyouSchedule');
    // Identity comes from the session, never from an argument the page supplies.
    expect(body).toContain('requireUser()');
    expect(body).toContain('owner_id === user.id');
    expect(body).toContain('requireOwnedEvent');
    expect(body).toContain("requirePlatformPermission('manage_billing')");
    // A cross-tenant WRITE through service_role must leave a trace.
    expect(body).toContain('recordStaffAccess');
    expect(body.indexOf('recordStaffAccess')).toBeLessThan(body.indexOf('.update('));
  });

  it('the ownership helper asks about ownership, not org access', () => {
    const campaignsSrc = readFileSync(
      join(process.cwd(), 'src', 'lib', 'data', 'campaigns.ts'),
      'utf8',
    );
    const body = bodyOf(campaignsSrc, 'export async function viewerOwnsCampaignEvent');
    expect(body).toContain('requireUser');
    expect(body).toContain('owner_id');
    // requireEventAccess is org-aware and would answer a different question.
    expect(body).not.toContain('requireEventAccess');
  });

  it('shows the schedule read-only to a viewer who cannot change it', () => {
    const manage = readFileSync(join(__dirname, 'manage-client.tsx'), 'utf8');
    expect(manage).toContain('ThankyouScheduleReadOnly');
    expect(manage).toMatch(/canEditThankyou\s*\?\s*\(/);
  });
});

// The page was six stacked cards with about a dozen more bordered boxes nested
// inside them; on a phone that read as a column of frames. Three cards now, and
// the tile/box components that produced the nesting are gone rather than unused.
describe('page structure — three cards, no nesting', () => {
  const manage = readFileSync(join(__dirname, 'manage-client.tsx'), 'utf8');

  it('has one card per subject', () => {
    for (const merged of ['CampaignStatusAndBilling', 'DeliveryBreakdown', 'ActionsPanel']) {
      expect(manage, merged).toContain(`function ${merged}(`);
    }
    // The cards these replaced must not come back alongside them.
    for (const gone of ['function CampaignSummary(', 'function BillingOverview(', 'function OwnerActions(', 'function AdminActions(']) {
      expect(manage, gone).not.toContain(gone);
    }
  });

  it('drops the tile component that boxed every single figure', () => {
    expect(manage).not.toContain('CompactMetric');
  });

  it('stacks in reading order on mobile instead of hoisting the buttons', () => {
    // `order-1`/`order-2` put the action column above the numbers on small
    // screens; with one actions card there is nothing left to hoist.
    expect(manage).not.toMatch(/className="[^"]*\border-[12]\b/);
  });
});

// Tailwind 4 compiles `divide-x` to border-inline-start/end, which already
// respects direction. `divide-x-reverse` was the v3 work-around for RTL and is
// actively wrong here: it moves the rule to inline-start — the RIGHT side in
// Hebrew — so the FIRST metric gained a stray vertical rule on the outer edge
// of the row. Verified in the compiled stylesheet before removing it.
describe('RTL: divide utilities', () => {
  it('never pairs divide-x with the v3 reverse work-around', () => {
    // Asserts on className VALUES, not on any occurrence of the string: the
    // comment above the fixed line names the utility on purpose, to explain why
    // it is absent, and a naive text search would flag that explanation.
    const manage = readFileSync(join(__dirname, 'manage-client.tsx'), 'utf8');
    for (const src of [pageSrc, manage]) {
      const classNames = [...src.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
      for (const cls of classNames) {
        expect(cls, cls).not.toMatch(/\bdivide-[xy]-reverse\b/);
      }
    }
  });
});
