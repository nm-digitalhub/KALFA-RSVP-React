import { describe, expect, it, vi } from 'vitest';

// useActionState throws outside a React render; everything under test is what the
// component PUTS IN THE TREE for a given template row.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useActionState: () => [null, vi.fn(), false] };
});
vi.mock('./actions', () => ({
  updateTemplateAction: vi.fn(),
  acknowledgeTemplateCategoryAction: vi.fn(),
}));

import { TemplatesClient } from './templates-client';

type El = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };

function collect(node: unknown, out: El[] = [], depth = 0): El[] {
  if (!node || typeof node !== 'object' || depth > 60) return out;
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

function hiddenInputs(tree: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const el of collect(tree)) {
    if (el.type === 'input' && el.props?.type === 'hidden' && typeof el.props.name === 'string') {
      out.set(el.props.name, el.props.value);
    }
  }
  return out;
}

/** Does any button carry a formAction (the acknowledge button is the only one)? */
function hasFormActionButton(tree: unknown): boolean {
  return collect(tree).some((el) => el.type === 'button' && el.props?.formAction != null);
}

type Row = Parameters<typeof TemplatesClient>[0]['templates'][number];

const BASE: Row = {
  id: '22222222-2222-4222-8222-222222222222',
  message_key: 'gift',
  channel: 'whatsapp',
  label: 'מתנה',
  name: 'gift_he',
  language: 'he',
  body: null,
  active: true,
  category: 'MARKETING',
  requested_category: 'MARKETING',
  quality_score: 'GREEN',
  meta_status: 'APPROVED',
  rejected_reason: null,
  pending_category_change_at: null,
  pending_correct_category: null,
  last_synced_at: null,
};

const DRIFTED: Row = { ...BASE, requested_category: 'UTILITY' };

describe('the category-drift acknowledgement (D4)', () => {
  it('offers nothing to acknowledge when the category matches', () => {
    const tree = TemplatesClient({ templates: [BASE] });
    expect(hasFormActionButton(tree)).toBe(false);
    expect(text(tree)).not.toContain('אישור הקטגוריה');
  });

  it('offers the button only on a template that actually drifted', () => {
    const tree = TemplatesClient({ templates: [DRIFTED] });
    expect(hasFormActionButton(tree)).toBe(true);
    expect(text(tree)).toContain('אישור הקטגוריה');
  });

  it('carries the category that is ON SCREEN, so the write can be pinned to it', () => {
    const hidden = hiddenInputs(TemplatesClient({ templates: [DRIFTED] }));
    expect(hidden.get('observed_category')).toBe('MARKETING');
    expect(hidden.get('id')).toBe(DRIFTED.id);
  });

  it('says the billing and the limits do NOT change', () => {
    // The badge clearing must not read as the problem going away — Meta classifies
    // by message body, and acknowledging changes the record, not the classification.
    const t = text(TemplatesClient({ templates: [DRIFTED] }));
    expect(t).toContain('אינו');
    expect(t).toContain('מחויבת ומוגבלת');
    expect(t).toContain('יתריע מחדש');
  });

  it('a call template has no category surface at all', () => {
    // Meta categories are a WhatsApp concept; `call` rows have name='' and would
    // otherwise render a drift badge against a category Meta never assigned.
    const tree = TemplatesClient({
      templates: [{ ...DRIFTED, channel: 'call', message_key: 'call_1', name: '' }],
    });
    expect(hasFormActionButton(tree)).toBe(false);
    expect(text(tree)).not.toContain('ירדה בקטגוריה');
  });
});
