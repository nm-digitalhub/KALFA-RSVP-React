import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/event-cancellation', () => ({
  getCancellationRequestForAdmin: vi.fn(),
  getCampaignForEventAdmin: vi.fn(),
  computeSuggestedCancellationAmount: vi.fn(),
}));
vi.mock('@/lib/data/billing', () => ({ getCampaignBillingSummary: vi.fn() }));
vi.mock('../../_components', () => ({
  PageHeading: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  formatCurrency: (n: number) => `₪${n.toFixed(2)}`,
  formatDateTime: (s: string) => s,
}));
// The form is a client component with its own tests: here it only reports what the page decided to hand it.
vi.mock('./resolve-form', () => ({
  ResolveForm: (props: { moneyOutcome: string; feeBase: number; feeBaseLabel: string; suggestedAmount: number }) => (
    <div
      data-marker="form"
      data-outcome={props.moneyOutcome}
      data-base={props.feeBase}
      data-base-label={props.feeBaseLabel}
      data-suggested={props.suggestedAmount}
    />
  ),
}));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getCampaignBillingSummary } from '@/lib/data/billing';
import {
  computeSuggestedCancellationAmount,
  getCampaignForEventAdmin,
  getCancellationRequestForAdmin,
} from '@/lib/data/event-cancellation';
import AdminCancellationDetailPage from './page';

// /admin/cancellations/[id] — what the admin reads before resolving a request, and what the form is told the money will
// do. A fixed-price package is refunded from the payment ledger; it has no "not charged yet" state and no per-result
// accrual, and every state the model can hold (paid with a card, paid without one, nothing paid, unreadable) says its own
// true thing. The pay-per-result campaigns keep exactly the screen they had.

const request = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  requestNumber: 7,
  eventId: 'e1',
  eventName: 'חתונה',
  eventStatus: 'active',
  createdAt: '2026-10-05 10:00',
  reason: 'שינוי תוכניות',
  status: 'pending',
  resolution: null,
  resolutionAmount: null,
  captureOutcome: null,
  sumitDocumentUrl: null,
  resolutionNote: null,
  ...over,
});

const perResult = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  chargeStatus: null,
  maxChargeCeiling: 400,
  finalChargeAmount: 0,
  isPackage: false,
  packagePaid: null,
  packageRefundable: null,
  packageRefundedForRequest: null,
  packageUnreadable: false,
  tosVersion: '2026-07-v4',
  hasCardOnFile: false,
  basePrice: 0,
  includedReached: 0,
  pricePerReached: 1,
  ...over,
});

const pkg = (over: Record<string, unknown> = {}) =>
  perResult({ isPackage: true, maxChargeCeiling: null, packagePaid: 120, packageRefundable: 120, hasCardOnFile: true, ...over });

async function render() {
  const tree = await AdminCancellationDetailPage({ params: Promise.resolve({ id: 'r1' }) });
  return renderToStaticMarkup(tree);
}

const form = (html: string) => {
  const tag = /<div data-marker="form"[^>]*>/.exec(html)?.[0] ?? '';
  const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];
  return {
    present: tag !== '',
    outcome: attr('data-outcome'),
    base: attr('data-base'),
    baseLabel: attr('data-base-label'),
    suggested: attr('data-suggested'),
  };
};

beforeEach(() => {
  for (const m of [requirePlatformPermission, getCancellationRequestForAdmin, getCampaignForEventAdmin, computeSuggestedCancellationAmount, getCampaignBillingSummary]) {
    vi.mocked(m).mockReset();
  }
  vi.mocked(getCancellationRequestForAdmin).mockResolvedValue(request() as never);
  vi.mocked(getCampaignForEventAdmin).mockResolvedValue(perResult() as never);
  vi.mocked(computeSuggestedCancellationAmount).mockResolvedValue(5);
  vi.mocked(getCampaignBillingSummary).mockResolvedValue({ reachedCount: 3, ceiling: 400 } as never);
});

