import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Does the DEPLOYED scenario recognise a WhatsApp call?
//
// ⚠️ THIS READS THE SHIPPED FILE AND RUNS ITS OWN FUNCTION. `channelOf` lives in
// `voxfiles/scenarios/src/ConsoleInbound.voxengine.js`, which is uploaded to
// Voximplant verbatim and is not part of the app's module graph — so nothing in
// this suite would otherwise notice if the classification broke. Fault injection
// on 2026-09-14 deleted its first branch and every gate stayed green.
//
// ⚠️ AND THE FIXTURE IS A REAL CALL, not an invention. Every field below is
// copied from session 8429761454's own CallAlerting log — a WhatsApp call placed
// to +972 3-721-9347 that connected for 15 seconds.

const SCENARIO = join(
  process.cwd(),
  'voxfiles/scenarios/src/ConsoleInbound.voxengine.js',
);

/** The scenario's own `channelOf`, lifted out of the file that gets uploaded. */
function loadChannelOf(): (e: unknown) => string {
  const src = readFileSync(SCENARIO, 'utf8');
  const start = src.indexOf('function channelOf(');
  expect(start, 'channelOf not found in the scenario').toBeGreaterThan(-1);

  // Balance braces from the function's opening `{` so the extraction cannot
  // silently take half of it.
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  expect(depth, 'unbalanced braces around channelOf').toBe(0);

  return new Function(`${src.slice(start, end)}; return channelOf;`)() as (e: unknown) => string;
}

// Verbatim from the log of session 8429761454, 2026-09-14 10:10:23 UTC.
const REAL_WHATSAPP_EVENT = {
  callerid: '972536212562',
  destination: '+97237219347',
  displayName: 'KALFA Netanel Mevorach',
  fromURI: 'sip:+972536212562@wa.meta.vc',
  toURI: 'sip:+97237219347;vox_call_type=wab;user_id=10694307;node_name=n2@sip.voximplant.com',
  headers: {
    'VI-Client-Device': 'SIP',
    'VI-Client-IP': '173.252.82.20',
    'VI-Client-Type': 'wab',
    'X-FB-External-Domain': 'wa.meta.vc',
    'x-wa-meta-country-code': 'IL',
    'x-wa-meta-phone-number-id': '1018741517998430',
  },
};

describe('ConsoleInbound.channelOf', () => {
  const channelOf = loadChannelOf();

  it('⚠️ recognises the REAL WhatsApp call that reached production', () => {
    expect(channelOf(REAL_WHATSAPP_EVENT)).toBe('whatsapp');
  });

  it('⚠️ recognises it from ANY ONE marker alone', () => {
    // Four independent signals were present. Each is checked on its own, so a
    // change on either Voximplant's side or Meta's does not silently turn a
    // WhatsApp call back into a phone call.
    const markers = [
      { headers: { 'VI-Client-Type': 'wab' } },
      { headers: { 'X-FB-External-Domain': 'wa.meta.vc' } },
      { fromURI: 'sip:+972536212562@wa.meta.vc' },
      { toURI: 'sip:+97237219347;vox_call_type=wab;user_id=10694307@sip.voximplant.com' },
    ];
    for (const m of markers) expect(channelOf(m), JSON.stringify(m)).toBe('whatsapp');
  });

  it('⚠️ an ordinary phone call stays "pstn" — the pre-existing behaviour', () => {
    expect(
      channelOf({
        callerid: '972501234567',
        destination: '+97237219347',
        fromURI: 'sip:+972501234567@sip.voximplant.com',
        toURI: 'sip:+97237219347@sip.voximplant.com',
        headers: { 'VI-Client-Type': 'SIP' },
      }),
    ).toBe('pstn');
  });

  it('⚠️ fails towards "pstn" on a shape it cannot read', () => {
    // An unrecognised call must behave exactly as it did before this function
    // existed: the label loses a word, and nothing about routing, consent or
    // answering changes.
    for (const e of [{}, { headers: {} }, { headers: null }, { fromURI: null, toURI: undefined }]) {
      expect(channelOf(e), JSON.stringify(e)).toBe('pstn');
    }
  });

  it('⚠️ and actually SENDS it to the gate', () => {
    // Classifying correctly and not sending the result is a silent no-op: the
    // agent sees the old label and nothing indicates why. Fault injection proved
    // the gap — deleting the field from `postData` left every other test green.
    //
    // Asserted as text because this is the exact body the scenario ships;
    // `routeInboundBodySchema` is a `strictObject`, so the two must agree or
    // every inbound call is a 400 and a SIP 603.
    const src = readFileSync(SCENARIO, 'utf8');
    expect(src).toContain('channel: channel');
    expect(src).toMatch(/postData: safeStringify\(\{[^}]*channel: channel/);
  });
});
