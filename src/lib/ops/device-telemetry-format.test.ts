import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderTelemetryLine } from './device-telemetry-format';
import {
  DEVICE_TELEMETRY_MAX_EVENTS,
  deviceTelemetryBatchSchema,
  deviceTelemetryEventSchema,
  looksLikePersonalData,
} from '@/lib/validation/agent-console';

// The PII guard is the piece that must be tested rather than reviewed: it is the
// last thing between a guest's phone number and a log file AGENTS.md assumes is
// read by someone who should not see customer data. Every case below is a value
// that can actually reach it from the app's call path, not an invented one.

const AGENT = '3f2a1b7c-9d4e-4a1b-8c2d-5e6f7a8b9c0d';

function event(overrides: Record<string, unknown> = {}) {
  return {
    at: '2026-08-15T04:12:33.412Z',
    sid: 'c7f3a91b',
    seq: 42,
    name: 'fcm.message_received',
    fields: { vox: 'true', keys: '3' },
    ...overrides,
  };
}

describe('looksLikePersonalData', () => {
  it('rejects an Israeli mobile number in every shape the app could produce', () => {
    for (const v of ['+972501234567', '0501234567', '050-123-4567', '(050) 123 4567']) {
      expect(looksLikePersonalData(v)).toBe(true);
    }
  });

  it('rejects a number whose spaces were already flattened to underscores', () => {
    // The app replaces whitespace with `_` before sending. If its own scrub ever
    // regressed to running AFTER that flattening — which it did, and a test
    // caught — the value would arrive in this shape. Second line of defence.
    expect(looksLikePersonalData('(050)_123_4567')).toBe(true);
    expect(looksLikePersonalData('050_123_4567')).toBe(true);
  });

  it('rejects a Supabase JWT', () => {
    expect(looksLikePersonalData('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def')).toBe(true);
  });

  it('rejects an FCM registration token', () => {
    // Shape, not a real token: a long unbroken run of token characters.
    expect(looksLikePersonalData(`d${'A9_x-'.repeat(12)}`)).toBe(true);
  });

  it('rejects an email and a Voximplant full username', () => {
    expect(looksLikePersonalData('agent@example.com')).toBe(true);
    expect(looksLikePersonalData('agent1@kalfa-rsvp.kalfarsvp.voximplant.com')).toBe(true);
  });

  it('ALLOWS the non-identifying values the diagnostic actually depends on', () => {
    // If any of these were rejected the log would lose the fields that make it
    // readable — a false positive here is a silently useless diagnostic.
    for (const v of ['true', 'false', 'RINGING', 'fcm_token', 'vox_register', '3', '9012', 'p1a2b3c4']) {
      expect(looksLikePersonalData(v)).toBe(false);
    }
  });

  it('ALLOWS a Voximplant call id, which carries a long digit run but is not phone-shaped', () => {
    expect(looksLikePersonalData('7666179052-a1f')).toBe(false);
  });

  it('ALLOWS a long millisecond duration, which is bare digits but too short to be a number', () => {
    // `ms=1234567` is a legitimate 20-minute session. The 9-digit threshold for
    // bare digits exists exactly so this is not redacted.
    expect(looksLikePersonalData('1234567')).toBe(false);
    expect(looksLikePersonalData('45000')).toBe(false);
  });
});

