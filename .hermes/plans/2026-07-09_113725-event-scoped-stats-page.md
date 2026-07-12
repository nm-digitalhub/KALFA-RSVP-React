# Event-Scoped Stats Page — Implementation Plan (incl. code)

> Plan + implementation guidance only. Do not edit project files until executing the
> tasks below, task by task, with tests passing before claiming done.

**Goal.** Customer-only event stats page at `/app/events/[id]/stats`: RSVP/headcount KPIs,
response/attending rates, existing-param drill-down, optional campaign/delivery/billing
snapshots, derived alerts, refresh, RTL/accessibility/empty/error states, focused tests.

**Verified facts (live schema, live code, live Next.js 16 docs via ctx7 — not assumptions):**

- Live permission catalog includes `events.view`, `guests.view`, `contacts.view`,
  `campaigns.view`, `reports.view`, `billing.view`.
- `requireEventAccess(eventId, resource, action)` → live RPC `can_access_event`. Data-driven
  (no hardcoded union).
- `getEvent(eventId)` (`src/lib/data/events.ts:244`) is RLS-scoped for owner or shared-org
  member with `events.view`; throws `notFound()` when invisible. **Org-aware, not owner-only**
  → usable as-is for the event header.
- `getGuestTotals(eventId)` (`src/lib/data/guests.ts:623`) gates with
  `requireEventAccess(eventId,'guests','view')` then calls RPC `guest_totals(_event_id)`.
  Returns `GuestTotals` with `rows, invited_people, attending_rows, attending_people,
  declined_rows, maybe_rows, pending_rows, over_invited_rows, over_invited_people`.
- `getCampaignForEvent(eventId)` (`src/lib/data/campaigns.ts:253`) gates with
  `requireEventAccess(eventId,'campaigns','view')`, returns `OwnerCampaign | null`.
- `getCampaignDeliveryBreakdown(campaignId)` (`src/lib/data/campaign-delivery.ts:112`) resolves
  campaign event via RLS then calls `requireOwnedEvent(campaign.event_id)` (line 125). This is
  owner-only → **must be changed to org-aware**.
- `getCampaignBillingSummary(campaignId)` uses service-role RPC, no internal auth → must only be
  called after `billing.view` proven.
- Next.js 16.2.2 (ctx7 docs): page `params` is `Promise<{ id: string }>`, `const { id } = await params`.
  Dynamic APIs (`cookies()`, `headers()`) are async in v16. Server Components colocate data
  fetching; use `cache: 'no-store'` for fresh data. All consistent with existing route files.

---

## 1. Scope locks (do NOT do)

- No DB migration. No manual `src/lib/supabase/types.ts` edits. No realtime. No CSV export.
- No RSVP trend/line chart. No admin dashboard v2. No new guest filters.
- No broad refactors. No deploy-script idempotency in this commit (separate hardening item).

---

## 2. RBAC contract (layered)

Entry + sections:
- Page gate: `requireEventAccess(eventId, 'reports', 'view')`. If it throws, propagate
  (auth/control-flow error, do NOT swallow).
- Event header: `requireEventAccess(eventId, 'events', 'view')` (via `getEvent`).
- RSVP/headcount: `guests.view` (already inside `getGuestTotals`).
- Campaign operational + delivery: `campaigns.view`.
- Monetary billing: both `campaigns.view` **and** `billing.view`. If `campaigns.view` missing,
  do NOT attempt billing lookup even if `billing.view` present (avoids leaking campaign existence).

Optional-section handling (critical): do NOT build permission-limited states via broad
`try/catch`. Add an explicit boolean check `canAccessEvent(eventId, resource, action)` (thin wrapper
around the live `can_access_event` RPC, returns boolean) and branch on its boolean. Only catch
**operational** errors after the relevant permission is proven. Return DTO section states:
`visible | permission_limited | empty | error`.

If `reports.view` passes but a source permission fails: hide that section / render a
non-sensitive "אין הרשאה להציג" state. Never reveal whether a hidden resource exists.

---

## 3. Files to create / modify

