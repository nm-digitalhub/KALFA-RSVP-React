import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard, not a unit test of behavior: proves every admin-only
// data-layer function gates on requireAdmin() BEFORE touching data, so a
// future function that forgets the check fails CI loudly instead of shipping
// a silent authorization gap (found one real instance of this: see
// resolveWebhookAssociations in webhook-inbox.ts, fixed alongside this test).
//
// Approach: split each target file on top-level `export async function`
// boundaries and grep each resulting block for `requireAdmin`. This is a
// textual check, not a real call-graph analysis -- it cannot prove
// requireAdmin() runs before the FIRST data access, only that the function
// references it somewhere in its body. That is enough to catch the class of
// bug this guards against (a function that never calls it at all) while
// staying simple enough not to become its own maintenance burden.

const ROOT = join(__dirname, '..', '..', '..');

// Functions intentionally NOT gated, with the reason a reviewer needs to accept
// before adding an entry here. Every other exported async function in these
// files MUST call one of GATES.
//
// ⚠️ This map is NOT the list of files that get checked. It used to be: the
// suite looped over its keys, so a module absent from it was never scanned and
// "green" on a new file meant nothing was looked at. Measured 2026-09-10: 36
// modules under src/lib/data/admin/, 15 in this map. The scan is now driven by
// readdir (see MODULES below) and this map only records EXEMPTIONS.
const EXEMPT: Record<string, string[]> = {
  'src/lib/data/admin/activity.ts': [],
  'src/lib/data/admin/agreements.ts': [],
  'src/lib/data/admin/callbacks.ts': [],
  'src/lib/data/admin/channels.ts': [],
  'src/lib/data/admin/contacts.ts': [],
  'src/lib/data/admin/dashboard.ts': [],
  'src/lib/data/admin/event-view.ts': [],
  'src/lib/data/admin/events.ts': [],
  'src/lib/data/admin/packages.ts': [],
  'src/lib/data/admin/settings.ts': [],
  'src/lib/data/admin/users.ts': [],
  'src/lib/data/admin/webhook-inbox.ts': [],
  'src/lib/data/admin/access-log-view.ts': [],
  // message-templates.ts is now ONLY the admin surface (listMessageTemplates/
  // updateMessageTemplate, the actual /admin/templates entry points) — both
  // gated, so NO exemptions remain here.
  'src/lib/data/message-templates.ts': [],
  // getTemplateByKey and resolveTemplateForEvent (the event-type-aware variant
  // resolver layered on the same active-only query) are the campaign outreach
  // engine's internal template readers (service-role, read-only, active-only),
  // also used by the worker -- not admin-facing entry points. They live in their
  // own request-free module so the worker can import them WITHOUT pulling the
  // admin surface's requireAdmin/request-scoped createClient into its bundle.
  'src/lib/data/message-templates-resolve.ts': ['getTemplateByKey', 'resolveTemplateForEvent'],
};

function splitIntoFunctionBlocks(source: string): { name: string; body: string }[] {
  const marker = /^export async function (\w+)\(/gm;
  const starts: { name: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = marker.exec(source))) {
    starts.push({ name: m[1], index: m.index });
  }
  return starts.map((s, i) => ({
    name: s.name,
    body: source.slice(s.index, starts[i + 1]?.index ?? source.length),
  }));
}

// The gates a data-layer function may use. `requirePlatformStaff` is the floor
// ("is this person staff at all"); `requirePlatformPermission` is the
// fine-grained capability from the /admin/roles matrix; `requirePlatformOwner`
// is owner-only. `requireAdmin` is the RETIRED axis — still listed so a module
// that has not been migrated is reported as coarse rather than as ungated, but
// nothing under src/lib/data/admin uses it any more (checked below).
const GATES = [
  'requireAdmin',
  'requirePlatformStaff',
  'requirePlatformOwner',
  'requirePlatformPermission',
] as const;