describe('deviceTelemetryEventSchema', () => {
  it('accepts a well-formed event', () => {
    expect(deviceTelemetryEventSchema.safeParse(event()).success).toBe(true);
  });

  it('accepts an event with no fields at all', () => {
    const { fields: _drop, ...rest } = event();
    expect(deviceTelemetryEventSchema.safeParse(rest).success).toBe(true);
  });

  it('rejects a field value that looks like personal data', () => {
    expect(
      deviceTelemetryEventSchema.safeParse(event({ fields: { num: '+972501234567' } })).success,
    ).toBe(false);
  });

  it('rejects extra top-level fields (strict)', () => {
    expect(deviceTelemetryEventSchema.safeParse(event({ extra: 1 })).success).toBe(false);
  });

  it('rejects a malformed event name, session id, or timestamp', () => {
    expect(deviceTelemetryEventSchema.safeParse(event({ name: 'Fcm.Message' })).success).toBe(false);
    expect(deviceTelemetryEventSchema.safeParse(event({ sid: 'x7f3a91b' })).success).toBe(false);
    expect(deviceTelemetryEventSchema.safeParse(event({ at: '2026-08-15 04:12:33' })).success).toBe(
      false,
    );
  });

  it('rejects more than eight fields on one event', () => {
    const fields = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`k${i}`, String(i)]),
    );
    expect(deviceTelemetryEventSchema.safeParse(event({ fields })).success).toBe(false);
  });
});

describe('deviceTelemetryBatchSchema', () => {
  it('accepts a batch at the cap and rejects one over it', () => {
    const at = Array.from({ length: DEVICE_TELEMETRY_MAX_EVENTS }, () => event());
    expect(deviceTelemetryBatchSchema.safeParse({ events: at }).success).toBe(true);
    expect(deviceTelemetryBatchSchema.safeParse({ events: [...at, event()] }).success).toBe(false);
  });

  it('rejects an empty batch', () => {
    expect(deviceTelemetryBatchSchema.safeParse({ events: [] }).success).toBe(false);
  });
});

describe('renderTelemetryLine', () => {
  // The format IS the deliverable — it is what the owner reads over SSH — so it
  // is pinned rather than left to drift.
  it('renders the documented shape, with server facts appended not prepended', () => {
    const line = renderTelemetryLine(
      deviceTelemetryEventSchema.parse(event()),
      AGENT,
      '2026-08-15T04:12:34.102Z',
    );
    expect(line).toBe(
      '2026-08-15T04:12:33.412Z sid=c7f3a91b seq=42 fcm.message_received vox=true keys=3 ' +
        'rx=2026-08-15T04:12:34.102Z ag=3f2a1b7c',
    );
  });

  it('renders an event with no fields without a double space', () => {
    const { fields: _drop, ...rest } = event();
    const line = renderTelemetryLine(
      deviceTelemetryEventSchema.parse(rest),
      AGENT,
      '2026-08-15T04:12:34.102Z',
    );
    expect(line).not.toContain('  ');
  });

  it('never emits a newline, so one event can never become two log lines', () => {
    const line = renderTelemetryLine(
      deviceTelemetryEventSchema.parse(event()),
      AGENT,
      '2026-08-15T04:12:34.102Z',
    );
    expect(line).not.toContain('\n');
  });
});

describe('isDeviceTelemetryEnabled', () => {
  const original = process.env.DEVICE_TELEMETRY_ENABLED;

  beforeEach(() => {
    delete process.env.DEVICE_TELEMETRY_ENABLED;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.DEVICE_TELEMETRY_ENABLED;
    else process.env.DEVICE_TELEMETRY_ENABLED = original;
  });

  it('is OFF unless explicitly switched on', async () => {
    const { isDeviceTelemetryEnabled } = await import('./device-telemetry-format');
    expect(isDeviceTelemetryEnabled()).toBe(false);
    process.env.DEVICE_TELEMETRY_ENABLED = '0';
    expect(isDeviceTelemetryEnabled()).toBe(false);
    process.env.DEVICE_TELEMETRY_ENABLED = 'yes';
    expect(isDeviceTelemetryEnabled()).toBe(false);
  });

  it('accepts 1 and true', async () => {
    const { isDeviceTelemetryEnabled } = await import('./device-telemetry-format');
    process.env.DEVICE_TELEMETRY_ENABLED = '1';
    expect(isDeviceTelemetryEnabled()).toBe(true);
    process.env.DEVICE_TELEMETRY_ENABLED = 'true';
    expect(isDeviceTelemetryEnabled()).toBe(true);
  });
});
