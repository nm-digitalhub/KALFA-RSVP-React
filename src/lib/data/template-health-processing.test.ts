import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Chainable admin-client stub: .select().eq().eq().maybeSingle() for the
// (name, language) lookup, .update().eq() for the write. Convention matches
// call-result-processing.test.ts.
let selectResult: { data: unknown; error: unknown } = { data: null, error: null };
// The Meta mirror lookup (by template id, one .eq). Default: not in the mirror,
// so the legacy tests below exercise exactly the legacy path.
let mirrorResult: { data: unknown; error: unknown } = { data: null, error: null };
const updateCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => selectResult,
          }),
          maybeSingle: async () => (table === 'whatsapp_message_templates' ? mirrorResult : selectResult),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: async () => {
          updateCalls.push({ table, payload });
          return { error: null };
        },
      }),
    }),
  }),
}));

const sendSlackAlert = vi.fn(async (..._args: unknown[]) => null as string | null);
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: (...args: unknown[]) => sendSlackAlert(...args) }));

import {
  processTemplateStatusRow,
  processTemplateCategoryRow,
  processTemplateCategoryMisuseRow,
  processTemplateQualityRow,
} from './template-health-processing';
import { isCategoryDowngraded } from '@/lib/whatsapp/template-health';

function row(payload: Record<string, unknown>) {
  return { id: 'row-1', payload } as unknown as Parameters<typeof processTemplateStatusRow>[0];
}

const TEMPLATE = { id: 'tmpl-1', requested_category: 'UTILITY', message_key: 'invite' };

beforeEach(() => {
  vi.clearAllMocks();
  selectResult = { data: TEMPLATE, error: null };
  mirrorResult = { data: null, error: null };
  updateCalls.length = 0; // a plain array, not a vi.fn() spy — clearAllMocks doesn't touch it
});

describe('isCategoryDowngraded (pure)', () => {
  it('false when category is null (never synced)', () => {
    expect(isCategoryDowngraded('UTILITY', null)).toBe(false);
  });
  it('false when the current category matches what was requested', () => {
    expect(isCategoryDowngraded('UTILITY', 'UTILITY')).toBe(false);
  });
  it('true when the current category differs from what was requested', () => {
    expect(isCategoryDowngraded('UTILITY', 'MARKETING')).toBe(true);
  });
});

