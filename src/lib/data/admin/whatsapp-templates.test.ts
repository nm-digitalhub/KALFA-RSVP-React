import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { getWebJobSender } from '@/lib/queue/web-sender';
import { createAdminClient } from '@/lib/supabase/admin';

import {
  removeTemplateRoute,
  requestTemplateSync,
  saveTemplateParameters,
  setTemplateRoute,
} from './whatsapp-templates';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/queue/web-sender', () => ({ getWebJobSender: vi.fn() }));

// A fake admin client: each table answers its awaited queries in order, and
// every chain call is recorded so a test can assert what was written.
type Result = { data: unknown; error: null | { message: string } };
function fakeAdmin(answers: Record<string, Result[]>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'is', 'maybeSingle']) {
      builder[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return builder;
      };
    }
    builder.then = (resolve: (r: Result) => unknown) =>
      resolve(answers[table]?.shift() ?? { data: null, error: null });
    return builder;
  });
  vi.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);
  return calls;
}

const RSVP = { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY' }, { type: 'QUICK_REPLY' }, { type: 'QUICK_REPLY' }] };
const TEXT_INVITE = {
  id: '111',
  name: 'invite_v2',
  status: 'APPROVED',
  category: 'UTILITY',
  components: [{ type: 'BODY', text: 'שלום {{1}}' }, RSVP],
  whatsapp_template_parameters: [
    { id: 'p1', type: 'body', sub_type: null, index: null, position: 1, source_path: 'guest.greeting_name' },
  ],
};
const STEP = { data: { message_key: 'invite', channel: 'whatsapp' }, error: null };
const ROUTE = { messageKey: 'invite', eventType: null, withMedia: false, templateId: '111' } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setTemplateRoute', () => {
  it('checks the permission before reading anything', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(new Error('FORBIDDEN'));
    const calls = fakeAdmin({});
    await expect(setTemplateRoute(ROUTE)).rejects.toThrow('FORBIDDEN');
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
    expect(calls).toEqual([]);
  });

  it('refuses a template Meta has not approved, and writes nothing', async () => {
    const calls = fakeAdmin({
      message_templates: [STEP],
      whatsapp_message_templates: [{ data: { ...TEXT_INVITE, status: 'PENDING' }, error: null }],
    });
    const result = await setTemplateRoute(ROUTE);
    expect(result).toEqual({ ok: false, problems: ['אפשר לבחור רק תבנית שמאושרת ב-Meta'] });
    expect(calls.some((c) => c.method === 'insert' || c.method === 'update')).toBe(false);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('refuses a template whose variables are not all mapped', async () => {
    fakeAdmin({
      message_templates: [STEP],
      whatsapp_message_templates: [{ data: { ...TEXT_INVITE, whatsapp_template_parameters: [] }, error: null }],
    });
    expect(await setTemplateRoute(ROUTE)).toEqual({ ok: false, problems: ['חסר ערך ל-{{1}}'] });
  });

  it('refuses an image template on a text route', async () => {
    fakeAdmin({
      message_templates: [STEP],
      whatsapp_message_templates: [
        {
          data: {
            ...TEXT_INVITE,
            components: [{ type: 'HEADER', format: 'IMAGE' }, ...TEXT_INVITE.components],
            whatsapp_template_parameters: [
              ...TEXT_INVITE.whatsapp_template_parameters,
              { id: 'p2', type: 'header', sub_type: null, index: null, position: 1, source_path: 'event.invite_image' },
            ],
          },
          error: null,
        },
      ],
    });
    expect(await setTemplateRoute(ROUTE)).toEqual({
      ok: false,
      problems: ['תבנית עם תמונה בכותרת מתאימה רק למסלול עם תמונה'],
    });
  });

  it('switches the route, ensures the settings row, logs, and warns when RSVP buttons are lost', async () => {
    const calls = fakeAdmin({
      message_templates: [STEP],
      whatsapp_message_templates: [
        { data: { ...TEXT_INVITE, components: [{ type: 'BODY', text: 'שלום {{1}}' }] }, error: null },
      ],
      message_template_routes: [
        { data: { id: 'r1', whatsapp_template_id: '999', whatsapp_message_templates: { components: [RSVP] } }, error: null },
        { data: null, error: null },
      ],
      whatsapp_template_settings: [{ data: null, error: null }],
    });
    const result = await setTemplateRoute(ROUTE);
    expect(result).toEqual({
      ok: true,
      warning: 'לתבנית החדשה אין את שלושת כפתורי אישור ההגעה. לחיצה של אורח לא תירשם עוד כתשובה.',
    });
    expect(calls).toContainEqual({ table: 'message_template_routes', method: 'update', args: [{ whatsapp_template_id: '111' }] });
    expect(calls).toContainEqual({
      table: 'whatsapp_template_settings',
      method: 'upsert',
      args: [
        { whatsapp_template_id: '111', requested_category: 'UTILITY' },
        { onConflict: 'whatsapp_template_id', ignoreDuplicates: true },
      ],
    });
    expect(logActivity).toHaveBeenCalledWith({
      action: 'admin.templates.route_set',
      meta: {
        message_key: 'invite',
        event_type: null,
        with_media: false,
        from_template_id: '999',
        to_template_id: '111',
      },
    });
  });
});

