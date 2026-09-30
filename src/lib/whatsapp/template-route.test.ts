import { describe, expect, it } from 'vitest';

import {
  bindTemplateParameters,
  carriesRsvpQuickReplies,
  pickTemplateRoute,
  type TemplateParameterRow,
  type TemplateRouteRow,
} from './template-route';

const r = (event_type: string | null, with_media: boolean, id: string): TemplateRouteRow => ({
  message_key: 'invite', event_type, with_media, whatsapp_template_id: id,
});
const ROUTES = [r(null, false, 'base'), r(null, true, 'base-img'), r('brit', false, 'brit'), r('brit', true, 'brit-img')];

describe('pickTemplateRoute', () => {
  it('most specific first: type+image → default+image → type → default', () => {
    expect(pickTemplateRoute(ROUTES, 'invite', 'brit', true)?.whatsapp_template_id).toBe('brit-img');
    expect(pickTemplateRoute(ROUTES, 'invite', 'wedding', true)?.whatsapp_template_id).toBe('base-img');
    expect(pickTemplateRoute(ROUTES, 'invite', 'brit', false)?.whatsapp_template_id).toBe('brit');
    expect(pickTemplateRoute(ROUTES, 'invite', 'wedding', false)?.whatsapp_template_id).toBe('base');
  });

  it('image routes are never used without an image; no route → null', () => {
    expect(pickTemplateRoute([r(null, true, 'img-only')], 'invite', null, false)).toBeNull();
    expect(pickTemplateRoute(ROUTES, 'gift', 'brit', true)).toBeNull();
  });
});

describe('carriesRsvpQuickReplies', () => {
  const qr = { type: 'QUICK_REPLY' };
  it('true only for exactly the RSVP quick replies and nothing else', () => {
    expect(carriesRsvpQuickReplies([{ type: 'BODY' }, { type: 'BUTTONS', buttons: [qr, qr, qr] }])).toBe(true);
    expect(carriesRsvpQuickReplies([{ type: 'BUTTONS', buttons: [qr, qr] }])).toBe(false);
    expect(carriesRsvpQuickReplies([{ type: 'BUTTONS', buttons: [qr, qr, { type: 'URL' }] }])).toBe(false);
    expect(carriesRsvpQuickReplies([{ type: 'BODY' }])).toBe(false);
    expect(carriesRsvpQuickReplies(null)).toBe(false);
  });
});

describe('bindTemplateParameters', () => {
  const row = (type: string, position: number, source_path: string, sub_type: string | null = null): TemplateParameterRow => ({
    whatsapp_template_id: 't', type, sub_type, index: type === 'button' ? 0 : null, position, parameter_name: null, source_path,
  });
  const values: Record<string, string | null> = { a: 'A', b: 'B', img: 'x.jpg', tok: 'T', gone: null };
  const read = (p: string) => values[p] ?? null;

  it('orders body by position and carries header + URL button', () => {
    expect(
      bindTemplateParameters(
        [row('body', 2, 'b'), row('button', 1, 'tok', 'url'), row('body', 1, 'a'), row('header', 1, 'img')],
        read,
      ),
    ).toEqual({ body: ['A', 'B'], headerImagePath: 'x.jpg', urlButtonParam: 'T' });
  });

  it('fails closed with each missing path once', () => {
    expect(bindTemplateParameters([row('body', 1, 'gone'), row('body', 2, 'gone'), row('body', 3, 'a')], read)).toEqual({
      missing: ['gone'],
    });
  });
});
