// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MetaStatusCard } from './meta-status-card';
import type { MetaStatus } from '@/lib/data/admin/integrations/meta-status';

// Rendered by React, not called as a plain function: React forbids the call ("Never call component functions
// directly", react.dev Rules of React), and the Badge and LocalDateTime inside the card use hooks, so the call
// printed "Invalid hook call" and those parts were never looked at.

afterEach(cleanup);

function renderCard(status: MetaStatus): HTMLElement {
  return render(<MetaStatusCard status={status} />).container;
}

const text = (container: HTMLElement) => container.textContent ?? '';

// The tone of every Badge on the card, from the data-variant attribute Base UI's useRender sets from its state.
const variants = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-variant]')].map((el) => el.getAttribute('data-variant'));

const HEALTHY: MetaStatus = {
  configured: true,
  graphVersion: 'v25.0',
  reason: null,
  token: {
    isValid: true,
    expiresAt: 0,
    // 2026-12-07 — the LIVE token's actual data-access deadline (measured
    // 2026-09-10, §8 of the plan).
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
    const tree = renderCard(HEALTHY);
    expect(text(tree)).toContain('תקף');
    expect(variants(tree)).toContain('success');
    expect(variants(tree)).not.toContain('warning');
  });

  it('expires_at = 0 is spelled out as Meta returning 0, not asserted as a rule', () => {
    // The reference documents no meaning for 0 (checked 2026-09-13). The wording
    // must describe the value, not a rule Meta never published.
    expect(text(renderCard(HEALTHY))).toContain('Meta מחזירה 0');
  });

  it('names the missing scopes rather than only flagging that some are missing', () => {
    const tree = renderCard({
      ...HEALTHY,
      token: {
        ...HEALTHY.token!,
        grantedScopes: ['whatsapp_business_messaging'],
        missingScopes: ['whatsapp_business_management', 'business_management'],
      },
    });
    expect(text(tree)).toContain('whatsapp_business_management, business_management');
    expect(variants(tree)).toContain('warning');
  });

  it('an invalid token shows Meta’s own reason', () => {
    const tree = renderCard({
      ...HEALTHY,
      token: { ...HEALTHY.token!, isValid: false, invalidReason: 'Session has expired' },
    });
    expect(text(tree)).toContain('לא תקף');
    expect(text(tree)).toContain('Session has expired');
  });

  it('"could not ask" reads as לא נבדק — NEVER as an invalid token', () => {
    // The distinction is the point of the card: one sends an admin to replace a
    // working token, the other to fix a missing app secret.
    const tree = renderCard({
      configured: true,
      graphVersion: 'v25.0',
      token: null,
      reason: 'לא נשמר app secret, ולכן אי אפשר לשאול את Meta על הטוקן.',
    });
    const t = text(tree);
    expect(t).toContain('לא נבדק');
    expect(t).toContain('app secret');
    expect(t).not.toContain('לא תקף');
  });

  it('nothing configured is not reported as a problem', () => {
    const tree = renderCard({ configured: false, graphVersion: 'v25.0', token: null, reason: null });
    expect(text(tree)).toContain('לא מוגדר');
    expect(variants(tree)).not.toContain('warning');
  });

  it('shows the pinned Graph version and claims nothing about "latest"', () => {
    const t = text(renderCard(HEALTHY));
    expect(t).toContain('v25.0');
    // A hardcoded "latest" becomes a lie the month Meta ships a new version.
    expect(t).not.toMatch(/עדכנית|latest|הגרסה האחרונה/);
  });
});
