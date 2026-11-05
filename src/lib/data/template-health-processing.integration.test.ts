import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn(async () => null) }));

import { processTemplateStatusRow } from './template-health-processing';

const RUN = process.env.OUTREACH_DB_IT === '1';

// The real query against the local stack: the unit test stubs the client, so only this
// proves the payload filter and the event_at comparison find the rows they should.
describe.skipIf(!RUN)('template events keep Meta order on retry (local database)', () => {
  const EARLIER = '2026-11-05T08:00:00+00:00';
  const LATER = '2026-11-05T08:00:30+00:00';
  const templateId = `it-${randomUUID()}`;
  const dedupePrefix = `it-template-order:${templateId}`;

  async function seedMirror(status: string) {
    const { error } = await createAdminClient()
      .from('whatsapp_message_templates')
      .insert({ id: templateId, name: `it_${templateId.slice(3, 11)}`, language: 'he', status });
    if (error) throw error;
  }

  async function inboxRow(eventAt: string, event: string, processedAt: string | null) {
    const { data, error } = await createAdminClient()
      .from('webhook_inbox')
      .insert({
        provider: 'whatsapp',
        event_kind: 'template_status',
        dedupe_key: `${dedupePrefix}:${eventAt}`,
        event_at: eventAt,
        processed_at: processedAt,
        payload: {
          event,
          message_template_id: templateId,
          message_template_name: 'it_template',
          message_template_language: 'he',
        },
      })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async function mirrorStatus() {
    const { data, error } = await createAdminClient()
      .from('whatsapp_message_templates')
      .select('status')
      .eq('id', templateId)
      .single();
    if (error) throw error;
    return data.status;
  }

  afterEach(async () => {
    const admin = createAdminClient();
    await admin.from('webhook_inbox').delete().like('dedupe_key', `${dedupePrefix}%`);
    await admin.from('whatsapp_message_templates').delete().eq('id', templateId);
  });

  it('an older approval retried after a processed disable leaves the template disabled', async () => {
    await seedMirror('DISABLED');
    await inboxRow(LATER, 'DISABLED', new Date().toISOString());
    const retried = await inboxRow(EARLIER, 'APPROVED', null);

    await processTemplateStatusRow(retried);

    expect(await mirrorStatus()).toBe('DISABLED');
  });

  it('a newer event still waiting in the queue does not block the older one', async () => {
    await seedMirror('PENDING');
    await inboxRow(LATER, 'DISABLED', null);
    const older = await inboxRow(EARLIER, 'APPROVED', null);

    await processTemplateStatusRow(older);

    expect(await mirrorStatus()).toBe('APPROVED');
  });
});