describe('removeTemplateRoute', () => {
  it('never removes the default text route', async () => {
    const calls = fakeAdmin({});
    expect(await removeTemplateRoute({ messageKey: 'invite', eventType: null, withMedia: false })).toEqual({
      ok: false,
      problems: ['אי אפשר להסיר את מסלול ברירת המחדל של השלב'],
    });
    expect(calls).toEqual([]);
  });
});

describe('saveTemplateParameters', () => {
  it('only accepts values every step sending the template has', async () => {
    fakeAdmin({
      whatsapp_message_templates: [{ data: TEXT_INVITE, error: null }],
      message_template_routes: [{ data: [{ message_key: 'invite' }], error: null }],
    });
    const result = await saveTemplateParameters({
      templateId: '111',
      values: [{ type: 'body', sub_type: null, index: null, position: 1, source_path: 'lead.full_name' }],
    });
    expect(result).toEqual({ ok: false, problems: ['הערך של {{1}} לא קיים בשלב הזה'] });
  });

  it('saves the whole mapping in ONE upsert on the unique key and logs the change', async () => {
    const calls = fakeAdmin({
      whatsapp_message_templates: [{ data: TEXT_INVITE, error: null }],
      message_template_routes: [{ data: [{ message_key: 'invite' }], error: null }],
      whatsapp_template_parameters: [{ data: null, error: null }],
    });
    const result = await saveTemplateParameters({
      templateId: '111',
      values: [{ type: 'body', sub_type: null, index: null, position: 1, source_path: 'guest.first_name' }],
    });
    expect(result).toEqual({ ok: true });
    const writes = calls.filter((c) => c.table === 'whatsapp_template_parameters');
    expect(writes).toEqual([
      {
        table: 'whatsapp_template_parameters',
        method: 'upsert',
        args: [
          [{ whatsapp_template_id: '111', type: 'body', sub_type: null, index: null, position: 1, parameter_name: null, source_path: 'guest.first_name' }],
          { onConflict: 'whatsapp_template_id,type,index,position,parameter_name' },
        ],
      },
    ]);
    expect(logActivity).toHaveBeenCalledWith({
      action: 'admin.templates.parameters_set',
      meta: {
        whatsapp_template_id: '111',
        template_name: 'invite_v2',
        changed: [{ slot: 'body|||1', from: 'guest.greeting_name', to: 'guest.first_name' }],
        removed: [],
      },
    });
  });

  it('refuses two values for the same variable and writes nothing', async () => {
    const calls = fakeAdmin({
      whatsapp_message_templates: [{ data: TEXT_INVITE, error: null }],
      message_template_routes: [{ data: [{ message_key: 'invite' }], error: null }],
    });
    const result = await saveTemplateParameters({
      templateId: '111',
      values: [
        { type: 'body', sub_type: null, index: null, position: 1, source_path: 'guest.first_name' },
        { type: 'body', sub_type: null, index: null, position: 1, source_path: 'event.venue' },
      ],
    });
    expect(result).toEqual({ ok: false, problems: ['יש יותר מערך אחד ל-{{1}}'] });
    expect(calls.some((c) => c.table === 'whatsapp_template_parameters')).toBe(false);
  });

  it('a failed upsert throws and deletes nothing (the old mapping stays whole)', async () => {
    const calls = fakeAdmin({
      whatsapp_message_templates: [
        {
          data: {
            ...TEXT_INVITE,
            whatsapp_template_parameters: [
              ...TEXT_INVITE.whatsapp_template_parameters,
              { id: 'old', type: 'body', sub_type: null, index: null, position: 9, source_path: 'event.time' },
            ],
          },
          error: null,
        },
      ],
      message_template_routes: [{ data: [{ message_key: 'invite' }], error: null }],
      whatsapp_template_parameters: [{ data: null, error: { message: 'boom' } }],
    });
    await expect(
      saveTemplateParameters({
        templateId: '111',
        values: [{ type: 'body', sub_type: null, index: null, position: 1, source_path: 'guest.first_name' }],
      }),
    ).rejects.toThrow('שמירת המשתנים נכשלה');
    expect(calls.filter((c) => c.table === 'whatsapp_template_parameters').map((c) => c.method)).toEqual(['upsert']);
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe('requestTemplateSync', () => {
  it('queues the worker job instead of syncing in the request', async () => {
    const send = vi.fn();
    vi.mocked(getWebJobSender).mockResolvedValue({ send } as unknown as Awaited<ReturnType<typeof getWebJobSender>>);
    await requestTemplateSync();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
    expect(send).toHaveBeenCalledWith('whatsapp-template-health-sync', {});
  });
});