// The permission each module is expected to enforce. Pinning this (rather than
// only "some gate exists") is what makes a SILENT downgrade fail CI: swapping a
// module from `manage_staff` to `view_activity_log`, or back to a bare
// requireAdmin, now breaks the build instead of quietly widening access.
// A module absent from this map must appear in COARSE_GATE_ALLOWED below, with
// a reason — there is no third state. That is what makes a new module fail
// closed instead of slipping through unexamined.
const EXPECTED_PERMISSION: Record<string, string | string[]> = {
  'src/lib/data/admin/activity.ts': 'view_activity_log',
  'src/lib/data/admin/agreements.ts': 'manage_settings',
  'src/lib/data/admin/callbacks.ts': 'view_customer_data',
  'src/lib/data/admin/channels.ts': 'manage_settings',
  'src/lib/data/admin/contacts.ts': 'view_customer_data',
  // Two SEPARATE modules on purpose, one key each — the split the owner asked
  // for on 2026-09-07. event-view.ts answers 'which event is this' and may
  // never grow a billing field; events.ts moves a live event's date and may
  // never become the way to read one. Pinning both here is what stops either
  // from quietly absorbing the other's authority.
  'src/lib/data/admin/event-view.ts': 'view_events',
  'src/lib/data/admin/events.ts': 'manage_billing',
  'src/lib/data/admin/packages.ts': 'manage_billing',
  'src/lib/data/admin/settings.ts': 'manage_settings',
  'src/lib/data/admin/users.ts': 'manage_staff',
  'src/lib/data/admin/webhook-inbox.ts': 'view_webhooks',
  'src/lib/data/admin/access-log-view.ts': 'manage_staff',
  // Pinned 2026-09-10. All of these already enforced a permission; none was
  // recorded here, so a silent downgrade to bare requireAdmin() would have gone
  // unnoticed — which is exactly what happened to workflows.ts.
  'src/lib/data/admin/alerts.ts': 'manage_settings',
  'src/lib/data/admin/channel-catalog.ts': 'manage_settings',
  'src/lib/data/admin/cookie-consent.ts': 'manage_settings',
  'src/lib/data/admin/faq.ts': 'manage_settings',
  'src/lib/data/admin/fleet.ts': 'manage_settings',
  'src/lib/data/admin/outreach-master.ts': 'manage_settings',
  'src/lib/data/admin/campaigns.ts': 'manage_billing',
  'src/lib/data/admin/call-dnc.ts': 'manage_voice',
  'src/lib/data/admin/voximplant-channel.ts': 'manage_voice',
  'src/lib/data/admin/support.ts': 'view_customer_data',
  // Owner-only surfaces: they gate on requirePlatformOwner and name no key.
  'src/lib/data/admin/platform-roles.ts': [],
  'src/lib/data/admin/relocation.ts': [],
  // Two keys each, and the pair is the point — listing call history needs the
  // voice permission, and hearing a recording needs its own on top.
  'src/lib/data/admin/console-history.ts': ['manage_voice', 'view_recordings'],
  'src/lib/data/admin/voice-ops.ts': ['manage_voice', 'view_recordings'],
  // Split by what the function does, not by which page it serves. See the header
  // of workflows.ts for why the manual run additionally needs manage_voice.
  'src/lib/data/admin/workflows.ts': ['manage_settings', 'view_customer_data'],
};

// Modules that write but are correctly exempt from naming a permission, with the
// reason. Kept separate from COARSE_GATE_ALLOWED so "it does not write" and "it
// writes, and here is why that is fine" stay distinguishable.
const WRITE_EXEMPT: Record<string, string> = {
  'src/lib/data/admin/access-log.ts':
    'The audit writer itself, called by readers that have already gated. Gating it again would make the audit trail depend on the permission being audited.',
};

