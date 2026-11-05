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
// A write that fails, by table. Default: every write succeeds.
let updateErrors: Record<string, unknown> = {};
// Rows already marked processed, and the failure of the query that reads them.
type ProcessedInboxRow = { event_kind: string; templateId: string; event_at: string };
let processedInbox: ProcessedInboxRow[] = [];
let inboxError: unknown = null;

function inboxQuery() {
  const equal: Record<string, unknown> = {};
  let after = '';
  const query = {
    eq(column: string, value: unknown) {
      equal[column] = value;
      return query;
    },
    gt(_column: string, value: string) {
      after = value;
      return query;
    },
    not: () => query,
    limit: async () => ({
      data: processedInbox.filter(
        (r) =>
          r.event_kind === equal.event_kind &&
          r.templateId === equal['payload->>message_template_id'] &&
          r.event_at > after,
      ),
      error: inboxError,
    }),
  };
  return query;
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () =>
        table === 'webhook_inbox'
          ? inboxQuery()
          : {
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => selectResult,
                }),
                maybeSingle: async () => (table === 'whatsapp_message_templates' ? mirrorResult : selectResult),
              }),
            },
      update: (payload: Record<string, unknown>) => ({
        eq: async () => {
          updateCalls.push({ table, payload });
          return { error: updateErrors[table] ?? null };
        },
      }),
    }),
  }),
}));

const runTemplateHealthSync = vi.fn(async () => ({ synced: 0, skipped: 0, newDowngrades: 0, mirrored: 0 }));
vi.mock('@/lib/data/template-health-sync', () => ({ runTemplateHealthSync: () => runTemplateHealthSync() }));

const sendSlackAlert = vi.fn(async (..._args: unknown[]) => null as string | null);
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: (...args: unknown[]) => sendSlackAlert(...args) }));

import {
  processTemplateStatusRow,
  processTemplateCategoryRow,
  processTemplateCategoryMisuseRow,
  processTemplateQualityRow,
  processTemplateComponentsRow,
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
  updateErrors = {};
  processedInbox = [];
  inboxError = null;
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

  // A template no step sends today can be assigned to a step tomorrow, so its row
  // stays current; only the alert is for templates a step actually sends.
  describe('a mirror template no step sends: mirror updated, no alert', () => {
    const UNUSED = { id: '9', whatsapp_template_settings: null, message_template_routes: [] };
    const keys = { message_template_id: 9, message_template_name: 'unused', message_template_language: 'he' };

    beforeEach(() => {
      selectResult = { data: null, error: null };
      mirrorResult = { data: UNUSED, error: null };
    });

    it('status', async () => {
      await processTemplateStatusRow(row({ ...keys, event: 'REJECTED' }));
      expect(updateCalls).toEqual([
        { table: 'whatsapp_message_templates', payload: expect.objectContaining({ status: 'REJECTED' }) },
      ]);
      expect(sendSlackAlert).not.toHaveBeenCalled();
    });

    it('completed category change', async () => {
      await processTemplateCategoryRow(row({ ...keys, previous_category: 'UTILITY', new_category: 'MARKETING' }));
      expect(updateCalls).toEqual([
        {
          table: 'whatsapp_message_templates',
          payload: expect.objectContaining({ category: 'MARKETING', previous_category: 'UTILITY' }),
        },
      ]);
      expect(sendSlackAlert).not.toHaveBeenCalled();
    });

    it('impending category change leaves the category as it is', async () => {
      await processTemplateCategoryRow(
        row({ ...keys, new_category: 'UTILITY', correct_category: 'MARKETING', category_update_timestamp: 1746169200 }),
      );
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].payload).toMatchObject({ correct_category: 'MARKETING' });
      expect(updateCalls[0].payload).not.toHaveProperty('category');
      expect(sendSlackAlert).not.toHaveBeenCalled();
    });

    it('category misuse', async () => {
      await processTemplateCategoryMisuseRow(row({ ...keys, category: 'UTILITY', correct_category: 'MARKETING' }));
      expect(updateCalls).toEqual([
        { table: 'whatsapp_message_templates', payload: expect.objectContaining({ correct_category: 'MARKETING' }) },
      ]);
      expect(sendSlackAlert).not.toHaveBeenCalled();
    });

    it('quality', async () => {
      await processTemplateQualityRow(row({ ...keys, new_quality_score: 'RED' }));
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].payload.quality_score).toMatchObject({ score: 'RED' });
      expect(sendSlackAlert).not.toHaveBeenCalled();
    });
  });

  it('a template Meta knows and we do not: nothing to update, nothing thrown', async () => {
    selectResult = { data: null, error: null };
    await processTemplateCategoryRow(
      row({ message_template_id: 12345678, message_template_name: 'my_message_template', message_template_language: 'en-US', new_category: 'UTILITY' }),
    );
    expect(updateCalls).toHaveLength(0);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});

