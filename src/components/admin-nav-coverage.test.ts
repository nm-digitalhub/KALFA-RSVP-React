// The sidebar's half of the permission story.
//
// admin-data-layer-coverage.test.ts proves every admin module and endpoint names
// a permission. This proves the NAV agrees with them — that the link a viewer is
// shown is one whose destination they can actually open.
//
// It is not a security test and must not be mistaken for one: hiding a link
// protects nothing, because the URL is still typeable and the page's own
// requirePlatformPermission is what refuses. It guards a UX failure with a
// security-shaped cause. Before 2026-09-10 only user_roles.admin holders — the
// three owners — could enter /admin, so showing all 33 links to everyone cost
// nothing. Merging the two auth axes turned every platform_staff row into an
// admin-area login, and the links that do not apply do not say "no access": they
// redirect('/app') and eject the viewer from the panel entirely.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// nav-visibility.ts is `import 'server-only'`; this suite reads one exported
// const from it and never calls the resolver, so the marker is stubbed exactly
// as the other suites do it (see src/lib/workflow/manual-run.test.ts).
vi.mock('server-only', () => ({}));

import { NAV_GROUPS } from './admin-shell';
import { NAV_PERMISSION_KEYS } from '@/lib/data/admin/nav-visibility';

const ROOT = join(__dirname, '..', '..');
const ITEMS = NAV_GROUPS.flatMap((group) => group.items);

describe('every sidebar link is classified', () => {
  // The two deliberate exceptions, named rather than inferred. Both are
  // COARSE_GATE_ALLOWED read-only surfaces whose data layer gates on the staff
  // floor and for which the catalogue has no key to name — so every staff member
  // sees them, which is exactly what their own gate allows.
  // /admin and /admin/analytics: COARSE_GATE_ALLOWED read-only surfaces with no key in
  // the catalogue. /admin/integrations: navigation + read-only status on the staff
  // floor, where each CARD carries the permission its destination enforces — naming one
  // key here would hide the whole page from staff who can open part of it.
  const NO_PERMISSION_BY_DESIGN = new Set(['/admin', '/admin/analytics', '/admin/integrations']);

  for (const item of ITEMS) {
    it(`${item.href} names a permission or is a documented exception`, () => {
      if (NO_PERMISSION_BY_DESIGN.has(item.href)) {
        expect(item.permission).toBeUndefined();
        return;
      }
      expect(
        item.permission,
        `${item.href} has no permission. Add the key its page enforces, 'OWNER' ` +
          `for an owner-only page, or add it to NO_PERMISSION_BY_DESIGN with a reason.`,
      ).toBeDefined();
    });
  }

  // THE ONE THAT MATTERS. nav-visibility.ts lists its keys separately from
  // NAV_GROUPS (a server module must not import a 'use client' one just to read
  // a string), and the filter treats a key missing from the grants map as
  // "hide". Fail-closed is the right direction but a silent one: without this
  // assertion, a nav item naming a ninth key would simply stop appearing for
  // everyone, with nothing to explain why.
  it('every permission a nav item names is resolved by nav-visibility.ts', () => {
    const resolved = new Set<string>(NAV_PERMISSION_KEYS);
    for (const item of ITEMS) {
      if (!item.permission || item.permission === 'OWNER') continue;
      expect(
        resolved.has(item.permission),
        `${item.href} gates on '${item.permission}', which getAdminNavGrants() never ` +
          `resolves — the item would silently disappear for every viewer. Add the ` +
          `key to NAV_PERMISSION_KEYS.`,
      ).toBe(true);
    }
  });

  it('no key is resolved that no nav item uses', () => {
    // Not a correctness bug — an extra RPC per render pass — but it means the
    // list drifted from the nav it exists to serve, and drift in that direction
    // usually means an item was removed and the key forgotten.
    const used = new Set(
      ITEMS.map((i) => i.permission).filter((p): p is string => !!p && p !== 'OWNER'),
    );
    for (const key of NAV_PERMISSION_KEYS) {
      expect(used.has(key), `NAV_PERMISSION_KEYS lists '${key}', which no nav item uses`).toBe(
        true,
      );
    }
  });
});

describe('the nav agrees with the page it links to', () => {
  // Textual, like its sibling suite, and honest about it: this reads the gate a
  // page.tsx declares for ITSELF. A page that correctly leaves the gate to its
  // data layer (the house pattern, and what Next's own guidance asks for) has
  // nothing to compare against, so it is skipped rather than guessed at.
  const gateOf = (href: string): { key?: string; owner?: boolean } | null => {
    const path = join(ROOT, 'src/app/(admin)', href, 'page.tsx');
    let source: string;
    try {
      source = readFileSync(path, 'utf8');
    } catch {
      return null;
    }
    if (/await requirePlatformOwner\(\)/.test(source)) return { owner: true };
    const m = source.match(/await requirePlatformPermission\('([a-z_.]+)'\)/);
    return m ? { key: m[1] } : null;
  };

  const COMPARABLE = ITEMS.filter((item) => gateOf(item.href));

  it('finds pages to compare against (an empty sweep proves nothing)', () => {
    expect(COMPARABLE.length).toBeGreaterThan(15);
  });

  for (const item of COMPARABLE) {
    const gate = gateOf(item.href)!;

    it(`${item.href} is shown under the same rule its page enforces`, () => {
      if (gate.owner) {
        expect(item.permission).toBe('OWNER');
      } else {
        expect(
          item.permission,
          `the page enforces '${gate.key}' but the nav shows the link under ` +
            `'${item.permission}' — one of the two is wrong, and the mismatch means ` +
            `a viewer is either shown a link that ejects them or hidden one they can open.`,
        ).toBe(gate.key);
      }
    });
  }
});