// Every module under src/lib/data/admin, read from disk. The suite is driven by
// THIS, not by a hand-maintained list, so module 37 is examined the day it lands.
const ADMIN_DAL_DIR = 'src/lib/data/admin';
// RECURSIVE. It was a flat readdir until 2026-09-10, which was fine while every
// module sat directly in the directory — and stopped being fine the moment the first
// SUBDIRECTORY appeared (data/admin/integrations/). A flat scan returns that entry as
// a directory, the `.endsWith('.ts')` filter drops it, and every module inside is
// silently unscanned: the fail-closed guarantee this suite exists for would have gone
// green over a whole folder. Found while adding that folder, not by it failing.
function walkModules(rel: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkModules(child));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(child);
  }
  return out;
}

const MODULES = walkModules(ADMIN_DAL_DIR).sort();

// Modules allowed to gate on the FLOOR alone — requirePlatformStaff(), "is this
// person staff at all" — each with the reason. A module earns a place here only
// if it neither writes nor returns customer data; anything else must name a
// permission in EXPECTED_PERMISSION.
//
// These said requireAdmin() until 2026-09-10, which was not merely untidy:
// nav-counts.ts is loaded by the ADMIN LAYOUT on every page, and requireAdmin()
// redirects when user_roles has no row — so a non-owner staff member was ejected
// from the panel by the module that draws its sidebar. The assertion below keeps
// the retired axis out of this directory for good.
const COARSE_GATE_ALLOWED: Record<string, string> = {
  'src/lib/data/admin/analytics.ts':
    'GA4 traffic aggregates for our own property. Read-only (verified 2026-09-10: no writes, no rpc, no enqueue, no side effect of any kind), no customer data, and the permission catalogue has no analytics key to name.',
  'src/lib/data/admin/search-console.ts':
    'Search Console aggregates for our own domain. Read-only (verified 2026-09-10), no customer data, and no matching key in the catalogue.',
  'src/lib/data/admin/dashboard.ts':
    'Counts for the admin home tiles. Read-only (verified 2026-09-10: no insert/update/upsert/delete, no rpc, no enqueue). It DOES use createAdminClient, so it bypasses RLS and the app gate is the only protection — acceptable while it returns aggregates and no customer row.',
  'src/lib/data/admin/nav-counts.ts':
    'Badge counts for the nav. Read-only (verified 2026-09-10), and already calls hasPlatformPermission internally so a viewer is never counted what they may not see. Uses createAdminClient, so it bypasses RLS — acceptable for counts.',
  'src/lib/data/admin/integrations/index.ts':
    'The /admin/integrations index. Read-only: it composes getIntegrationsStatus (itself credential-free since the flags RPC) with per-card hasPlatformPermission checks and returns booleans plus hrefs. Its floor is requirePlatformStaff because the page is navigation + status; the CARDS carry the permission each destination enforces, and the write surfaces it links to keep their own gates. Naming one key for the whole module would be the mistake the header of that file documents.',
  'src/lib/data/admin/nav-visibility.ts':
    'Which sidebar links to show. Read-only and touches no table at all — it returns nine booleans about the CALLER\'s own role. Naming a finer permission would be circular: answering "which permissions do you hold" cannot itself require one of them. Nav visibility is convenience, never authorization; the page keeps the gate.',
  'src/lib/data/admin/labels.ts': 'Pure label maps. No I/O at all.',
  'src/lib/data/admin/shared.ts': 'Shared types and helpers. No I/O at all.',
  'src/lib/data/admin/access-log.ts': 'Write-side audit helper called BY gated readers; gating it again would double-count.',
  'src/lib/data/admin/webhook-identity.ts': 'Pure derivation from a payload already fetched by a gated reader.',
  'src/lib/data/admin/voice-balance-cache.ts':
    'In-process memo of one non-customer number (the Voximplant balance), read by gated voice readers. Verified 2026-09-10: no database access at all — it exports a getter and a test reset, nothing more.',
};

// The permission catalogue as seeded in platform_permission_definitions,
// MEASURED against the live database 2026-09-10. Pinned rather than queried so
// the suite stays hermetic; a key used in code that is not here is either a typo
// or a permission nobody created, and both mean the gate never matches and the
// user is redirected with no explanation.
const PERMISSION_CATALOGUE = [
  'campaigns.runstate',
  'manage_billing',
  'manage_settings',
  'manage_staff',
  'manage_voice',
  'roles.manage',
  'view_activity_log',
  'view_billing',
  'view_customer_data',
  'view_events',
  'view_recordings',
  'view_webhooks',
] as const;

