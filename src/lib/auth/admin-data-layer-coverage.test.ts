import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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

// Functions intentionally NOT gated by requireAdmin(), with the reason a
// reviewer needs to accept before adding an entry here. Every other exported
// async function in these files MUST call requireAdmin().
const EXEMPT: Record<string, string[]> = {
  'src/lib/data/admin/activity.ts': [],
  'src/lib/data/admin/agreements.ts': [],
  'src/lib/data/admin/callbacks.ts': [],
  'src/lib/data/admin/channels.ts': [],
  'src/lib/data/admin/contacts.ts': [],
  'src/lib/data/admin/dashboard.ts': [],
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

// The gates a data-layer function may use. `requireAdmin` is the coarse "is this
// person staff at all" check; `requirePlatformPermission` is the fine-grained
// capability from the /admin/roles matrix; `requirePlatformOwner` is owner-only.
const GATES = [
  'requireAdmin',
  'requirePlatformOwner',
  'requirePlatformPermission',
] as const;

// The permission each module is expected to enforce. Pinning this (rather than
// only "some gate exists") is what makes a SILENT downgrade fail CI: swapping a
// module from `manage_staff` to `view_activity_log`, or back to a bare
// requireAdmin, now breaks the build instead of quietly widening access.
// A module absent from this map may use any gate in GATES.
const EXPECTED_PERMISSION: Record<string, string> = {
  'src/lib/data/admin/activity.ts': 'view_activity_log',
  'src/lib/data/admin/agreements.ts': 'manage_settings',
  'src/lib/data/admin/callbacks.ts': 'view_customer_data',
  'src/lib/data/admin/channels.ts': 'manage_settings',
  'src/lib/data/admin/contacts.ts': 'view_customer_data',
  'src/lib/data/admin/packages.ts': 'manage_billing',
  'src/lib/data/admin/settings.ts': 'manage_settings',
  'src/lib/data/admin/users.ts': 'manage_staff',
  'src/lib/data/admin/webhook-inbox.ts': 'view_webhooks',
  'src/lib/data/admin/access-log-view.ts': 'manage_staff',
};

// Targeted readers of an identified customer subject that MUST record a
// staff-access audit row (Step-2 audit layer). A new such reader shipping without
// an audit call — the exact gap that let staff data-access go dark — fails here.
// support.ts's own two event-view readers audit via a direct support_access_log
// insert (pre-dating the helper); the rest go through recordStaffAccess.
const AUDIT_REQUIRED: Record<string, string[]> = {
  'src/lib/data/admin/campaigns.ts': ['getEventForAdminView'],
  'src/lib/data/admin/voice-ops.ts': ['listCallAttemptsForEvent'],
};

describe('targeted admin readers record a staff-access audit', () => {
  for (const [relPath, fns] of Object.entries(AUDIT_REQUIRED)) {
    const source = readFileSync(join(ROOT, relPath), 'utf8');
    const blocks = splitIntoFunctionBlocks(source);
    for (const fn of fns) {
      it(`${relPath}: ${fn} calls recordStaffAccess before returning data`, () => {
        const block = blocks.find((b) => b.name === fn);
        expect(block, `${fn} not found in ${relPath}`).toBeDefined();
        expect(
          block!.body.includes('recordStaffAccess') ||
            block!.body.includes('support_access_log'),
        ).toBe(true);
      });
    }
  }
});

describe('admin data-layer functions are gated', () => {
  for (const [relPath, exempt] of Object.entries(EXEMPT)) {
    const source = readFileSync(join(ROOT, relPath), 'utf8');
    const blocks = splitIntoFunctionBlocks(source);
    const expectedKey = EXPECTED_PERMISSION[relPath];

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

    if (expectedKey) {
      it(`${relPath}: enforces '${expectedKey}' and no other permission`, () => {
        const used = [
          ...source.matchAll(/requirePlatformPermission\('([a-z_.]+)'\)/g),
        ].map((m) => m[1]);
        expect(used.length).toBeGreaterThan(0);
        expect([...new Set(used)]).toEqual([expectedKey]);
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

describe('admin route handlers gate on requireAdmin()', () => {
  const ROUTE_FILES = [
    'src/app/api/admin/sumit-test/route.ts',
  ];

  for (const relPath of ROUTE_FILES) {
    it(`${relPath} calls requireAdmin()`, () => {
      const source = readFileSync(join(ROOT, relPath), 'utf8');
      expect(source).toContain('requireAdmin');
    });
  }
});

describe('the admin layout gates every page.tsx under (admin)/admin', () => {
  it('layout.tsx awaits requireAdmin() before rendering children', () => {
    const source = readFileSync(
      join(ROOT, 'src/app/(admin)/admin/layout.tsx'),
      'utf8',
    );
    expect(source).toMatch(/await requireAdmin\(\)/);
    // The gate must run before children render, not conditionally after.
    const requireAdminIndex = source.indexOf('await requireAdmin()');
    const childrenIndex = source.indexOf('{children}');
    expect(requireAdminIndex).toBeGreaterThan(-1);
    expect(childrenIndex).toBeGreaterThan(requireAdminIndex);
  });
});
