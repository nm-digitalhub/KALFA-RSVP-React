import { describe, expect, it } from 'vitest';

import {
  buildBritTradInviteParams,
  buildBritTradReminderParams,
  buildBritTradThankyouParams,
  buildEventDayReminderParams,
  buildGiftParams,
  buildSendContext,
  buildTemplateParams,
  buildThankyouParams,
  PARAM_CONTRACT_PATHS,
  resolveParams,
  type SendContextInput,
} from './template-spec';

// Step-4/6 gate (docs/superpowers/plans/2026-09-30-whatsapp-templates-meta-mirror.md):
// every approved layout expressed as DATA (PARAM_CONTRACT_PATHS over one send
// context) must bind exactly what the code builders bind — the same values in
// the same order, and the same missing keys when an ingredient is absent —
// across every event type and every missing-ingredient case.

const EVENT_TYPES = [
  'wedding', 'bar_mitzvah', 'bat_mitzvah', 'brit', 'britah', 'henna', 'engagement', 'birthday', 'other',
] as const;

const CELEBRANTS: unknown[] = [
  { groom: 'דוד לוי', bride: 'שרה כהן' },
  { groom: 'דוד לוי' },
  { name: 'איתי לוי' },
  { names: 'משפחת אברהם והחברים' },
  { parents: 'רון ומיכל כהן', child: 'אריאל', host_composition: 'couple' },
  { parents: 'רינה כהן', host_composition: 'single_mother' },
  { parents: 'יוסי כהן', host_composition: 'single_father' },
  { parents: 'רון כהן', host_composition: 'bogus' },
  { host_composition: 'couple' },
  null,
  'דוד ושרה',
];

const DATES = ['2026-07-20T18:00:00+00:00', '2026-12-31T22:30:00+00:00', null, 'not-a-date'];
const VENUES: Array<[string | null, string | null]> = [
  ['אולמי הגן', 'דרך השלום 10, תל אביב'],
  ['אולמי הגן', null],
  [null, 'דרך השלום 10'],
  ['  ', null],
];
const GIFT_URLS = ['https://pay.example/x', 'http://insecure.example', null, '  '];
const GUESTS = ['דנה', null, '  '];

function* inputs(): Generator<SendContextInput> {
  for (const event_type of EVENT_TYPES)
    for (const celebrants of CELEBRANTS)
      for (const event_date of DATES)
        for (const [venue_name, venue_address] of VENUES)
          for (const guestFirstName of GUESTS)
            yield {
              event: {
                event_type,
                celebrants: celebrants as SendContextInput['event']['celebrants'],
                event_date,
                venue_name,
                venue_address,
                gift_payment_url: GIFT_URLS[(event_type.length + (event_date?.length ?? 0)) % GIFT_URLS.length],
              },
              guestFirstName,
            };
}

function templateCtx(i: SendContextInput) {
  return {
    event: {
      name: 'x',
      event_type: i.event.event_type,
      event_date: i.event.event_date ?? null,
      venue_name: i.event.venue_name ?? null,
      venue_address: i.event.venue_address ?? null,
      celebrants: i.event.celebrants,
    },
    guestFirstName: i.guestFirstName,
  } as Parameters<typeof buildTemplateParams>[1];
}

describe('send context + contract paths ≡ code builders', () => {
  const all = [...inputs()];

  it('covers a real matrix', () => {
    expect(all.length).toBeGreaterThan(1000);
  });

  it.each([
    ['generic', (i: SendContextInput) => buildTemplateParams('generic', templateCtx(i))],
    ['wedding', (i: SendContextInput) => buildTemplateParams('wedding', templateCtx(i))],
    ['thankyou', (i: SendContextInput) => buildThankyouParams(templateCtx(i))],
    ['event_day_pay', (i: SendContextInput) => buildEventDayReminderParams(templateCtx(i))],
    ['brit_trad_invite', (i: SendContextInput) => buildBritTradInviteParams(templateCtx(i))],
    ['brit_trad_reminder', (i: SendContextInput) => buildBritTradReminderParams(templateCtx(i))],
    ['brit_trad_thankyou', (i: SendContextInput) => buildBritTradThankyouParams(templateCtx(i))],
    [
      'gift',
      (i: SendContextInput) =>
        buildGiftParams({
          event: {
            event_type: i.event.event_type,
            celebrants: i.event.celebrants,
            gift_payment_url: i.event.gift_payment_url ?? null,
          },
          guestFirstName: i.guestFirstName,
        }),
    ],
  ] as const)('%s', (contract, builder) => {
    for (const input of all) {
      const fromData = resolveParams(PARAM_CONTRACT_PATHS[contract], buildSendContext(input));
      expect(fromData).toEqual(builder(input));
    }
  });
});