// Targeted readers of an identified customer subject that MUST record a
// staff-access audit row (Step-2 audit layer). A new such reader shipping without
// an audit call — the exact gap that let staff data-access go dark — fails here.
// support.ts's own two event-view readers audit via a direct support_access_log
// insert (pre-dating the helper); the rest go through recordStaffAccess.
const AUDIT_REQUIRED: Record<string, string[]> = {
  // All four gate on requirePlatformPermission('manage_billing') — STRICTER than
  // requireAdmin() — and each writes a fail-closed recordStaffAccess row before
  // the cross-tenant read, which requireAdmin() alone would not. The three
  // campaign readers reach it through auditedCampaignAccess (see AUDIT_DELEGATES):
  // one gate+audit, applied per read, so none of them can be called untraced.
  'src/lib/data/admin/campaigns.ts': [
    'getEventForAdminView',
    'getCampaignForAdminView',
    'getCampaignDeliveryForAdminView',
    'getThankyouScheduleForAdminView',
  ],
  'src/lib/data/admin/voice-ops.ts': ['listCallAttemptsForEvent'],
  // Cross-tenant reads of ONE named event: identity under 'view_events'
  // (not break-glass, so no reason) and the date move under 'manage_billing'.
  'src/lib/data/admin/event-view.ts': ['getEventForStaffView'],
  'src/lib/data/admin/events.ts': ['rescheduleEventForAdmin'],
  // Viewing another user's full detail is a break-glass customer-data read. The
  // audit is conditional on it being a cross-user view (self-view is exempt),
  // but the call must be present.
  'src/lib/data/admin/users.ts': ['getUserDetail'],
};

// Module-private wrappers that perform the gate AND the audit, so a reader
// delegating to one is audited exactly as if it called recordStaffAccess itself.
// A name earns a place here only if its own body does the permission check and
// writes the row before returning — verified below, not assumed, so this list
// cannot become a way to wave a reader through.
const AUDIT_DELEGATES: Record<string, string[]> = {
  'src/lib/data/admin/campaigns.ts': ['auditedCampaignAccess'],
};

describe('targeted admin readers record a staff-access audit', () => {
  for (const [relPath, fns] of Object.entries(AUDIT_REQUIRED)) {
    const source = readFileSync(join(ROOT, relPath), 'utf8');
    const blocks = splitIntoFunctionBlocks(source);
    const delegates = AUDIT_DELEGATES[relPath] ?? [];

    for (const delegate of delegates) {
      it(`${relPath}: ${delegate} really gates and audits before returning`, () => {
        const at = source.indexOf(`async function ${delegate}(`);
        expect(at, `${delegate} not found in ${relPath}`).toBeGreaterThan(-1);
        const body = source.slice(at, source.indexOf('\n}\n', at));
        expect(body).toMatch(/require(Admin|PlatformOwner|PlatformPermission)/);
        expect(body).toContain('recordStaffAccess');
      });
    }

    for (const fn of fns) {
      it(`${relPath}: ${fn} calls recordStaffAccess before returning data`, () => {
        const block = blocks.find((b) => b.name === fn);
        expect(block, `${fn} not found in ${relPath}`).toBeDefined();
        expect(
          block!.body.includes('recordStaffAccess') ||
            block!.body.includes('support_access_log') ||
            delegates.some((d) => block!.body.includes(`await ${d}(`)),
        ).toBe(true);
      });
    }
  }
});

