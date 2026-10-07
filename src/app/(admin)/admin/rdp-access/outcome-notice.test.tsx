import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RdpAccessView } from '@/lib/data/admin/rdp-access';

import { isOutcome, OutcomeNotice, type OutcomeView } from './outcome-notice';

const html = (view: OutcomeView) => renderToStaticMarkup(<OutcomeNotice view={view} />).replace(/<!-- -->/g, '');

describe('isOutcome', () => {
  it('is true for the four finished states and false for the ones the page must act on', () => {
    const kinds: RdpAccessView['kind'][] = ['none', 'pending', 'active', 'denied', 'expired', 'cancelled', 'ended'];
    const finished = kinds.filter((kind) => isOutcome({ kind } as RdpAccessView));
    expect(finished).toEqual(['denied', 'expired', 'cancelled', 'ended']);
  });
});

describe('OutcomeNotice', () => {
  it('tells how an ended access ended, with the reason and the downloads', () => {
    const out = html({ kind: 'ended', requestId: 'r', grantedMinutes: 5, endedAt: '2026-10-06T21:00:12.000Z', endedReason: 'revoked_by_owner', filesIssued: 3, connectedAt: '2026-10-06T21:00:09.000Z' });
    expect(out).toContain('role="status"');
    expect(out).toContain('הגישה האחרונה הסתיימה ב- 00:00');
    expect(out).toContain('הבעלים ביטל את הגישה');
    expect(out).toContain('3 קבצים הורדו');
    expect(out).toContain('השער אישר חיבור ב-00:00');
  });

  it('does not imply a connection that the gateway never recorded', () => {
    const out = html({ kind: 'ended', requestId: 'r', grantedMinutes: 5, endedAt: '2026-10-06T21:10:00.000Z', endedReason: 'expired', filesIssued: 2, connectedAt: null });
    expect(out).toContain('2 קבצים הורדו');
    expect(out).toContain('לא נרשם חיבור');
    expect(out).not.toContain('השער אישר חיבור');
  });

  it('copes with an access that has no recorded end or reason', () => {
    const out = html({ kind: 'ended', requestId: 'r', grantedMinutes: 5, endedAt: null, endedReason: null, filesIssued: 0, connectedAt: null });
    expect(out).toContain('הגישה האחרונה הסתיימה');
    expect(out).toContain('לא הורדו קבצים');
  });

  it('carries the owner\'s note on a refusal, and only on a refusal', () => {
    const denied = html({ kind: 'denied', requestId: 'r', requestedMinutes: 60, answeredAt: null, note: 'נא לתאם מראש' });
    expect(denied).toContain('הבקשה האחרונה: נדחתה');
    expect(denied).toContain('הערת הבעלים:');
    expect(denied).toContain('נא לתאם מראש');
    expect(html({ kind: 'denied', requestId: 'r', requestedMinutes: 60, answeredAt: null, note: null })).not.toContain('הערת הבעלים');
  });

  it('says what happened to an unanswered or cancelled request', () => {
    expect(html({ kind: 'expired', requestId: 'r', requestedMinutes: 60, expiresAt: 'x' })).toContain('הבקשה האחרונה: פגה ללא מענה');
    expect(html({ kind: 'cancelled', requestId: 'r', requestedMinutes: 60 })).toContain('הבקשה האחרונה: בוטלה');
  });

  it('is only a notice: no button, no link, nothing to press', () => {
    const out = html({ kind: 'cancelled', requestId: 'r', requestedMinutes: 60 });
    expect(out).not.toMatch(/<(button|a|form|input)\b/);
  });
});
