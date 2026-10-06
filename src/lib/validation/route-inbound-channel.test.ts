import { describe, expect, it } from 'vitest';

import { routeInboundBodySchema } from './console-calls';

// ⚠️ THIS IS A `strictObject`, AND THAT DECIDES THE DEPLOYMENT ORDER.
//
// An unknown key is a parse failure, a parse failure is a 400, and a 400 is
// `rejectFailClosed` in ConsoleInbound — every inbound call dropped with SIP
// 603. So the SERVER must accept `channel` BEFORE the scenario starts sending
// it. Optional is what makes both edges of that window safe: a new server with
// the old scenario parses, and a rollback of either side parses too.
//
// That failure is not hypothetical here. On 2026-09-14 every inbound call was
// already being rejected 603 for a different reason (a missing application
// secret), and it took a real WhatsApp call plus its session log to find.

const base = { secret: 'a'.repeat(64), cli: '972536212562', called: '97237219347' };

describe('routeInboundBodySchema — the channel field', () => {
  it('⚠️ parses WITHOUT channel — an older deployed scenario sends none', () => {
    const r = routeInboundBodySchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.channel).toBeUndefined();
  });

  it('accepts the two channels the scenario can classify', () => {
    for (const channel of ['pstn', 'whatsapp'] as const) {
      const r = routeInboundBodySchema.safeParse({ ...base, channel });
      expect(r.success, channel).toBe(true);
    }
  });

  it('⚠️ refuses a channel nobody defined, rather than passing it through', () => {
    // The value reaches an agent's screen. A closed set means a scenario bug
    // shows up here and not as a stray word on a ringing device.
    for (const channel of ['sms', 'WhatsApp', '', 'whatsapp ', 1, null]) {
      expect(routeInboundBodySchema.safeParse({ ...base, channel }).success, String(channel)).toBe(
        false,
      );
    }
  });

  it('⚠️ still refuses a key nobody declared — strictness is the point', () => {
    // Pinned so the field above is never "fixed" by loosening the object: the
    // strictness is what makes a scenario/server mismatch loud instead of
    // silently ignored.
    expect(routeInboundBodySchema.safeParse({ ...base, chanel: 'whatsapp' }).success).toBe(false);
  });
});