Create:
- `src/lib/data/event-stats.ts` — DAL boundary + pure derivation.
- `src/lib/data/event-stats.test.ts` — pure + DAL + no-PII tests.
- `src/app/(customer)/app/events/[id]/stats/page.tsx` — the route.
- `src/app/(customer)/app/events/[id]/stats/refresh-button.tsx` — client refresh.

Modify:
- `src/lib/data/campaign-delivery.ts` — replace owner gate with org-aware gate (Task 5).
- `src/app/(customer)/app/events/[id]/page.tsx` — add "סטטיסטיקות" nav button (Task 8).

---

## 4. Task 1 — pure derivation + tests

Create `src/lib/data/event-stats.ts` (types + pure helpers only, NO db):

```ts
import type { GuestTotals } from '@/lib/data/guests';

export type EventStatsPercentages = {
  responseRate: number;   // 0..100, people-agnostic (rows)
  attendingRate: number;  // 0..100 by rows
  attendingPeopleRate: number | null; // 0..100 by people, null when invited_people=0
};

export type EventStatsAlertId =
  | 'high_pending'
  | 'failed_deliveries'
  | 'wrong_numbers'
  | 'over_invited'
  | 'ceiling_near_usage'
  | 'campaign_closed_not_settled';

export type EventStatsAlert = { id: EventStatsAlertId; label: string };

export function derivePercentages(t: GuestTotals): EventStatsPercentages {
  const rows = t.rows || 0;
  const responded = (t.attending_rows ?? 0) + (t.declined_rows ?? 0) + (t.maybe_rows ?? 0);
  const attendingPeople = t.invited_people || 0;
  return {
    responseRate: rows ? Math.round((responded / rows) * 100) : 0,
    attendingRate: rows ? Math.round((t.attending_rows / rows) * 100) : 0,
    attendingPeopleRate:
      attendingPeople ? Math.round((t.attending_people / attendingPeople) * 100) : null,
  };
}

export function deriveStatsAlerts(input: {
  totals?: GuestTotals;
  delivery?: { failed: number; wrongNumber: number } | null;
  billing?: { accrued: number; ceiling: number } | null;
  campaign?: { status: string; finalChargeAmount: number | null } | null;
}): EventStatsAlert[] {
  const alerts: EventStatsAlert[] = [];
  const t = input.totals;
  if (t) {
    const pending = (t.pending_rows ?? 0) + (t.maybe_rows ?? 0);
    if (t.rows > 0 && pending / t.rows >= 0.5) {
      alerts.push({ id: 'high_pending', label: 'מספר גבוה של מוזמנים טרם השיבו' });
    }
    if ((t.over_invited_rows ?? 0) > 0) {
      alerts.push({ id: 'over_invited', label: 'חריגה ממספר המוזמנים המשוער' });
    }
  }
  if (input.delivery) {
    if (input.delivery.failed > 0)
      alerts.push({ id: 'failed_deliveries', label: 'שליחות שנכשלו' });
    if (input.delivery.wrongNumber > 0)
      alerts.push({ id: 'wrong_numbers', label: 'מספרי טלפון שגויים' });
  }
  if (input.billing && input.billing.ceiling > 0) {
    if (input.billing.accrued / input.billing.ceiling >= 0.9) {
      alerts.push({ id: 'ceiling_near_usage', label: 'קירבה לתקרת החיוב' });
    }
  }
  if (
    input.campaign &&
    input.campaign.status === 'closed' &&
    input.campaign.finalChargeAmount == null
  ) {
    alerts.push({ id: 'campaign_closed_not_settled', label: 'קמפיין סגור וטרם נסגר חשבונית' });
  }
  return alerts;
}
```

Tests (`event-stats.test.ts`) — pure cases:
1. `derivePercentages` rows=0 → all zeros / null.
2. response rate = (attending+declined+maybe)/rows.
3. attending rate = attending_rows/rows.
4. attending people rate = attending_people/invited_people (null when invited_people=0).
5. `deriveStatsAlerts` high_pending when pending/rows ≥ 0.5.
6. failed deliveries / wrong numbers when counts > 0.
7. over_invited when over_invited_rows > 0.
8. ceiling_near_usage when accrued/ceiling ≥ 0.9.
9. campaign_closed_not_settled when status='closed' && finalChargeAmount==null.