describe('/admin/cancellations/[id]', () => {
  it('is behind manage_billing', async () => {
    await render();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_billing');
  });

  it('a request that does not exist is a 404, not a screen', async () => {
    vi.mocked(getCancellationRequestForAdmin).mockResolvedValue(null);
    await expect(render()).rejects.toThrow();
  });

  it('asks for the campaign together with THIS request, so a refund the request already made is counted', async () => {
    await render();
    expect(getCampaignForEventAdmin).toHaveBeenCalledWith('e1', 'r1');
  });
});

describe('a fixed-price package', () => {
  it('paid, with a saved card: says the refund goes back by itself, and the form refunds', async () => {
    vi.mocked(getCampaignForEventAdmin).mockResolvedValue(pkg() as never);
    const html = await render();
    expect(html).toContain('יחזיר אוטומטית');
    expect(html).toContain('שולם ₪120.00');
    expect(form(html)).toMatchObject({ outcome: 'credit', base: '120', baseLabel: 'הסכום ששולם' });
  });

  it('never shows the pay-per-result screen: no "not charged yet", no reached-contacts accrual, no billing lookup', async () => {
    vi.mocked(getCampaignForEventAdmin).mockResolvedValue(pkg() as never);
    const html = await render();
    expect(html).not.toContain('טרם חויב');
    expect(html).not.toContain('אנשי קשר הושגו');
    expect(html).not.toContain('חיוב אמיתי');
    expect(getCampaignBillingSummary).not.toHaveBeenCalled();
  });

  it('the suggested fee is taken of what the card paid, not of a ceiling the package does not have', async () => {
    vi.mocked(getCampaignForEventAdmin).mockResolvedValue(pkg() as never);
    await render();
    expect(computeSuggestedCancellationAmount).toHaveBeenCalledWith('c1', 120);
  });

  it('paid but NO saved card: says plainly that it cannot be refunded here, and the form says it will fail', async () => {
    vi.mocked(getCampaignForEventAdmin).mockResolvedValue(pkg({ hasCardOnFile: false }) as never);
    const html = await render();
    expect(html).toContain('אין כרטיס שמור');
    expect(html).toContain('ייכשל');
    expect(html).not.toContain('יחזיר אוטומטית');
    expect(form(html)).toMatchObject({ outcome: 'blocked', base: '120' });
  });

  it('nothing paid (or all of it already back): says no money moves, with or without a card, and there is no base for a percentage', async () => {
    for (const hasCardOnFile of [true, false]) {
      vi.mocked(getCampaignForEventAdmin).mockResolvedValue(pkg({ packagePaid: 0, packageRefundable: 0, hasCardOnFile }) as never);
      const html = await render();
      expect(html).toContain('לא שולם דבר');
      expect(html).not.toContain('ייכשל');
      expect(form(html)).toMatchObject({ outcome: 'none', base: '0' });
    }
  });

  it('the ledger could not be read: claims nothing about the money, and the form will not promise a refund', async () => {
    vi.mocked(getCampaignForEventAdmin).mockResolvedValue(
      pkg({ packagePaid: null, packageRefundable: null, packageUnreadable: true, hasCardOnFile: false }) as never,
    );
    const html = await render();
    expect(html).toContain('לא ניתן לקרוא');
    expect(html).not.toContain('שולם ₪');
    expect(html).not.toContain('לא שולם דבר');
    expect(form(html)).toMatchObject({ outcome: 'blocked', base: '0' });
  });

  it('a request that already refunded part of it (a resolve that stopped halfway) says it will be resumed, not refunded again', async () => {
    vi.mocked(getCampaignForEventAdmin).mockResolvedValue(
      pkg({ packagePaid: 120, packageRefundable: 15, packageRefundedForRequest: 105 }) as never,
    );
    const html = await render();
    expect(html).toContain('כבר הוחזרו ₪105.00');
    expect(html).toContain('בלי להחזיר שוב');
    expect(html).not.toContain('יחזיר אוטומטית');
    expect(html).not.toContain('ייכשל');
    expect(form(html)).toMatchObject({ outcome: 'resume', base: '120' });
  });

  it('being resumed does not depend on a saved card: the money is already back', async () => {
    vi.mocked(getCampaignForEventAdmin).mockResolvedValue(
      pkg({ packagePaid: 120, packageRefundable: 0, packageRefundedForRequest: 120, hasCardOnFile: false }) as never,
    );
    expect(form(await render()).outcome).toBe('resume');
  });
});

