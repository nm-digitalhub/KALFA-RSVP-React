import { describe, expect, it } from 'vitest';

import {
  bindTemplateParameters,
  buildEventValues,
  carriesRsvpQuickReplies,
  parameterCoverageProblems,
  pickTemplateRoute,
  readSendValue,
  sendValuePaths,
  templateSlots,
  type TemplateParameterRow,
  type TemplateRouteRow,
} from './template-route';
import { buildSendContext } from './template-spec';

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

describe('sendValuePaths', () => {
  it('event steps get the send context plus the invite image; no lead values', () => {
    const paths = sendValuePaths('invite');
    expect(paths).toContain('guest.greeting_name');
    expect(paths).toContain('event.venue');
    expect(paths).toContain('brit.closing');
    expect(paths).toContain('event.invite_image');
    expect(paths.some((p) => p.startsWith('lead.'))).toBe(false);
  });

  it('lead steps get only the lead values', () => {
    expect(sendValuePaths('sales_signup_link').sort()).toEqual(['lead.full_name', 'lead.signup_ref']);
  });

  it('every listed path is readable from the values the sender builds', () => {
    const groups = buildEventValues(
      buildSendContext({ event: { event_type: 'wedding', celebrants: null }, guestFirstName: 'דנה' }),
      'https://x/img.jpg',
    );
    for (const p of sendValuePaths('invite')) expect(readSendValue(groups, p)).not.toBeUndefined();
    expect(readSendValue(groups, 'event.nope')).toBeUndefined();
    expect(readSendValue(groups, 'lead.full_name')).toBeUndefined();
    expect(readSendValue(groups, 'event.invite_image')).toBe('https://x/img.jpg');
  });
});

describe('templateSlots / parameterCoverageProblems', () => {
  const components = [
    { type: 'HEADER', format: 'IMAGE' },
    { type: 'BODY', text: 'שלום {{1}}, ב-{{2}} ושוב {{1}}' },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY' }, { type: 'URL', url: 'https://k/g/{{1}}' }] },
  ];
  const allowed = sendValuePaths('invite');
  const row = (type: string, position: number, source_path: string, sub_type: string | null = null, index: number | null = null) =>
    ({ type, sub_type, index, position, source_path });
  const full = [
    row('header', 1, 'event.invite_image'),
    row('body', 1, 'guest.greeting_name'),
    row('body', 2, 'event.venue'),
    row('button', 1, 'event.gift_link_token', 'url', 1),
  ];

  it('reads the image header, distinct body variables and the URL button index', () => {
    expect(templateSlots(components)).toEqual({
      slots: [
        { type: 'header', sub_type: null, index: null, position: 1 },
        { type: 'body', sub_type: null, index: null, position: 1 },
        { type: 'body', sub_type: null, index: null, position: 2 },
        { type: 'button', sub_type: 'url', index: 1, position: 1 },
      ],
      unsupported: [],
    });
  });

  it('a mapping that covers every variable with known values has no problems', () => {
    expect(parameterCoverageProblems(components, full, allowed)).toEqual([]);
  });

  it('reports a missing variable, an unknown value, an extra row and a wrong header value', () => {
    expect(parameterCoverageProblems(components, full.slice(0, 3), allowed)).toEqual(['חסר ערך ל-סיומת הקישור בכפתור']);
    expect(parameterCoverageProblems(components, [...full.slice(0, 2), row('body', 2, 'lead.full_name'), full[3]], allowed))
      .toEqual(['הערך של {{2}} לא קיים בשלב הזה']);
    expect(parameterCoverageProblems(components, [...full, row('body', 3, 'event.time')], allowed))
      .toEqual(['יש ערכים למשתנים שלא קיימים בתבנית']);
    expect(parameterCoverageProblems(components, [row('header', 1, 'event.venue'), ...full.slice(1)], allowed))
      .toEqual(['תמונת הכותרת חייבת להיות תמונת ההזמנה']);
  });

  it('refuses two values for the same variable (not silently merged)', () => {
    expect(parameterCoverageProblems(components, [...full, row('body', 2, 'event.time')], allowed)).toEqual([
      'יש יותר מערך אחד ל-{{2}}',
    ]);
  });

  it('reports what the sender cannot fill instead of guessing', () => {
    const odd = [
      { type: 'HEADER', format: 'TEXT', text: 'היי {{1}}' },
      { type: 'BODY', text: 'שלום {{name}}' },
      { type: 'BUTTONS', buttons: [{ type: 'FLOW' }] },
    ];
    expect(templateSlots(odd).unsupported).toEqual(['משתנה בכותרת טקסט', 'משתנה בשם {{name}}', 'כפתור מסוג FLOW']);
  });
});
