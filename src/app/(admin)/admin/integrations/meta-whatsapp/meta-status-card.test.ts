import { describe, expect, it } from 'vitest';

import { MetaStatusCard } from './meta-status-card';
import type { MetaStatus } from '@/lib/data/admin/integrations/meta-status';

type El = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };

// Nested function components are INVOKED — Row, ExpiryValue and Badge are where
// the text actually lands, and a walker that only descends `children` would see
// unexecuted elements and assert nothing.
function collect(node: unknown, out: El[] = [], depth = 0): El[] {
  if (!node || typeof node !== 'object' || depth > 40) return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out, depth + 1));
    return out;
  }
  const el = node as El;
  out.push(el);
  if (typeof el.type === 'function') {
    try {
      collect((el.type as (p: unknown) => unknown)(el.props ?? {}), out, depth + 1);
    } catch {
      /* a component needing a runtime we lack is simply not descended into */
    }
  }
  collect(el.props?.children, out, depth + 1);
  return out;
}

function text(tree: unknown): string {
  return collect(tree)
    .flatMap((el) => {
      const c = el.props?.children;
      return Array.isArray(c) ? c : [c];
    })
    .filter((t): t is string => typeof t === 'string')
    .join(' ');
}

const variants = (tree: unknown) =>
  collect(tree)
    .map((el) => el.props?.variant)
    .filter((v): v is string => typeof v === 'string');

const HEALTHY: MetaStatus = {
  configured: true,
  graphVersion: 'v25.0',
  reason: null,
  token: {
    isValid: true,
    expiresAt: 0,
    // 2026-12-07 — the LIVE token's actual data-access deadline (measured
    // 2026-09-10, §8 of the plan). The previous fixture read as 2025-12-02, a date
    // already in the past, which a future reader could take for the real one.
    dataAccessExpiresAt: 1796601600,
    grantedScopes: [
      'whatsapp_business_messaging',
      'whatsapp_business_management',
      'business_management',
    ],
    missingScopes: [],
    invalidReason: null,
  },
};

describe('MetaStatusCard', () => {
  it('a healthy token reads as תקף, with no missing scopes', () => {
    const tree = MetaStatusCard({ status: HEALTHY });
    expect(text(tree)).toContain('תקף');
    expect(variants(tree)).toContain('success');
    expect(variants(tree)).not.toContain('warning');
  });

  it('expires_at = 0 is spelled out as Meta returning 0, not asserted as a rule', () => {
    // The reference documents no meaning for 0 (checked 2026-09-13). The wording
    // must describe the value, not a rule Meta never published.
    expect(text(MetaStatusCard({ status: HEALTHY }))).toContain('Meta מחזירה 0');
  });

  it('names the missing scopes rather than only flagging that some are missing', () => {
    const tree = MetaStatusCard({
      status: {
        ...HEALTHY,
        token: {
          ...HEALTHY.token!,
          grantedScopes: ['whatsapp_business_messaging'],
          missingScopes: ['whatsapp_business_management', 'business_management'],
        },
      },
    });
    expect(text(tree)).toContain('whatsapp_business_management, business_management');
    expect(variants(tree)).toContain('warning');
  });

  it('an invalid token shows Meta’s own reason', () => {
    const tree = MetaStatusCard({
      status: {
        ...HEALTHY,
        token: { ...HEALTHY.token!, isValid: false, invalidReason: 'Session has expired' },
      },
    });
    expect(text(tree)).toContain('לא תקף');
    expect(text(tree)).toContain('Session has expired');
  });

  it('"could not ask" reads as לא נבדק — NEVER as an invalid token', () => {
    // The distinction is the point of the card: one sends an admin to replace a
    // working token, the other to fix a missing app secret.
    const tree = MetaStatusCard({
      status: {
        configured: true,
        graphVersion: 'v25.0',
        token: null,
        reason: 'לא נשמר app secret, ולכן אי אפשר לשאול את Meta על הטוקן.',
      },
    });
    const t = text(tree);
    expect(t).toContain('לא נבדק');
    expect(t).toContain('app secret');
    expect(t).not.toContain('לא תקף');
  });

  it('nothing configured is not reported as a problem', () => {
    const tree = MetaStatusCard({
      status: { configured: false, graphVersion: 'v25.0', token: null, reason: null },
    });
    expect(text(tree)).toContain('לא מוגדר');
    expect(variants(tree)).not.toContain('warning');
  });

  it('shows the pinned Graph version and claims nothing about "latest"', () => {
    const t = text(MetaStatusCard({ status: HEALTHY }));
    expect(t).toContain('v25.0');
    // A hardcoded "latest" becomes a lie the month Meta ships a new version.
    expect(t).not.toMatch(/עדכנית|latest|הגרסה האחרונה/);
  });
});