Run: `npx vitest run src/lib/data/event-stats.test.ts` → expect FAIL (file not implemented yet).

---

## 5. Task 2 — DAL orchestration tests (mock existing modules)

In `event-stats.test.ts` add orchestration tests mocking:
`@/lib/data/events` (getEvent, requireEventAccess), `@/lib/data/guests` (getGuestTotals),
`@/lib/data/campaigns` (getCampaignForEvent), `@/lib/data/billing` (getCampaignBillingSummary),  // returns BillingSummary { reachedCount, accrued, ceiling, maxContacts }
`@/lib/data/campaign-delivery` (getCampaignDeliveryBreakdown), `@/lib/data/events` (requireEventAccess, canAccessEvent).

Cases:
- Empty event → zeros, no campaign/delivery/billing, no PII.
- No campaign → RSVP stats + percentages only.
- Campaign with delivery failures → delivery snapshot + failed-delivery alert.
- Over-invited → over-invited alert + drill-down `/guests?over=1`.
- Page gate `reports.view` called before any source load.
- Source perms: `events.view`→header, `guests.view`→RSVP, `campaigns.view`→campaign/delivery,
  `campaigns.view`+`billing.view`→billing.
- Permission-limited: `reports.view` ok but `campaigns.view` false → non-sensitive campaign state,
  no campaign-existence leak.
- Billing not called without `billing.view` (or without `campaigns.view`).
- Delivery/billing operational failure after auth → `error` flag, no raw error exposed.

Run → expect FAIL.

---

## 6. Task 3 — implement `getEventStats(eventId)`

Append to `src/lib/data/event-stats.ts`:

```ts
import 'server-only';
import { canAccessEvent } from '@/lib/data/events';
import { getEvent } from '@/lib/data/events';
import { getGuestTotals, type GuestTotals } from '@/lib/data/guests';
import { getCampaignForEvent, type OwnerCampaign } from '@/lib/data/campaigns';
import { getCampaignDeliveryBreakdown, type CampaignDeliveryBreakdown } from '@/lib/data/campaign-delivery';
import { getCampaignBillingSummary, type BillingSummary } from '@/lib/data/billing';

export type SectionState = 'visible' | 'permission_limited' | 'empty' | 'error';

export type EventStatsResult = {
  event: { id: string; name: string; eventType: string | null; eventDate: string | null; rsvpDeadline: string | null; status: string | null } | null;
  eventState: SectionState;
  totals: GuestTotals | null;
  totalsState: SectionState;
  percentages: EventStatsPercentages | null;
  campaign: {
    state: SectionState;
    id: string | null;
    status: string | null;
    captureStatus: string | null;
    maxContacts: number | null;
    reachedCount: number | null; // operational, from delivery aggregation
    delivery: { sent: number; delivered: number; read: number; failed: number; reached: number; wrongNumber: number; optedOut: number } | null;
    billing: { reachedCount: number; accrued: number; ceiling: number; maxContacts: number } | null;
  };
  alerts: EventStatsAlert[];
};

export async function getEventStats(eventId: string): Promise<EventStatsResult> {
  // 1) page gate
  await requireEventAccess(eventId, 'reports', 'view');

  // 2) event header (events.view, via org-aware getEvent)
  let event: EventStatsResult['event'] = null;
  let eventState: SectionState = 'visible';
  if (await canAccessEvent(eventId, 'events', 'view')) {
    try {
      const e = await getEvent(eventId);
      event = { id: e.id, name: e.name, eventType: e.event_type ?? null, eventDate: e.event_date ?? null, rsvpDeadline: e.rsvp_deadline ?? null, status: e.status ?? null };
    } catch {
      eventState = 'error';
    }
  } else {
    eventState = 'permission_limited';
  }

  // 3) RSVP/headcount (guests.view)
  let totals: GuestTotals | null = null;
  let totalsState: SectionState = 'visible';
  const guestsOk = await canAccessEvent(eventId, 'guests', 'view');
  if (guestsOk) {
    try { totals = await getGuestTotals(eventId); } catch { totalsState = 'error'; }
  } else {
    totalsState = 'permission_limited';
  }
  const percentages = totals ? derivePercentages(totals) : null;

  // 4) campaign operational + delivery (campaigns.view)
  let campaign: EventStatsResult['campaign'] = { state: 'empty', id: null, status: null, captureStatus: null, maxContacts: null, reachedCount: null, delivery: null, billing: null };
  const campaignsOk = await canAccessEvent(eventId, 'campaigns', 'view');
  if (!campaignsOk) {
    campaign.state = 'permission_limited';
  } else {
    let c: OwnerCampaign | null = null;
    try { c = await getCampaignForEvent(eventId); } catch { campaign.state = 'error'; }
    if (c) {
      campaign.id = c.id;
      campaign.status = c.status ?? null;
      campaign.captureStatus = c.capture_status ?? null;
      campaign.maxContacts = c.max_contacts ?? null;
      campaign.state = 'visible';
      // delivery (org-aware after fix)
      try {
        const d: CampaignDeliveryBreakdown | null = await getCampaignDeliveryBreakdown(c.id);
        if (d) {
          campaign.delivery = { sent: d.delivery.sent, delivered: d.delivery.delivered, read: d.delivery.read, failed: d.delivery.failed, reached: d.outcome.reached, wrongNumber: d.outcome.wrongNumber, optedOut: d.outcome.optedOut };
          campaign.reachedCount = d.outcome.reached; // operational reached from delivery
        }
      } catch { campaign.state = 'error'; }
      // 5) billing (campaigns.view AND billing.view)
      const billingOk = await canAccessEvent(eventId, 'billing', 'view');
      if (billingOk) {
        try {
          const b: BillingSummary | null = await getCampaignBillingSummary(c.id);
          if (b) campaign.billing = { reachedCount: b.reachedCount, accrued: b.accrued, ceiling: b.ceiling, maxContacts: b.maxContacts };
        } catch { campaign.state = 'error'; }
      }
    }
  }

  // 6) alerts from authorized sections only
  const alerts = deriveStatsAlerts({
    totals: totals ?? undefined,
    delivery: campaign.delivery ? { failed: campaign.delivery.failed, wrongNumber: campaign.delivery.wrongNumber } : null,
    billing: campaign.billing ? { accrued: campaign.billing.accrued, ceiling: campaign.billing.ceiling } : null,
    campaign: campaign.id ? { status: campaign.status ?? '', finalChargeAmount: c.final_charge_amount ?? null } : null,
  });

  return { event, eventState, totals, totalsState, percentages, campaign, alerts };
}
```

