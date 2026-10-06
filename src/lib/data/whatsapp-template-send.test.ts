import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let plan: unknown = null;
let twin: unknown = null;
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        maybeSingle: async () => ({ data: table === 'message_templates' ? plan : twin, error: null }),
      };
      return chain;
    },
  }),
}));
const sendSlackAlert = vi.fn();
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: (...a: unknown[]) => sendSlackAlert(...a) }));
vi.mock('@/lib/storage/event-media', () => ({ signedInviteImageUrl: vi.fn(async () => 'https://signed/img') }));

import { resolveWhatsAppSend } from './whatsapp-template-send';

const QR = { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY' }, { type: 'QUICK_REPLY' }, { type: 'QUICK_REPLY' }] };
function tpl(id: string, status: string, params: Array<[string, number, string]>, components: unknown[] = [QR]) {
  return {
    id, name: `n_${id}`, language: 'he', status, components,
    whatsapp_template_parameters: params.map(([type, position, source_path]) => ({
      whatsapp_template_id: id, type, sub_type: type === 'button' ? 'url' : null,
      index: type === 'button' ? 0 : null, position, parameter_name: null, source_path,
    })),
  };
}
function route(event_type: string | null, with_media: boolean, t: ReturnType<typeof tpl>) {
  return { message_key: 'invite', event_type, with_media, whatsapp_template_id: t.id, whatsapp_message_templates: t };
}
const EVENT = {
  event_type: 'brit' as const,
  celebrants: { parents: 'רון כהן', host_composition: 'couple' },
  event_date: '2026-07-20T18:00:00+00:00',
  venue_name: 'אולם',
  venue_address: null,
};
const TEXT = tpl('text', 'APPROVED', [['body', 1, 'event.venue'], ['body', 2, 'event.time']]);
const IMG = tpl('img', 'APPROVED', [['body', 1, 'event.venue'], ['header', 1, 'event.invite_image']]);

beforeEach(() => {
  vi.clearAllMocks();
  twin = null;
  plan = { channel: 'whatsapp', message_template_routes: [route(null, false, TEXT), route(null, true, IMG)] };
});

describe('resolveWhatsAppSend', () => {
  it('binds the text template by position, with RSVP quick replies read from Meta', async () => {
    const r = await resolveWhatsAppSend({ messageKey: 'invite', eventType: 'brit', values: { event: EVENT } });
    expect(r).toEqual({
      kind: 'ok', templateId: 'text',
      template: { name: 'n_text', language: 'he', channel: 'whatsapp', rsvpQuickReply: true },
      bodyParams: ['אולם', '21:00'], extras: {},
    });
  });

  it('uses the image template with the signed link when the event has an image', async () => {
    const r = await resolveWhatsAppSend({
      messageKey: 'invite', eventType: 'brit', inviteImagePath: 'p.jpg', values: { event: EVENT },
    });
    expect(r).toMatchObject({ kind: 'ok', templateId: 'img', extras: { headerImage: { link: 'https://signed/img' } } });
  });

  it('a signing failure falls back to the text template (a picture never blocks a send)', async () => {
    const r = await resolveWhatsAppSend({
      messageKey: 'invite', eventType: 'brit', inviteImagePath: 'p.jpg', values: { event: EVENT },
      signImage: async () => { throw new Error('storage down'); },
    });
    expect(r).toMatchObject({ kind: 'ok', templateId: 'text' });
  });

  it('a non-WhatsApp step is channel_mismatch; an unknown step is template_missing', async () => {
    plan = { channel: 'call', message_template_routes: [] };
    expect(await resolveWhatsAppSend({ messageKey: 'invite', eventType: null, values: {} })).toEqual({ kind: 'channel_mismatch' });
    plan = null;
    expect(await resolveWhatsAppSend({ messageKey: 'invite', eventType: null, values: {} })).toEqual({ kind: 'template_missing' });
  });

  it('an unapproved template is not sent and alerts', async () => {
    plan = { channel: 'whatsapp', message_template_routes: [route(null, false, tpl('p', 'PAUSED', []))] };
    expect(await resolveWhatsAppSend({ messageKey: 'invite', eventType: null, values: {} })).toEqual({ kind: 'template_missing' });
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ source: 'whatsapp-template-send' }));
  });

  it('a template deleted in Meta falls back to its live twin (same name + language) and alerts', async () => {
    plan = { channel: 'whatsapp', message_template_routes: [route(null, false, tpl('old', 'DELETED', []))] };
    twin = tpl('new', 'APPROVED', [['body', 1, 'event.venue']]);
    const r = await resolveWhatsAppSend({ messageKey: 'invite', eventType: 'brit', values: { event: EVENT } });
    expect(r).toMatchObject({ kind: 'ok', templateId: 'new', bodyParams: ['אולם'] });
    expect(sendSlackAlert).toHaveBeenCalled();
  });

  it('a mapping to a value that does not exist is params_incomplete and alerts', async () => {
    plan = { channel: 'whatsapp', message_template_routes: [route(null, false, tpl('x', 'APPROVED', [['body', 1, 'event.no_such']]))] };
    const r = await resolveWhatsAppSend({ messageKey: 'invite', eventType: 'brit', values: { event: EVENT } });
    expect(r).toEqual({ kind: 'params_incomplete', missing: ['event.no_such'] });
    expect(sendSlackAlert).toHaveBeenCalled();
  });

  it('missing event data is params_incomplete (fail-closed, no alert)', async () => {
    const r = await resolveWhatsAppSend({
      messageKey: 'invite', eventType: 'brit', values: { event: { ...EVENT, venue_name: null } },
    });
    expect(r).toEqual({ kind: 'params_incomplete', missing: ['event.venue'] });
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});