describe('processTemplateStatusRow', () => {
  it('updates meta_status/rejected_reason and alerts (warn) on REJECTED', async () => {
    await processTemplateStatusRow(
      row({
        event: 'REJECTED',
        message_template_id: 1,
        message_template_name: 'invite',
        message_template_language: 'he',
        rejection_info: { reason: 'INVALID_FORMAT', recommendation: 'fix' },
      }),
    );
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toMatchObject({
      meta_status: 'REJECTED',
      rejected_reason: 'INVALID_FORMAT',
    });
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({ level: 'warn' });
  });

  it('alerts at error level on DISABLED', async () => {
    await processTemplateStatusRow(
      row({
        event: 'DISABLED',
        message_template_id: 1,
        message_template_name: 'invite',
        message_template_language: 'he',
      }),
    );
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({ level: 'error' });
  });

  it('updates but does not alert on APPROVED', async () => {
    await processTemplateStatusRow(
      row({
        event: 'APPROVED',
        message_template_id: 1,
        message_template_name: 'invite',
        message_template_language: 'he',
      }),
    );
    expect(updateCalls).toHaveLength(1);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('no-ops when no message_templates row matches (name/language)', async () => {
    selectResult = { data: null, error: null };
    await processTemplateStatusRow(
      row({
        event: 'REJECTED',
        message_template_id: 1,
        message_template_name: 'unknown_template',
        message_template_language: 'he',
      }),
    );
    expect(updateCalls).toHaveLength(0);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('ignores a malformed payload (missing required fields)', async () => {
    await processTemplateStatusRow(row({ event: 'REJECTED' }));
    expect(updateCalls).toHaveLength(0);
  });
});

describe('processTemplateCategoryRow', () => {
  it('impending change (category_update_timestamp present): sets pending fields, warns, does not touch `category`', async () => {
    await processTemplateCategoryRow(
      row({
        message_template_id: 1,
        message_template_name: 'invite',
        message_template_language: 'he',
        new_category: 'UTILITY',
        correct_category: 'MARKETING',
        category_update_timestamp: 1700000000,
      }),
    );
    expect(updateCalls[0].payload).toMatchObject({ pending_correct_category: 'MARKETING' });
    expect(updateCalls[0].payload.category).toBeUndefined();
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({ level: 'warn' });
  });

  it('completed downgrade (no timestamp, category != requested): sets category, clears pending, alerts error', async () => {
    await processTemplateCategoryRow(
      row({
        message_template_id: 1,
        message_template_name: 'invite',
        message_template_language: 'he',
        new_category: 'MARKETING',
      }),
    );
    expect(updateCalls[0].payload).toMatchObject({
      category: 'MARKETING',
      pending_category_change_at: null,
      pending_correct_category: null,
    });
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({ level: 'error' });
  });

  it('completed change matching requested category: updates, does not alert', async () => {
    await processTemplateCategoryRow(
      row({
        message_template_id: 1,
        message_template_name: 'invite',
        message_template_language: 'he',
        new_category: 'UTILITY',
      }),
    );
    expect(updateCalls).toHaveLength(1);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});

describe('processTemplateCategoryMisuseRow', () => {
  it('sets pending_correct_category and warns', async () => {
    await processTemplateCategoryMisuseRow(
      row({
        message_template_id: 1,
        message_template_name: 'invite',
        message_template_language: 'he',
        category: 'UTILITY',
        correct_category: 'MARKETING',
      }),
    );
    expect(updateCalls[0].payload).toMatchObject({ pending_correct_category: 'MARKETING' });
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({ level: 'warn' });
  });
});

describe('processTemplateQualityRow', () => {
  it('RED: updates quality_score and alerts error', async () => {
    await processTemplateQualityRow(
      row({
        message_template_id: 1,
        message_template_name: 'invite',
        message_template_language: 'he',
        previous_quality_score: 'YELLOW',
        new_quality_score: 'RED',
      }),
    );
    expect(updateCalls[0].payload).toMatchObject({ quality_score: 'RED' });
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({ level: 'error' });
  });

  it('recovers from RED: updates, alerts at info level', async () => {
    await processTemplateQualityRow(
      row({
        message_template_id: 1,
        message_template_name: 'invite',
        message_template_language: 'he',
        previous_quality_score: 'RED',
        new_quality_score: 'YELLOW',
      }),
    );
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({ level: 'info' });
  });

  it('GREEN to YELLOW (no RED involved): updates, no alert', async () => {
    await processTemplateQualityRow(
      row({
        message_template_id: 1,
        message_template_name: 'invite',
        message_template_language: 'he',
        previous_quality_score: 'GREEN',
        new_quality_score: 'YELLOW',
      }),
    );
    expect(updateCalls).toHaveLength(1);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});

// Every template a step sends is watched through the Meta mirror — including the
// event-type / image variants that have no legacy message_templates row.
describe('mirror (whatsapp_message_templates)', () => {
  const VARIANT = {
    id: '555',
    whatsapp_template_settings: { requested_category: 'UTILITY' },
    message_template_routes: [{ message_key: 'reminder_1' }, { message_key: 'reminder_2' }],
  };

  it('a routed variant with no legacy row: mirror updated, alert names its steps', async () => {
    selectResult = { data: null, error: null };
    mirrorResult = { data: VARIANT, error: null };
    await processTemplateStatusRow(
      row({ event: 'REJECTED', message_template_id: 555, message_template_name: 'kalfa_brit_reminder_trad_v1', message_template_language: 'he' }),
    );
    expect(updateCalls).toEqual([
      { table: 'whatsapp_message_templates', payload: expect.objectContaining({ status: 'REJECTED' }) },
    ]);
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({
      fields: expect.objectContaining({ message_key: 'reminder_1, reminder_2' }),
    });
  });

  it('a variant downgrade compares against the category requested for THAT template', async () => {
    selectResult = { data: null, error: null };
    mirrorResult = { data: VARIANT, error: null };
    await processTemplateCategoryRow(
      row({ message_template_id: 555, message_template_name: 'x', message_template_language: 'he', new_category: 'MARKETING', previous_category: 'UTILITY' }),
    );
    expect(updateCalls[0]).toEqual({
      table: 'whatsapp_message_templates',
      payload: expect.objectContaining({ category: 'MARKETING', previous_category: 'UTILITY' }),
    });
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({ level: 'error' });
  });

  it('quality is stored in Meta\'s own shape ({ score, date })', async () => {
    selectResult = { data: null, error: null };
    mirrorResult = { data: VARIANT, error: null };
    await processTemplateQualityRow(
      row({ message_template_id: 555, message_template_name: 'x', message_template_language: 'he', new_quality_score: 'YELLOW' }),
    );
    expect(updateCalls[0].payload.quality_score).toMatchObject({ score: 'YELLOW', date: expect.any(Number) });
  });

  it('a mirror template no step sends: ignored here (the nightly sync keeps it current), no alert', async () => {
    selectResult = { data: null, error: null };
    mirrorResult = { data: { id: '9', whatsapp_template_settings: null, message_template_routes: [] }, error: null };
    await processTemplateStatusRow(
      row({ event: 'REJECTED', message_template_id: 9, message_template_name: 'unused', message_template_language: 'he' }),
    );
    expect(updateCalls).toHaveLength(0);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});
