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
  'src/lib/data/admin/orders.ts': [],
  'src/lib/data/admin/packages.ts': [],
  'src/lib/data/admin/settings.ts': [],
  'src/lib/data/admin/users.ts': [],
  'src/lib/data/admin/webhook-inbox.ts': [],
  // getTemplateByKey is the campaign outreach engine's internal template
  // reader (service-role, read-only, active-only) -- not an admin-facing
  // entry point. listMessageTemplates/updateMessageTemplate (the actual
  // /admin/templates surface) are both gated and NOT exempt.
  'src/lib/data/message-templates.ts': ['getTemplateByKey'],
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

describe('admin data-layer functions gate on requireAdmin()', () => {
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
      it(`${relPath}: ${name} calls requireAdmin()`, () => {
        expect(body).toContain('requireAdmin');
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
    'src/app/api/admin/orders/[id]/reconcile/route.ts',
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
