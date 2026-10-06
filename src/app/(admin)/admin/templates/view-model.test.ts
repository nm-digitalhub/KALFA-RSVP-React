import { describe, expect, it } from 'vitest';

import type { AdminMetaTemplate, WhatsAppTemplateAdmin } from '@/lib/data/admin/whatsapp-templates';

import { catalog, journey, pendingReclassification, templateProblems } from './view-model';

function tpl(id: string, over: Partial<AdminMetaTemplate> = {}): AdminMetaTemplate {
  return {
    id,
    name: `t_${id}`,
    language: 'he',
    status: 'APPROVED',
    category: 'UTILITY',
    components: [{ type: 'BODY', text: 'שלום {{1}}' }],
    requestedCategory: 'UTILITY',
    qualityScore: 'GREEN',
    rejectedReason: null,
    rsvpQuickReplies: false,
    parameters: [{ type: 'body', sub_type: null, index: null, position: 1, source_path: 'guest.first_name' }],
    unsupported: [],
    ...over,
  };
}

const PATHS = ['guest.first_name', 'event.venue'];

function data(over: Partial<WhatsAppTemplateAdmin> = {}): WhatsAppTemplateAdmin {
  return {
    lastSyncedAt: null,
    templates: [tpl('1'), tpl('2'), tpl('3', { status: 'PAUSED' }), tpl('4', { status: 'PENDING' }), tpl('5')],
    steps: [
      { messageKey: 'thankyou', label: 'תודה', active: true, valuePaths: PATHS, routes: [{ eventType: null, withMedia: false, templateId: '1' }] },
      { messageKey: 'sales_signup_link', label: 'ליד', active: true, valuePaths: PATHS, routes: [{ eventType: null, withMedia: false, templateId: '1' }] },
      {
        messageKey: 'invite',
        label: 'הזמנה',
        active: true,
        valuePaths: PATHS,
        routes: [
          { eventType: null, withMedia: false, templateId: '1' },
          { eventType: 'wedding', withMedia: false, templateId: '3' },
        ],
      },
      { messageKey: 'gift', label: 'מתנה', active: false, valuePaths: PATHS, routes: [{ eventType: null, withMedia: false, templateId: '2' }] },
    ],
    ...over,
  };
}

describe('journey', () => {
  it('lists guest steps in the order a guest meets them, and the lead step apart', () => {
    const { guest, other } = journey(data(), null, false);
    expect(guest.map((r) => r.step.messageKey)).toEqual(['invite', 'gift', 'thankyou']);
    expect(other.map((r) => r.step.messageKey)).toEqual(['sales_signup_link']);
  });

  it('⚠️ a wedding whose own template is paused is blocked, not quietly sent the default', () => {
    const invite = journey(data(), 'wedding', false).guest[0]!;
    expect(invite.outcome.state).toBe('blocked');
    expect(invite.outcome.source).toBe('own');
  });

  it('another event type gets the default', () => {
    const invite = journey(data(), 'brit', false).guest[0]!;
    expect(invite.outcome).toMatchObject({ state: 'sends', source: 'default' });
  });

  it('an inactive step still shows the template it would send', () => {
    const gift = journey(data(), null, false).guest.find((r) => r.step.messageKey === 'gift')!;
    expect(gift.outcome.state).toBe('inactive');
    expect(gift.outcome.decision?.template?.id).toBe('2');
    expect(gift.outcome.issues[0]?.code).toBe('inactive');
  });

  it('offers only approved templates that match text or image', () => {
    const d = data({ templates: [...data().templates, tpl('9', { parameters: [{ type: 'header', sub_type: null, index: null, position: 1, source_path: null }] })] });
    expect(journey(d, null, false).guest[0]!.eligible.map((t) => t.id)).toEqual(['1', '2', '5']);
    expect(journey(d, null, true).guest[0]!.eligible.map((t) => t.id)).toEqual(['9']);
  });
});

describe('catalog', () => {
  const page = { q: '', page: 1, pageSize: 20 };

  it('counts every state and filters by it', () => {
    const { counts } = catalog(data(), { ...page, filter: 'all' });
    expect(counts).toMatchObject({ all: 5, pending: 1, stopped: 1, unused: 2, attention: 1 });
    expect(catalog(data(), { ...page, filter: 'stopped' }).rows.map((r) => r.template.id)).toEqual(['3']);
  });

  it('a status Meta adds later is still listed, as "stopped"', () => {
    const d = data({ templates: [tpl('1', { status: 'BRAND_NEW' })] });
    expect(catalog(d, { ...page, filter: 'stopped' }).total).toBe(1);
  });

  it('puts templates with problems first and searches name and body', () => {
    const { rows } = catalog(data(), { ...page, filter: 'all' });
    expect(rows[0]!.template.id).toBe('3');
    expect(catalog(data(), { ...page, filter: 'all', q: 't_5' }).rows.map((r) => r.template.id)).toEqual(['5']);
    expect(catalog(data(), { ...page, filter: 'all', q: 'שלום' }).total).toBe(5);
  });

  it('paginates on the server', () => {
    const result = catalog(data(), { filter: 'all', q: '', page: 2, pageSize: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(5);
  });

  it('a used template with an unmapped variable needs attention', () => {
    const d = data({ templates: [tpl('1', { parameters: [{ type: 'body', sub_type: null, index: null, position: 1, source_path: null }] })] });
    expect(templateProblems(d, d.templates[0]!).map((i) => i.title)).toContain('חסר ערך ל-{{1}}');
  });
});

describe('pendingReclassification', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    channel: 'whatsapp' as const,
    name: 't_1',
    language: 'he',
    pending_category_change_at: '2026-10-01T09:00:00Z',
    pending_correct_category: 'MARKETING',
    ...over,
  });

  it("shows Meta's advance notice for the template it names", () => {
    expect(pendingReclassification([row()], tpl('1'))).toMatchObject({ level: 'warn', code: 'category_pending' });
    expect(pendingReclassification([row()], tpl('1'))?.title).toContain('כ-MARKETING');
  });

  it('nothing when no change is pending, or it is about another template', () => {
    expect(pendingReclassification([row({ pending_category_change_at: null })], tpl('1'))).toBeNull();
    expect(pendingReclassification([row({ name: 'other' })], tpl('1'))).toBeNull();
  });
});
