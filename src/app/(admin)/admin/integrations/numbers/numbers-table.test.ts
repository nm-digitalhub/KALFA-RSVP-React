import { describe, expect, it } from 'vitest';

import { NumbersTable } from './numbers-table';
import type { ProviderNumber } from '@/lib/data/admin/integrations/provider-numbers';

// The snapshot fold is where the provider's own vocabulary lands on the page:
// long, unbreakable, ALL_CAPS tokens, inside an RTL document. That combination
// produced an unreadable block on a real phone, and neither fault was visible from
// the source alone — which is why this walks the rendered tree instead.

/**
 * Walk the element tree, INVOKING nested function components as it goes.
 *
 * The page tests' `collect()` does not do this, and for them that is right — they
 * assert which components a page composes. Here the thing under test is markup that
 * only exists once `Snapshot` has actually run, so stopping at the element would
 * assert nothing. Every component reached here is synchronous and prop-pure.
 */
function walk(node: unknown, out: Array<Record<string, unknown>> = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, out));
    return out;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
  if (el.props) out.push({ ...el.props, __type: el.type });

  if (typeof el.type === 'function') {
    const render = el.type as (props: unknown) => unknown;
    // A component that throws on a bare call (a hook, a context read) is out of scope
    // for this walk rather than a test failure — the assertions name what they need.
    try {
      walk(render(el.props ?? {}), out);
    } catch {
      /* not renderable without a React runtime; its own children are skipped */
    }
  }

  walk(el.props?.children, out);
  return out;
}

function numberWithSnapshot(): ProviderNumber {
  return {
    id: 'n1',
    provider: 'meta_whatsapp',
    providerRef: '1312747078592700',
    e164: '+3333756982370',
    displayLabel: 'KALLFA',
    isActive: true,
    // The exact payload Meta returned for the number this bug was found on.
    snapshot: {
      status: 'PENDING',
      throughput: 'NOT_APPLICABLE',
      name_status: 'PENDING_REVIEW',
      account_mode: 'LIVE',
      platform_type: 'NOT_APPLICABLE',
      verified_name: 'KALLFA',
      quality_rating: 'UNKNOWN',
      messaging_limit_tier: null,
      code_verification_status: 'NOT_VERIFIED',
      is_official_business_account: false,
    },
    snapshotAt: '2026-09-11T00:39:22Z',
    source: 'sync',
    roles: [],
    updatedAt: '2026-09-11T00:39:22Z',
  } as unknown as ProviderNumber;
}

const rendered = () => walk(NumbersTable({ numbers: [numberWithSnapshot()] }));

describe('the provider snapshot fold', () => {
  it('puts dir="ltr" on the PAIR, not on the key and value separately', () => {
    // With it only on the children, the row stayed in the page's rtl and flex placed
    // the key on the right: the pair read "NOT_APPLICABLE throughput" — backwards.
    const dt = rendered().find((p) => p.__type === 'dt');
    const dd = rendered().find((p) => p.__type === 'dd');
    expect(dt, 'no <dt> rendered').toBeDefined();
    expect(dt?.dir, '<dt> carries its own dir; the wrapper should').toBeUndefined();
    expect(dd?.dir).toBeUndefined();

    const ltrWrappers = rendered().filter(
      (p) => p.dir === 'ltr' && typeof p.className === 'string' && p.className.includes('min-w-0'),
    );
    expect(ltrWrappers.length, 'no LTR pair wrapper').toBeGreaterThan(0);
  });

  it('lets an unbreakable provider token wrap instead of overflowing its column', () => {
    // is_official_business_account and PENDING_REVIEW have no break opportunity. In a
    // grid column with no min-width floor they printed over the neighbouring column.
    const dt = rendered().find((p) => p.__type === 'dt');
    const dd = rendered().find((p) => p.__type === 'dd');
    expect(String(dt?.className)).toContain('wrap-anywhere');
    expect(String(dd?.className)).toContain('wrap-anywhere');
  });

  it('renders every non-empty field the provider reported, and drops the empty ones', () => {
    // messaging_limit_tier is null here and must not become an empty row; `false` is
    // a real answer and must survive.
    const texts = rendered()
      .map((p) => p.children)
      .filter((c) => typeof c === 'string') as string[];
    expect(texts).toContain('code_verification_status');
    expect(texts).toContain('NOT_VERIFIED');
    expect(texts).not.toContain('messaging_limit_tier');
    expect(texts).toContain('is_official_business_account');
    expect(texts).toContain('false');
  });
});
