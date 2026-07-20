import { describe, expect, it } from 'vitest';

import {
  agentStatusSchema,
  outboundCallSchema,
  attachModeSchema,
  agentCommandBodySchema,
  commandAckSchema,
} from './agent-console';

describe('agentStatusSchema', () => {
  it('accepts the three settable statuses', () => {
    for (const status of ['ready', 'not_ready', 'dnd']) {
      expect(agentStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });
  it('rejects in_call (system-managed, never client-set) and unknowns', () => {
    expect(agentStatusSchema.safeParse({ status: 'in_call' }).success).toBe(false);
    expect(agentStatusSchema.safeParse({ status: 'busy' }).success).toBe(false);
  });
  it('rejects extra fields (strict)', () => {
    expect(agentStatusSchema.safeParse({ status: 'ready', extra: 1 }).success).toBe(false);
  });
});

describe('outboundCallSchema', () => {
  it('accepts E.164 phone + uuid event', () => {
    expect(
      outboundCallSchema.safeParse({
        phone: '+972501234567',
        event_id: '00000000-0000-0000-0000-000000000000',
      }).success,
    ).toBe(true);
  });
  it('rejects a non-E.164 phone and a non-uuid event', () => {
    expect(
      outboundCallSchema.safeParse({ phone: '0501234567', event_id: '00000000-0000-0000-0000-000000000000' })
        .success,
    ).toBe(false);
    expect(outboundCallSchema.safeParse({ phone: '+972501234567', event_id: 'default-event' }).success).toBe(
      false,
    );
  });
});

describe('attachModeSchema', () => {
  it('accepts monitor/takeover only', () => {
    expect(attachModeSchema.safeParse({ mode: 'monitor' }).success).toBe(true);
    expect(attachModeSchema.safeParse({ mode: 'takeover' }).success).toBe(true);
    expect(attachModeSchema.safeParse({ mode: 'spy' }).success).toBe(false);
  });
});

describe('agentCommandBodySchema', () => {
  it('accepts a non-empty whisper', () => {
    expect(
      agentCommandBodySchema.safeParse({
        command: 'agent_context_update',
        payload: { text: 'האורח מתלבט' },
      }).success,
    ).toBe(true);
  });
  it('rejects an empty whisper', () => {
    expect(
      agentCommandBodySchema.safeParse({ command: 'agent_context_update', payload: { text: '  ' } }).success,
    ).toBe(false);
  });
  it('accepts payload-less commands with no payload key', () => {
    expect(agentCommandBodySchema.safeParse({ command: 'ai_clear_buffer' }).success).toBe(true);
    expect(agentCommandBodySchema.safeParse({ command: 'ai_close' }).success).toBe(true);
  });
  it('accepts call_end with or without a reason', () => {
    expect(agentCommandBodySchema.safeParse({ command: 'call_end' }).success).toBe(true);
    expect(
      agentCommandBodySchema.safeParse({ command: 'call_end', payload: { reason: 'agent_takeover' } }).success,
    ).toBe(true);
  });
  it('rejects an unknown command and smuggled payload fields', () => {
    expect(agentCommandBodySchema.safeParse({ command: 'ai_suspend' }).success).toBe(false);
    expect(
      agentCommandBodySchema.safeParse({ command: 'ai_clear_buffer', payload: { text: 'x' } }).success,
    ).toBe(false);
  });
});

describe('commandAckSchema', () => {
  it('accepts a truthful ack', () => {
    expect(
      commandAckSchema.safeParse({
        ok: true,
        request_id: 'req-1',
        command: 'agent_context_update',
        applied: true,
        call_attempt_id: 'att-1',
      }).success,
    ).toBe(true);
  });
  it('requires ok, request_id and applied', () => {
    expect(commandAckSchema.safeParse({ request_id: 'r', applied: true }).success).toBe(false);
    expect(commandAckSchema.safeParse({ ok: true, applied: true }).success).toBe(false);
    expect(commandAckSchema.safeParse({ ok: true, request_id: 'r' }).success).toBe(false);
  });
});