describe('a pay-per-result campaign keeps its screen', () => {
  it('not charged yet: "טרם חויב", the form charges, the base is the ceiling', async () => {
    const html = await render();
    expect(html).toContain('טרם חויב');
    expect(form(html)).toMatchObject({ outcome: 'capture', base: '400', baseLabel: 'תקרת הקמפיין' });
    expect(computeSuggestedCancellationAmount).toHaveBeenCalledWith('c1', undefined);
    expect(getCampaignBillingSummary).toHaveBeenCalledWith('c1');
    expect(html).toContain('אנשי קשר הושגו');
  });

  it('charged, with a saved card: the form credits automatically, the base is what was charged', async () => {
    vi.mocked(getCampaignForEventAdmin).mockResolvedValue(
      perResult({ chargeStatus: 'charged', finalChargeAmount: 300, hasCardOnFile: true }) as never,
    );
    const html = await render();
    expect(html).toContain('זיכוי אוטומטי');
    expect(form(html)).toMatchObject({ outcome: 'credit', base: '300', baseLabel: 'הסכום שחויב' });
  });

  it('charged, with no saved card: only a manual refund is recorded', async () => {
    vi.mocked(getCampaignForEventAdmin).mockResolvedValue(perResult({ chargeStatus: 'charged', finalChargeAmount: 300 }) as never);
    const html = await render();
    expect(html).toContain('נדרש זיכוי');
    expect(form(html).outcome).toBe('manual');
  });
});

// An event with no LIVE campaign - it never had one, or every campaign was cancelled (each reset test run leaves one) - has nothing the
// resolver can charge or refund. The screen must say that, not "not charged yet / will charge the card now".
describe('an event with no live campaign', () => {
  it('says no money moves and the event closes, and tells the form so', async () => {
    vi.mocked(getCampaignForEventAdmin).mockResolvedValue(null);
    const html = await render();
    expect(html).toContain('לאירוע אין קמפיין פעיל');
    expect(html).toContain('לא יזיז כסף');
    expect(html).not.toContain('הקמפיין טרם חויב');
    expect(html).not.toContain('חיוב אמיתי');
    expect(form(html)).toMatchObject({ present: true, outcome: 'no_campaign', base: '0', suggested: '0' });
  });

  it('never looks up billing or a suggested amount for a campaign that is not there', async () => {
    vi.mocked(getCampaignForEventAdmin).mockResolvedValue(null);
    await render();
    expect(getCampaignBillingSummary).not.toHaveBeenCalled();
    expect(computeSuggestedCancellationAmount).not.toHaveBeenCalled();
  });
});

describe('a request that was already resolved', () => {
  it('shows the result and the credit document, and no form', async () => {
    vi.mocked(getCancellationRequestForAdmin).mockResolvedValue(
      request({
        status: 'resolved',
        resolution: 'full_cancellation',
        resolutionAmount: 120,
        captureOutcome: 'refunded',
        sumitDocumentUrl: 'https://example.test/doc/1',
        resolutionNote: 'הוחזר במלואו',
      }) as never,
    );
    vi.mocked(getCampaignForEventAdmin).mockResolvedValue(pkg({ packageRefundable: 0 }) as never);
    const html = await render();
    expect(form(html).present).toBe(false);
    expect(html).toContain('ביטול מלא');
    expect(html).toContain('₪120.00');
    expect(html).toContain('בוצע זיכוי');
    expect(html).toContain('href="https://example.test/doc/1"');
  });
});