// handleWebhook (worker/main.ts) retries a row only when processing throws. A write
// or read that fails quietly would be marked processed, and the change would be lost
// until the nightly sync.
describe('a failed read or write fails the row, so the worker retries it', () => {
  const keys = { message_template_id: 555, message_template_name: 'x', message_template_language: 'he' };
  const completed = row({ ...keys, previous_category: 'UTILITY', new_category: 'MARKETING' });
  const MIRROR = {
    id: '555',
    whatsapp_template_settings: { requested_category: 'UTILITY' },
    message_template_routes: [{ message_key: 'gift' }],
  };

  beforeEach(() => {
    mirrorResult = { data: MIRROR, error: null };
  });

  it('the mirror write', async () => {
    updateErrors = { whatsapp_message_templates: { code: 'XX000' } };
    await expect(processTemplateCategoryRow(completed)).rejects.toThrow();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('the legacy write', async () => {
    updateErrors = { message_templates: { code: 'XX000' } };
    await expect(processTemplateCategoryRow(completed)).rejects.toThrow();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('the mirror lookup', async () => {
    mirrorResult = { data: null, error: { code: 'XX000' } };
    await expect(processTemplateCategoryRow(completed)).rejects.toThrow();
    expect(updateCalls).toHaveLength(0);
  });

  it('the legacy lookup', async () => {
    selectResult = { data: null, error: { code: 'XX000' } };
    await expect(processTemplateCategoryRow(completed)).rejects.toThrow();
    expect(updateCalls).toHaveLength(0);
  });

  it('every other template event', async () => {
    updateErrors = { whatsapp_message_templates: { code: 'XX000' } };
    await expect(processTemplateStatusRow(row({ ...keys, event: 'APPROVED' }))).rejects.toThrow();
    await expect(
      processTemplateCategoryMisuseRow(row({ ...keys, category: 'UTILITY', correct_category: 'MARKETING' })),
    ).rejects.toThrow();
    await expect(processTemplateQualityRow(row({ ...keys, new_quality_score: 'GREEN' }))).rejects.toThrow();
  });

  it('a retried row applies the same change again without a second alert from the failed try', async () => {
    updateErrors = { message_templates: { code: 'XX000' } };
    await expect(processTemplateCategoryRow(completed)).rejects.toThrow();
    updateErrors = {};
    await processTemplateCategoryRow(completed);
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
  });
});

// A failed row stays in the queue while the rows after it go on, so its retry can land
// after a newer event for the same template. The send decision reads the status, so an
// old APPROVED written over a newer DISABLED would send a template Meta has disabled.
describe('a retried event never overwrites a newer one', () => {
  const keys = { message_template_id: 555, message_template_name: 'x', message_template_language: 'he' };
  const EARLIER = '2026-11-05T08:00:00+00:00';
  const LATER = '2026-11-05T08:00:30+00:00';
  const MIRROR = {
    id: '555',
    whatsapp_template_settings: { requested_category: 'UTILITY' },
    message_template_routes: [{ message_key: 'gift' }],
  };
  const event = (event_kind: string, event_at: string | null, payload: Record<string, unknown>) =>
    ({ id: `row-${event_at}`, event_kind, event_at, payload: { ...keys, ...payload } }) as unknown as Parameters<
      typeof processTemplateStatusRow
    >[0];
  const processed = (event_kind: string, event_at: string, templateId = '555') =>
    processedInbox.push({ event_kind, templateId, event_at });
  const approved = event('template_status', EARLIER, { event: 'APPROVED' });

  beforeEach(() => {
    mirrorResult = { data: MIRROR, error: null };
  });

  it('approval fails, a later disable succeeds: the approval retry leaves the template disabled', async () => {
    updateErrors = { whatsapp_message_templates: { code: 'XX000' } };
    await expect(processTemplateStatusRow(approved)).rejects.toThrow();

    updateErrors = {};
    await processTemplateStatusRow(event('template_status', LATER, { event: 'DISABLED' }));
    processed('template_status', LATER);

    await processTemplateStatusRow(approved);

    const statuses = updateCalls
      .filter((c) => c.table === 'whatsapp_message_templates')
      .map((c) => c.payload.status);
    expect(statuses.at(-1)).toBe('DISABLED');
    expect(updateCalls.filter((c) => c.table === 'message_templates').at(-1)?.payload.meta_status).toBe('DISABLED');
  });

  it('a superseded event neither writes nor alerts, and the row still completes', async () => {
    processed('template_status', LATER);
    await expect(
      processTemplateStatusRow(event('template_status', EARLIER, { event: 'REJECTED' })),
    ).resolves.toBeUndefined();
    expect(updateCalls).toHaveLength(0);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('a retry with no newer event still applies', async () => {
    processed('template_status', '2026-11-05T07:59:00+00:00');
    await processTemplateStatusRow(approved);
    expect(updateCalls.find((c) => c.table === 'whatsapp_message_templates')?.payload.status).toBe('APPROVED');
  });

  it('another event kind, or another template, is not a newer event', async () => {
    processed('template_quality', LATER);
    processed('template_status', LATER, '999');
    await processTemplateStatusRow(approved);
    expect(updateCalls.find((c) => c.table === 'whatsapp_message_templates')?.payload.status).toBe('APPROVED');
  });

  it('a row with no event time has no order to compare, so it applies', async () => {
    processed('template_status', LATER);
    await processTemplateStatusRow(event('template_status', null, { event: 'APPROVED' }));
    expect(updateCalls.find((c) => c.table === 'whatsapp_message_templates')?.payload.status).toBe('APPROVED');
  });

  it('holds for the category, category-misuse and quality events too', async () => {
    processed('template_category', LATER);
    processed('template_category_misuse', LATER);
    processed('template_quality', LATER);
    await processTemplateCategoryRow(
      event('template_category', EARLIER, { previous_category: 'UTILITY', new_category: 'MARKETING' }),
    );
    await processTemplateCategoryMisuseRow(
      event('template_category_misuse', EARLIER, { category: 'UTILITY', correct_category: 'MARKETING' }),
    );
    await processTemplateQualityRow(event('template_quality', EARLIER, { new_quality_score: 'RED' }));
    expect(updateCalls).toHaveLength(0);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('a failed order lookup fails the row, so the worker retries it', async () => {
    inboxError = { code: 'XX000' };
    await expect(processTemplateStatusRow(approved)).rejects.toThrow();
    expect(updateCalls).toHaveLength(0);
  });
});

describe('processTemplateComponentsRow (message_template_components_update)', () => {
  // Meta's reference example, with an id our mirror knows.
  const edited = {
    message_template_id: 555,
    message_template_name: 'kalfa_invite',
    message_template_language: 'he',
    message_template_element: 'שלום {{1}}, {{2}}',
  };
  const body = (text: string) => [{ type: 'BODY', text }];

  it('refreshes the mirror from Meta before judging the template', async () => {
    mirrorResult = { data: null, error: null };
    await processTemplateComponentsRow(row(edited));
    expect(runTemplateHealthSync).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('stays quiet for a template no step sends', async () => {
    mirrorResult = {
      data: { components: body('שלום {{1}}'), message_template_routes: [], whatsapp_template_parameters: [] },
      error: null,
    };
    await processTemplateComponentsRow(row(edited));
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('reports an error naming the step when the edit added a variable with no value', async () => {
    mirrorResult = {
      data: {
        components: body('שלום {{1}}, {{2}}'),
        message_template_routes: [{ message_key: 'invite' }, { message_key: 'invite' }],
        whatsapp_template_parameters: [
          { type: 'body', sub_type: null, index: null, position: 1, source_path: 'guest.first_name' },
        ],
      },
      error: null,
    };
    await processTemplateComponentsRow(row(edited));
    const a = sendSlackAlert.mock.calls[0][0] as { level: string; title: string; detail: string };
    expect(a.level).toBe('error');
    expect(a.title).toContain('invite');
    expect(a.detail).toContain('חסר ערך ל-{{2}}');
  });

  it('ignores a payload without the template keys', async () => {
    await processTemplateComponentsRow(row({ message_template_name: 'x' }));
    expect(runTemplateHealthSync).not.toHaveBeenCalled();
  });
});
