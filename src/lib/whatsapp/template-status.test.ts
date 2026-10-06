import { describe, expect, it } from 'vitest';

import { decideRoutedTemplate, type TemplateRouteRow } from './template-route';
import { rejectionLabel, statusLabel, statusTone, stepOutcome, templateIssues, type StepTemplate } from './template-status';

const BODY = [{ type: 'BODY', text: 'שלום {{1}}' }];

function tpl(id: string, status: string | null, over: Partial<StepTemplate> = {}): StepTemplate {
  return {
    id,
    name: `name_${id}`,
    language: 'he',
    status,
    category: 'UTILITY',
    requestedCategory: 'UTILITY',
    qualityScore: 'GREEN',
    rejectedReason: null,
    unsupported: [],
    components: BODY,
    parameters: [{ type: 'body', sub_type: null, index: null, position: 1, source_path: 'guest.first_name' }],
    ...over,
  };
}

const route = (templateId: string, eventType: string | null = null, withMedia = false): TemplateRouteRow => ({
  message_key: 'invite',
  event_type: eventType,
  with_media: withMedia,
  whatsapp_template_id: templateId,
});

function outcome(templates: StepTemplate[], routes: TemplateRouteRow[], over: { active?: boolean; eventType?: string | null; withImage?: boolean } = {}) {
  const templatesById = new Map(templates.map((t) => [t.id, t]));
  const liveByNameLanguage = new Map(templates.filter((t) => t.status !== 'DELETED').map((t) => [`${t.name}|${t.language}`, t]));
  return stepOutcome({
    messageKey: 'invite',
    active: over.active ?? true,
    routes,
    templatesById,
    liveByNameLanguage,
    eventType: over.eventType ?? 'wedding',
    withImage: over.withImage ?? false,
    valuePaths: ['guest.first_name', 'event.venue'],
  });
}

describe('decideRoutedTemplate (the sender rule)', () => {
  it.each(['PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'SOMETHING_NEW', null])(
    'a %s template is not sent',
    (status) => {
      expect(decideRoutedTemplate({ status }, null)).toMatchObject({ send: false, reason: 'not_approved' });
    },
  );
  it('an approved template is sent', () => {
    expect(decideRoutedTemplate({ status: 'APPROVED' }, null)).toMatchObject({ send: true });
  });
  it('a deleted template is replaced by its approved twin', () => {
    const old = { status: 'DELETED' };
    const twin = { status: 'APPROVED' };
    expect(decideRoutedTemplate(old, twin)).toEqual({ send: true, template: twin, deletedOriginal: old });
  });
  it('a deleted template with no twin, or a twin not approved, is not sent', () => {
    expect(decideRoutedTemplate({ status: 'DELETED' }, null)).toMatchObject({ send: false, reason: 'deleted_no_twin' });
    expect(decideRoutedTemplate({ status: 'DELETED' }, { status: 'PENDING' })).toMatchObject({
      send: false,
      reason: 'not_approved',
    });
  });
});

describe('stepOutcome — what a guest gets', () => {
  it('sends the event type own route when there is one', () => {
    const o = outcome([tpl('a', 'APPROVED'), tpl('w', 'APPROVED')], [route('a'), route('w', 'wedding')]);
    expect(o).toMatchObject({ state: 'sends', source: 'own', issues: [] });
    expect(o.decision?.template?.id).toBe('w');
  });

  it('falls back to the default route', () => {
    const o = outcome([tpl('a', 'APPROVED')], [route('a')]);
    expect(o).toMatchObject({ state: 'sends', source: 'default' });
  });

  it('asked for the image version without one: the text one goes, and says so', () => {
    const o = outcome([tpl('a', 'APPROVED')], [route('a')], { withImage: true });
    expect(o).toMatchObject({ state: 'sends', imageFallback: true });
  });

  it('an inactive step sends nothing', () => {
    expect(outcome([tpl('a', 'APPROVED')], [route('a')], { active: false }).state).toBe('inactive');
  });

  it('⚠️ a blocked own template blocks the step — no fallback to the default', () => {
    const o = outcome([tpl('a', 'APPROVED'), tpl('w', 'PAUSED')], [route('a'), route('w', 'wedding')]);
    expect(o.state).toBe('blocked');
    expect(o.issues[0]?.title).toBe('התבנית מושהית — השלב לא נשלח');
  });

  it('a deleted template with a live twin still sends, and asks to update the route', () => {
    const old = tpl('old', 'DELETED', { name: 'x' });
    const fresh = tpl('new', 'APPROVED', { name: 'x' });
    const o = outcome([old, fresh], [route('old')]);
    expect(o.state).toBe('sends');
    expect(o.decision?.template?.id).toBe('new');
    expect(o.issues.map((i) => i.code)).toEqual(['deleted_twin']);
  });

  it('a deleted template with no twin blocks', () => {
    expect(outcome([tpl('old', 'DELETED')], [route('old')]).state).toBe('blocked');
  });

  it('a variable with no value blocks (Meta rejects a send whose parameters do not match)', () => {
    const o = outcome([tpl('a', 'APPROVED', { parameters: [{ type: 'body', sub_type: null, index: null, position: 1, source_path: null }] })], [route('a')]);
    expect(o.state).toBe('blocked');
    expect(o.issues.map((i) => i.title)).toContain('חסר ערך ל-{{1}}');
  });

  it('category drift and low quality warn but do not block', () => {
    const o = outcome([tpl('a', 'APPROVED', { category: 'MARKETING', qualityScore: 'RED' })], [route('a')]);
    expect(o.state).toBe('sends');
    expect(o.issues.map((i) => i.code).sort()).toEqual(['category', 'quality:RED']);
  });

  it('no route at all', () => {
    expect(outcome([], []).state).toBe('no_route');
  });
});

describe('labels', () => {
  it('names known statuses in Hebrew and shows an unknown one as Meta sent it', () => {
    expect(statusLabel('PAUSED')).toBe('מושהית');
    expect(statusLabel('BRAND_NEW')).toBe('BRAND_NEW');
    expect(statusTone('BRAND_NEW')).toBe('bad');
    expect(statusTone('PENDING')).toBe('warn');
  });

  it('a rejected template carries Meta reason', () => {
    const issues = templateIssues({ ...tpl('a', 'REJECTED'), rejectedReason: 'INVALID_FORMAT' });
    expect(issues[0]).toMatchObject({ level: 'block', detail: 'סיבה מ-Meta: מבנה לא תקין' });
  });

  it('a rejection reason not in the spec shows as Meta sent it; NONE is no reason', () => {
    expect(rejectionLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(rejectionLabel('NONE')).toBeNull();
  });
});