describe('every admin data-layer module is accounted for', () => {
  // THE fail-closed assertion. A new file under src/lib/data/admin/ must be
  // classified — a named permission, or an explicit coarse-gate exemption with a
  // reason — before it can ship. Silence is no longer a pass.
  for (const relPath of MODULES) {
    it(`${relPath} is classified (permission or documented exemption)`, () => {
      const pinned = relPath in EXPECTED_PERMISSION;
      const excused = relPath in COARSE_GATE_ALLOWED;
      expect(
        pinned || excused,
        `${relPath} is neither pinned in EXPECTED_PERMISSION nor excused in ` +
          `COARSE_GATE_ALLOWED. Decide which permission it enforces, or record ` +
          `why the coarse requireAdmin() gate is enough for it.`,
      ).toBe(true);
      expect(pinned && excused, `${relPath} is in BOTH maps — pick one`).toBe(false);
    });
  }

  it('no map names a module that no longer exists', () => {
    for (const relPath of [...Object.keys(COARSE_GATE_ALLOWED), ...Object.keys(EXPECTED_PERMISSION)]) {
      if (!relPath.startsWith(ADMIN_DAL_DIR)) continue;
      expect(MODULES, `${relPath} is mapped but not on disk`).toContain(relPath);
    }
  });

  // The retired axis, kept out. requireAdmin() reads user_roles and REDIRECTS on
  // a miss; anything in this directory that calls it can eject a legitimate
  // staff member, and nav-counts.ts proved that is not hypothetical — it runs in
  // the admin layout. The floor is requirePlatformStaff().
  it('no module gates on the retired requireAdmin()', () => {
    for (const relPath of MODULES) {
      const source = readFileSync(join(ROOT, relPath), 'utf8');
      expect(
        /await requireAdmin\(\)/.test(source),
        `${relPath} still calls requireAdmin(), which reads the retired user_roles ` +
          `axis and redirects a staff member who has no row there. Use ` +
          `requirePlatformStaff() for the floor, or name a permission.`,
      ).toBe(false);
    }
  });

  it('every exemption carries a reason', () => {
    for (const [relPath, reason] of Object.entries(COARSE_GATE_ALLOWED)) {
      expect(reason.length, `${relPath} needs a real reason`).toBeGreaterThan(30);
    }
  });

  // A permission key that is not in the catalogue never matches, so the gate
  // silently redirects instead of authorizing. A typo is indistinguishable from
  // a lockout until someone reports it.
  it('every permission key used in the admin data layer exists in the catalogue', () => {
    for (const relPath of MODULES) {
      const used = [
        ...readFileSync(join(ROOT, relPath), 'utf8').matchAll(
          /requirePlatformPermission\('([a-z_.]+)'\)/g,
        ),
      ].map((m) => m[1]);
      for (const key of used) {
        expect(PERMISSION_CATALOGUE, `${relPath} uses unknown permission '${key}'`).toContain(key);
      }
    }
  });

  // The rule the workflows.ts gap broke: a module that WRITES must name what it
  // is allowed to write, not lean on "is this person staff at all".
  it('no module that writes to the database gates on requireAdmin alone', () => {
    for (const relPath of MODULES) {
      const source = readFileSync(join(ROOT, relPath), 'utf8');
      const writes = /\.(insert|update|upsert|delete)\(\s*\{/.test(source);
      if (!writes || relPath in WRITE_EXEMPT) continue;
      const fine =
        /requirePlatformPermission\('/.test(source) || source.includes('requirePlatformOwner(');
      expect(
        fine,
        `${relPath} writes to the database but gates only on requireAdmin(). ` +
          `requireAdmin() is has_role('admin') — support_agent and auditor hold it too.`,
      ).toBe(true);
    }
  });
});

describe('admin data-layer functions are gated', () => {
  for (const [relPath, exempt] of Object.entries(EXEMPT)) {
    const source = readFileSync(join(ROOT, relPath), 'utf8');
    const blocks = splitIntoFunctionBlocks(source);

    it(`${relPath} exports at least one async function to check`, () => {
      expect(blocks.length).toBeGreaterThan(0);
    });

    for (const { name, body } of blocks) {
      if (exempt.includes(name)) {
        it(`${relPath}: ${name} is explicitly exempt (documented above)`, () => {
          expect(exempt).toContain(name);
        });
        continue;
      }
      it(`${relPath}: ${name} calls an authorization gate`, () => {
        expect(GATES.some((g) => body.includes(g))).toBe(true);
      });
    }

    it(`${relPath}: every EXEMPT entry still exists as a real function (no stale allowlist)`, () => {
      const names = blocks.map((b) => b.name);
      for (const name of exempt) {
        expect(names).toContain(name);
      }
    });
  }
});


describe('pinned modules enforce exactly the permission they are pinned to', () => {
  // Driven by EXPECTED_PERMISSION, NOT nested inside the EXEMPT loop.
  //
  // It used to be nested, which meant a module pinned here but absent from EXEMPT
  // was never actually asserted — pinning it did nothing. Caught 2026-09-10 by
  // downgrading workflows.ts back to requireAdmin() and watching the suite stay
  // green; the two other injected faults fired, this one did not.
  for (const [relPath, expectedKey] of Object.entries(EXPECTED_PERMISSION)) {
    const source = readFileSync(join(ROOT, relPath), 'utf8');
    const expected = (Array.isArray(expectedKey) ? expectedKey : [expectedKey]).sort();

    it(`${relPath}: enforces exactly ${expected.length ? expected.join(' + ') : 'owner-only (no key)'}`, () => {
      const used = [
        ...new Set(
          [...source.matchAll(/requirePlatformPermission\('([a-z_.]+)'\)/g)].map((m) => m[1]),
        ),
      ].sort();
      // An empty expectation means owner-only: no key, but a gate all the same.
      if (expected.length === 0) {
        expect(used).toEqual([]);
        expect(source).toContain('requirePlatformOwner(');
      } else {
        expect(used).toEqual(expected);
      }
    });
  }
});

describe('the admin layout applies the staff floor', () => {
  // Defense in depth, NOT the authorization boundary — Next's own guidance says
  // a layout "does not control whether the rest of the route renders". The
  // boundary is the per-module permission gate asserted above. This only pins
  // that the floor is present, runs before children, and asks the RIGHT axis.
  it('awaits requirePlatformStaff() before rendering children', () => {
    const source = readFileSync(join(ROOT, 'src/app/(admin)/admin/layout.tsx'), 'utf8');
    expect(source).toMatch(/await requirePlatformStaff\(\)/);
    const gateIndex = source.indexOf('await requirePlatformStaff()');
    const childrenIndex = source.indexOf('{children}');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(childrenIndex).toBeGreaterThan(gateIndex);
  });

  // THE REGRESSION THAT ACTUALLY BIT. Clearing the floor at the top of the
  // layout is worthless if something the layout then AWAITS re-checks the
  // retired axis and redirects. That is exactly what happened: getAdminNavCounts
  // (nav-counts.ts) called requireAdmin(), so a billing_clerk passed
  // requirePlatformStaff() and was ejected to /app by the module drawing their
  // sidebar. Every admin module the layout imports must clear the same floor it
  // does.
  it('nothing the layout awaits re-checks the retired axis', () => {
    const layout = readFileSync(join(ROOT, 'src/app/(admin)/admin/layout.tsx'), 'utf8');
    const imported = [...layout.matchAll(/from '@\/lib\/data\/admin\/([\w-]+)'/g)].map(
      (m) => `src/lib/data/admin/${m[1]}.ts`,
    );
    expect(imported.length, 'the layout imports no admin module — did the path shape change?')
      .toBeGreaterThan(0);
    for (const relPath of imported) {
      const source = readFileSync(join(ROOT, relPath), 'utf8');
      expect(
        /await requireAdmin\(\)/.test(source),
        `${relPath} is awaited by the admin layout and calls requireAdmin(), which ` +
          `redirects a staff member with no user_roles row — locking them out of ` +
          `every admin page after the layout already let them in.`,
      ).toBe(false);
    }
  });

  // The floor moved from user_roles.admin to platform_staff on 2026-09-10,
  // because the two axes were written by separate flows and a non-owner role
  // added through /admin/roles was bounced from the panel. Asking the old axis
  // here would silently restore that bug.
  it('does not fall back to the retired user_roles axis', () => {
    const source = readFileSync(join(ROOT, 'src/app/(admin)/admin/layout.tsx'), 'utf8');
    expect(source).not.toMatch(/await requireAdmin\(\)/);
  });
});

// ---------------------------------------------------------------------------
// The scan root, widened — because it was too narrow, and that is how the gap
// below got in.
// ---------------------------------------------------------------------------
//
// MODULES above reads src/lib/data/admin/ and NOTHING ELSE. That is why this
// suite could go green while reporting "no coarse-gated writes": a Server Action
// lives under src/app/(admin)/admin/, outside the scanned directory, and was
// never looked at.
//
// It matters because a Server Action IS ITS OWN ENDPOINT. Next dispatches a POST
// straight to it; the page's requirePlatformPermission() never runs for a caller
// who invokes the action directly. Same for a route handler. The layout does not
// save them either — see the note at src/lib/auth/dal.ts and Next's own wording,
// "a layout does not control whether the rest of the route renders".
//
// MEASURED 2026-09-10, before the fix: 16 exported actions across voice/,
// alerts/ and fleet/ gated on the coarse staff floor alone — among them one that
// writes an ElevenLabs API key, one that writes a Slack webhook secret, and one
// that sends a real Slack message. After the two auth axes were merged, every
// role reached those, an auditor included.
//
// WHAT THIS ASSERTION DOES NOT PROVE, stated plainly rather than implied: it
// does not verify that a thin action DELEGATES correctly. Most admin actions
// validate input and hand off to a data-layer function that holds the gate —
// which is the house pattern and is correct — and proving the handoff would need
// real call-graph analysis, not text. So this checks the one thing text can
// settle with no false positives: an admin endpoint that gates HERE must not
// gate COARSELY. A file that names requireAdmin() is a file that decided to
// authorize and picked the widest gate there is.
const ENDPOINT_DIRS = ['src/app/(admin)/admin', 'src/app/api/admin'];

function collectEndpointFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(child);
      } else if (
        !entry.name.endsWith('.test.ts') &&
        (entry.name === 'route.ts' ||
          entry.name === 'actions.ts' ||
          entry.name.endsWith('-actions.ts'))
      ) {
        out.push(child);
      }
    }
  };
  walk(dir);
  return out.sort();
}

