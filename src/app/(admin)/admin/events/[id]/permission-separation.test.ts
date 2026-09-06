import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The staff event page exists because /app/events/{id} authorizes on OWNERSHIP
// alone — the platform owner holding all eleven permissions still gets a 404 on
// a customer's event, including from the business calendar entry that links
// there. The owner's condition for building it was one sentence: "אתה חייב
// להפריד בין ההרשאות" (2026-09-07).
//
// This file pins that separation textually, because it is the kind of property
// that decays silently: a later edit that reads the owner's phone number "while
// we're here", or swaps a section's hasPlatformPermission for the redirecting
// requirePlatformPermission, breaks nothing at runtime for the platform owner —
// who passes every check — and would only surface for a staff member holding a
// single key.

const ROOT = join(__dirname, '..', '..', '..', '..', '..', '..');
const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
const dataLayer = readFileSync(
  join(ROOT, 'src', 'lib', 'data', 'admin', 'event-view.ts'),
  'utf8',
);
const calendar = readFileSync(
  join(ROOT, 'src', 'lib', 'data', 'event-exchange-sync.ts'),
  'utf8',
);

describe('the page itself asks for the weakest key only', () => {
  it("requires 'view_events' and redirects on nothing else", () => {
    const required = [...page.matchAll(/requirePlatformPermission\('([a-z_.]+)'\)/g)].map(
      (m) => m[1],
    );
    expect(required).toEqual(['view_events']);
  });

  it('checks every other capability without redirecting', () => {
    // requirePlatformPermission redirects to /app. Used for a SECTION it would
    // bounce a viewer off a page they are entitled to see — e.g. someone
    // holding manage_voice but not manage_billing.
    for (const key of [
      'manage_billing',
      'manage_voice',
      'view_customer_data',
      'manage_staff',
      'view_activity_log',
      'view_recordings',
    ]) {
      expect(page).toContain(`hasPlatformPermission('${key}')`);
      expect(page).not.toContain(`requirePlatformPermission('${key}')`);
    }
  });

  it('renders a section as absent rather than disabled when the key is missing', () => {
    // Each link is PUSHED behind its own check; there is no always-rendered
    // control that merely looks unavailable.
    expect(page).toMatch(/if \(canBilling && event\.campaignId\) \{\s*links\.push/);
    expect(page).toMatch(/if \(canVoice\) \{\s*links\.push/);
    expect(page).toMatch(/if \(canCustomerData\) \{\s*links\.push/);
    expect(page).toMatch(/if \(canStaff\) \{\s*links\.push/);
    expect(page).toMatch(/if \(canActivity\) \{\s*links\.push/);
    expect(page).toMatch(/if \(canRecordings\) \{\s*links\.push/);
  });

  it('says so when a viewer holds none of them, instead of rendering an empty card', () => {
    expect(page).toContain('links.length === 0');
    expect(page).toContain('אין לך הרשאות נוספות לאירוע הזה');
  });
});

describe("'view_events' buys the event's identity and nothing more", () => {
  it('selects only identifying columns', () => {
    const at = dataLayer.indexOf('const STAFF_EVENT_COLUMNS');
    const columns = dataLayer.slice(at, dataLayer.indexOf(';', at));
    for (const forbidden of ['celebrants', 'venue_address', 'notes', 'package']) {
      expect(columns).not.toContain(forbidden);
    }
    for (const required of ['name', 'event_date', 'rsvp_deadline', 'status', 'venue_name']) {
      expect(columns).toContain(required);
    }
  });

  it('never reads the owner’s contact details or the guest list', () => {
    // Those are view_customer_data, served by /admin/support behind its
    // mandatory break-glass reason. This module links there; it never inlines it.
    expect(dataLayer).not.toContain("from('profiles')");
    expect(dataLayer).not.toContain("from('guests')");
    expect(dataLayer).not.toContain('auth.admin.getUserById');
  });

  it('takes the campaign id only, never its status or money', () => {
    const at = dataLayer.indexOf("from('campaigns')");
    expect(at).toBeGreaterThan(-1);
    expect(dataLayer.slice(at, at + 120)).toContain(".select('id')");
  });

  it('audits before it reads, and needs no reason to do so', () => {
    // 'view_events' is deliberately NOT in BREAK_GLASS_PERMISSIONS: a typed
    // reason to find out when an event is would be reason-fatigue.
    expect(dataLayer.indexOf('recordStaffAccess')).toBeLessThan(
      dataLayer.indexOf('STAFF_EVENT_COLUMNS)'),
    );
    expect(dataLayer).toContain("permission: 'view_events'");
    expect(dataLayer).not.toContain('reason:');
  });
});

describe('the calendar entry points at a door staff can open', () => {
  it('links to the staff page, not the ownership-gated customer page', () => {
    expect(calendar).toContain('getAppUrl(`/admin/events/${eventId}`)');
    expect(calendar).not.toContain('getAppUrl(`/app/events/${eventId}`)');
  });
});
