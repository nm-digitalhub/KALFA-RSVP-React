import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The scenarios run only inside Voximplant, so they cannot be imported. The expression
// that builds error_reason is cut out of each CallEvents.Failed handler and evaluated
// here, so these cases exercise the code that ships rather than a copy of it.
const SCENARIOS = ['RSVPAgent', 'PurposeAgent', 'SalesCloseAgent', 'MeetingConfirmAgent'];
const CALLBACK_LIMIT = 256; // error_reason's max in src/lib/validation/voximplant.ts

function failureReasonOf(scenario: string): (ev: unknown) => string {
  const source = readFileSync(
    join(
      __dirname,
      `../../../voxfiles/applications/kalfa-rsvp.kalfarsvp.voximplant.com/scenarios/src/${scenario}.voxengine.js`,
    ),
    'utf8',
  );
  const handlers = source.split('CallEvents.Failed').slice(1);
  const handler = handlers.find((h) => /error_reason: 'sip_'/.test(h));
  const match = handler ? /error_reason: ('sip_'[^\n]*)\n/.exec(handler) : null;
  if (!match) throw new Error(`${scenario} no longer reports a SIP failure reason`);
  const evaluate = new Function('ev', 'code', `return ${match[1]};`);
  return (ev) => evaluate(ev, (ev as { code?: number } | undefined)?.code ?? 0) as string;
}

describe.each(SCENARIOS)('%s failure reason', (scenario) => {
  const reasonFor = failureReasonOf(scenario);

  it('keeps the carrier cause beside the SIP code', () => {
    expect(reasonFor({ code: 480, headers: { Reason: 'Q.850;cause=19' } })).toBe('sip_480:Q.850;cause=19');
  });

  it('reports only the code when the carrier sends no cause', () => {
    expect(reasonFor({ code: 408, headers: {} })).toBe('sip_408');
    expect(reasonFor({ code: 408 })).toBe('sip_408');
  });

  it('stays inside the callback limit, so a long header cannot reject the callback', () => {
    const reason = reasonFor({ code: 480, headers: { Reason: 'x'.repeat(1000) } });
    expect(reason.length).toBeLessThanOrEqual(CALLBACK_LIMIT);
  });
});