Helper `canAccessEvent(eventId, resource, action)` (thin boolean visibility helper):
A thin boolean wrapper around the **single source of truth** `can_access_event` RPC — mirrors the
existing `can` helper in `src/lib/permissions.ts` exactly. It does NOT duplicate authorization logic
and does NOT read `owner_id`/`org_id` in TypeScript. It returns a `boolean` (false on denied OR on
any RPC/client error — fail-closed, per the `can` pattern) instead of throwing `notFound()`, so it
can drive optional-section UI (visible vs permission_limited) without killing the whole page.

**HARD USAGE BOUNDARY (enforced in code + review):**
- `canAccessEvent` is a **visibility helper for optional UI sections only**.
- It MAY be called ONLY after the `reports.view` page gate (`requireEventAccess(eventId,'reports','view')`) has passed.
- It MUST return `false` on denied AND on operational/RPC/client error (fail-closed). The only
  downstream effect is hiding a section or rendering a `permission_limited` state — never a
  security decision.
- FORBIDDEN uses (these MUST keep using `requireEventAccess` / `requireUser` / `requireAdmin`):
  page access, Server Actions, mutations, service-role writes, billing/payment operations, or ANY
  path that needs to distinguish "denied" from "operational failure". For those, use the throwing
  gates — never this boolean helper.
- No `getEventOrg`. No `can(orgId, ...)`. No `owner_id`/`org_id` authorization logic in TS.