const ENDPOINT_FILES = ENDPOINT_DIRS.flatMap(collectEndpointFiles);

describe('no admin endpoint authorizes on the coarse staff floor', () => {
  it('finds endpoint files to check (a silent empty scan is the bug this replaces)', () => {
    expect(ENDPOINT_FILES.length).toBeGreaterThan(20);
  });

  for (const relPath of ENDPOINT_FILES) {
    it(`${relPath} names a permission rather than requireAdmin()`, () => {
      const source = readFileSync(join(ROOT, relPath), 'utf8');
      const coarse = [...source.matchAll(/await requireAdmin\(\)/g)];
      expect(
        coarse.length,
        `${relPath} gates on the coarse requireAdmin() in ${coarse.length} place(s). ` +
          `A Server Action and a route handler are each their own endpoint, so this ` +
          `IS the authorization decision — name the permission the action actually ` +
          `needs (requirePlatformPermission), or requirePlatformOwner if it is ` +
          `owner-only. Delegating the gate to a pinned data-layer function is also ` +
          `fine; calling requireAdmin() here is not.`,
      ).toBe(0);
    });
  }

  it('every permission key used by an admin endpoint exists in the catalogue', () => {
    for (const relPath of ENDPOINT_FILES) {
      const used = [
        ...readFileSync(join(ROOT, relPath), 'utf8').matchAll(
          /requirePlatformPermission\('([a-z_.]+)'\)/g,
        ),
      ].map((m) => m[1]);
      for (const key of used) {
        expect(PERMISSION_CATALOGUE, `${relPath} uses unknown permission '${key}'`).toContain(key);
      }
    }
  });
});
