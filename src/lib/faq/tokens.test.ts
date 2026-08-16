import { describe, expect, it } from 'vitest';

import { buildFaqTokenValues, substituteFaqTokens } from './tokens';
import { buildBusinessFacts, type PackageFacts } from '@/lib/fleet/business-facts';

const pkg: PackageFacts = {
  name: 'אישורי הגעה — וואטסאפ + שיחות AI',
  price_per_reached: 4,
  base_price: 200,
  included_reached: 200,
  channels: ['whatsapp', 'call'],
};

describe('buildFaqTokenValues', () => {
  it('base+overage model: all four tokens resolve to real values', () => {
    const values = buildFaqTokenValues(buildBusinessFacts(true, pkg));
    expect(values.base_price).toBe('₪200');
    expect(values.included_reached).toBe('200');
    expect(values.price_per_reached).toBe('₪4');
    expect(values.channels_list).toBe('וואטסאפ, שיחה טלפונית (AI)');
  });

  it('per-reached model (gate off): base/included blank out instead of showing ₪0', () => {
    const values = buildFaqTokenValues(buildBusinessFacts(false, pkg));
    expect(values.base_price).toBe('');
    expect(values.included_reached).toBe('');
    // price_per_reached and channels_list are meaningful under either model.
    expect(values.price_per_reached).toBe('₪4');
    expect(values.channels_list).toBe('וואטסאפ, שיחה טלפונית (AI)');
  });

  it('facts unavailable: every token blanks out, none show a stale/fabricated number', () => {
    const values = buildFaqTokenValues(buildBusinessFacts(true, null));
    expect(values.base_price).toBe('');
    expect(values.included_reached).toBe('');
    expect(values.price_per_reached).toBe('');
    expect(values.channels_list).toBe('');
  });
});

describe('substituteFaqTokens ({{double_brace}} — the shared engine)', () => {
  it('replaces known tokens and leaves the sentence brace-free', () => {
    const out = substituteFaqTokens('שולחים הזמנות ב־{{channels_list}}.', {
      channels_list: 'וואטסאפ, שיחה טלפונית (AI)',
    });
    expect(out).toBe('שולחים הזמנות ב־וואטסאפ, שיחה טלפונית (AI).');
    expect(out).not.toContain('{{');
  });

  it('an unknown token name (typo) is left literal, not silently dropped', () => {
    const out = substituteFaqTokens('מחיר: {{totaly_unknown_token}}', { channels_list: 'x' });
    expect(out).toBe('מחיר: {{totaly_unknown_token}}');
  });

  it('a known token resolved to "" cleanly disappears, never renders as-is', () => {
    const out = substituteFaqTokens('דמי הפעלה {{base_price}}.', { base_price: '' });
    expect(out).toBe('דמי הפעלה .');
    expect(out).not.toContain('{{base_price}}');
  });

  it('single braces are NOT treated as tokens (only {{double}} — matches the agreement template)', () => {
    const out = substituteFaqTokens('מחיר {base_price} רגיל', { base_price: '₪200' });
    expect(out).toBe('מחיר {base_price} רגיל');
  });
});
