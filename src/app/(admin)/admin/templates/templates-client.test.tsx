// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  updateTemplateAction: vi.fn(),
  acknowledgeTemplateCategoryAction: vi.fn(),
}));

import { TemplatesClient } from './templates-client';

// Everything under test is what the component PUTS ON THE PAGE for a given template row, so React renders it,
// useActionState included. Calling it as a plain function, as this suite once did, is what React forbids ("Never
// call component functions directly", react.dev Rules of React): the hooks then ran outside a render and printed
// "Invalid hook call".

afterEach(cleanup);

function renderClient(templates: Row[]): HTMLElement {
  return render(<TemplatesClient templates={templates} />).container;
}

const text = (container: HTMLElement) => container.textContent ?? '';

function hiddenInputs(container: HTMLElement): Map<string, string> {
  return new Map(
    [...container.querySelectorAll<HTMLInputElement>('input[type="hidden"][name]')].map((input) => [
      input.name,
      input.value,
    ]),
  );
}

/** Does any button carry a formAction (the acknowledge button is the only one)? React renders it as `formaction`. */
const hasFormActionButton = (container: HTMLElement) => container.querySelector('button[formaction]') !== null;

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
    const tree = renderClient([BASE]);
    expect(hasFormActionButton(tree)).toBe(false);
    expect(text(tree)).not.toContain('אישור הקטגוריה');
  });

  it('offers the button only on a template that actually drifted', () => {
    const tree = renderClient([DRIFTED]);
    expect(hasFormActionButton(tree)).toBe(true);
    expect(text(tree)).toContain('אישור הקטגוריה');
  });

  it('carries the category that is ON SCREEN, so the write can be pinned to it', () => {
    const hidden = hiddenInputs(renderClient([DRIFTED]));
    expect(hidden.get('observed_category')).toBe('MARKETING');
    expect(hidden.get('id')).toBe(DRIFTED.id);
  });

  it('says the billing and the limits do NOT change', () => {
    // The badge clearing must not read as the problem going away — Meta classifies
    // by message body, and acknowledging changes the record, not the classification.
    const t = text(renderClient([DRIFTED]));
    expect(t).toContain('אינו');
    expect(t).toContain('מחויבת ומוגבלת');
    expect(t).toContain('יתריע מחדש');
  });

  it('a call template has no category surface at all', () => {
    // Meta categories are a WhatsApp concept; `call` rows have name='' and would
    // otherwise render a drift badge against a category Meta never assigned.
    const tree = renderClient([{ ...DRIFTED, channel: 'call', message_key: 'call_1', name: '' }]);
    expect(hasFormActionButton(tree)).toBe(false);
    expect(text(tree)).not.toContain('ירדה בקטגוריה');
  });
});