```ts
// in src/lib/data/events.ts — thin boolean VISIBILITY helper ONLY (NOT an auth gate).
// FAIL-CLOSED: returns false on denied OR on any RPC/client error. The only effect is
// hiding an optional UI section or showing a permission_limited state. Every mandatory
// gate stays on requireEventAccess/requireUser/requireAdmin. Reuses the exact same
// can_access_event RPC as requireEventAccess; never reads owner_id/org_id; never duplicates
// authorization logic. Mirrors `can` in src/lib/permissions.ts (cache + false-on-error).
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/auth/dal';

export const canAccessEvent = cache(
  async (eventId: string, resource: string, action: string = 'view'): Promise<boolean> => {
    const user = await getUser();
    if (!user) return false; // no session → hide section (page gate already redirected)
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('can_access_event', {
      _event_id: eventId,
      _resource: resource,
      _action: action,
    });
    if (error) return false; // operational failure → fail-closed, hide section
    return data === true;
  },
);

// DO NOT use canAccessEvent for: page access, server actions, mutations, service-role
// writes, billing/payment ops, or any decision that must tell denied from error.
// Those use requireEventAccess / requireUser / requireAdmin (throwing gates).
```

Notes:
- `requireEventAccess(eventId, ...)` is used for the mandatory `reports.view` page gate and inside
  every existing DAL (`getEvent`, `getGuestTotals`, `getCampaignForEvent`, and after Task 4 also
  `getCampaignDeliveryBreakdown`). `canAccessEvent` is ONLY the boolean branch for optional sections,
  and only AFTER the page gate passed.
- `canAccessEvent` mirrors `can` (permissions.ts): `cache()` so repeated checks share one RPC
  round-trip; `getUser()` null → false; `error` → false; `data === true` → true. It never throws.
- `getCampaignBillingSummary` is STILL forbidden unless both `campaigns.view` AND `billing.view`
  are proven first (via `canAccessEvent(eventId,'campaigns','view')` AND
  `canAccessEvent(eventId,'billing','view')`). The operational `reachedCount` for users WITHOUT
  `billing.view` comes from `getCampaignDeliveryBreakdown(...).outcome.reached` (campaigns.view
  only) — never from `campaign_billing_summary`.
- No `rsvp_token`, `gift_link_token`, `card_token_ref`, `card_citizen_id`, `payload_meta`, phones,
  provider ids are ever selected or returned.

Run: `npx vitest run src/lib/data/event-stats.test.ts` → expect PASS.

---

## 7. Task 4 — fix delivery authorization (org-aware)

File `src/lib/data/campaign-delivery.ts`, line ~125. Replace:

```ts
  await requireOwnedEvent(campaign.event_id); // defense-in-depth ownership gate
```
with:
```ts
  await requireEventAccess(campaign.event_id, 'campaigns', 'view'); // org-aware, not owner-only
```

Keep everything else (RLS read, batching, no-PII projection). Add/adjust test in
`src/lib/data/campaign-delivery.test.ts` (or `event-stats.test.ts`): assert
`requireEventAccess` called with `campaigns`,`view`; `requireOwnedEvent` NOT called; aggregation
unchanged for sent/delivered/read/failed/reached/wrong/optedOut.

Run: `npx vitest run src/lib/data/campaign-delivery.test.ts src/lib/data/event-stats.test.ts`.

---

## 8. Task 5 — refresh button

`src/app/(customer)/app/events/[id]/stats/refresh-button.tsx`:

```tsx
'use client';
import { useRouter } from 'next/navigation';
export function RefreshButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="inline-flex items-center gap-1 text-sm ...">
      רענון נתונים
    </button>
  );
}
```

No polling, no realtime, no Server Action.

---

## 9. Task 6 — stats page

`src/app/(customer)/app/events/[id]/stats/page.tsx`:

```tsx
import Link from 'next/link';
import { getEventStats } from '@/lib/data/event-stats';
import { RefreshButton } from './refresh-button';

export default async function StatsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: eventId } = await params;
  const stats = await getEventStats(eventId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href={`/app/events/${eventId}`} className="text-sm text-muted-foreground">חזרה לאירוע</Link>
          <h1 className="text-2xl font-bold">סטטיסטיקות</h1>
          {stats.event && <p className="text-sm text-muted-foreground">{stats.event.name}</p>}
        </div>
        <RefreshButton />
      </div>

      {/* RSVP KPIs */}
      {stats.totalsState === 'visible' && stats.totals && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* invited people / rows, attending, declined, maybe, pending, over-invited,
              response rate, attending rate — same structure as guests page totals */}
        </dl>
      )}
      {stats.totalsState === 'permission_limited' && <p className="text-sm text-muted-foreground">אין הרשאה להצגת נתוני מוזמנים</p>}

      {/* Campaign operational */}
      {stats.campaign.state === 'visible' && stats.campaign.id && (
        <section>
          {/* status, captureStatus (non-monetary), maxContacts, reachedCount (operational),
              delivery sent/delivered/read/failed/reached/wrongNumber/optedOut */}
          <Link href={`/app/events/${eventId}/campaign/${stats.campaign.id}`}>פרטי קמפיין</Link>
        </section>
      )}
      {stats.campaign.state === 'permission_limited' && <p className="text-sm text-muted-foreground">אין הרשאה להצגת נתוני קמפיין</p>}

      {/* Billing — only when billing present */}
      {stats.campaign.billing && (
        <section>
          {/* reachedCount, accrued, ceiling, maxContacts — NO charge_document_url, no tokens, no balance/finalChargeAmount (not in BillingSummary) */}
        </section>
      )}

      {/* Alerts */}
      {stats.alerts.length > 0 && (
        <ul className="space-y-2">
          {stats.alerts.map((a) => <li key={a.id}>{a.label}</li>)}
        </ul>
      )}

      {/* Errors (non-sensitive) */}
      {stats.campaign.state === 'error' && <p className="text-sm text-warning">חלק מנתוני הקמפיין לא נטענו</p>}
    </div>
  );
}
```

Drill-down links (existing params only): `status=attending|declined|maybe|pending`, `over=1`.
RTL/a11y: semantic `h1`/`h2`, `<dl>/<dt>/<dd>` for KPI cards, descriptive Hebrew link text,
percentages not color-only, bars `aria-hidden` if decorative.

Do NOT: use Recharts, add query params, fetch outside `getEventStats`.

---

## 10. Task 7 — nav button on event page

In `src/app/(customer)/app/events/[id]/page.tsx`, near "ניהול מוזמנים", add:
```tsx
<Link href={`/app/events/${event.id}/stats`} className={buttonVariants({ variant: 'outline' })}>
  סטטיסטיקות
</Link>
```
No app-shell/admin nav change.

---

## 11. Task 8 — no-PII regression test

Assert JSON.stringify(getEventStats result) excludes: `rsvp_token`, `gift_link_token`,
`card_token_ref`, `card_citizen_id`, `payload_meta`, `normalized_phone`, `provider_id`, raw tokens.

---

## 12. Verification gates (run in order)

```bash
npx vitest run src/lib/data/event-stats.test.ts
npx vitest run src/lib/data/campaign-delivery.test.ts src/lib/data/event-stats.test.ts
npx vitest run src/lib/data/guests.test.ts src/lib/data/campaigns.test.ts src/lib/data/billing.test.ts src/lib/data/interactions.test.ts
npm run lint
npx tsc --noEmit
npm run test
npm run build
# only if explicitly approved (live DB side effects):
# npm run verify:db
```

---

## 13. Deployment note (separate, not in this commit)

`npm run deploy` fails if `.next` missing (`mv .next .next.old` not idempotent). Fix separately as
pre-deploy hardening if approved.

---

## 14. Acceptance criteria

- `/app/events/[id]/stats` renders for authorized customer users; unauthorized → no access.
- `reports.view` required to enter; `events.view` for header; `guests.view` for RSVP;
  `campaigns.view` for campaign/delivery; `campaigns.view`+`billing.view` for billing.
- Missing source permission → non-sensitive hidden/limited section, not whole-page failure.
- `getCampaignDeliveryBreakdown` org-aware (no `requireOwnedEvent`).
- `getCampaignBillingSummary` never called without `campaigns.view`+`billing.view`.
- Operational reached count from delivery aggregation for users without `billing.view`.
- RSVP KPIs from `guest_totals`; response/attending rates correct; drill-down uses only existing
  params.
- No DB migration, no types.ts edit, no PII in DTO/UI.
- Refresh via `router.refresh()`; focused tests + full gates pass.
