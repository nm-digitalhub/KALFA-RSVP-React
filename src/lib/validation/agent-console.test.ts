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

describe('agentCommandBodySchema — matches the deployed app wire format', () => {
  it('accepts the exact FLAT payloads the app sends (ConsoleViewModel.kt:268-281)', () => {
    expect(agentCommandBodySchema.safeParse({ command: 'contextual_update', text: 'האורח מתלבט' }).success).toBe(
      true,
    );
    expect(agentCommandBodySchema.safeParse({ command: 'user_message', text: 'שלום' }).success).toBe(true);
    expect(agentCommandBodySchema.safeParse({ command: 'clear_buffer' }).success).toBe(true);
    expect(agentCommandBodySchema.safeParse({ command: 'close_agent' }).success).toBe(true);
  });
  it('rejects the NESTED shape and the old envelope names (regression for the bug this fixes)', () => {
    expect(
      agentCommandBodySchema.safeParse({ command: 'contextual_update', payload: { text: 'x' } }).success,
    ).toBe(false); // nested
    expect(agentCommandBodySchema.safeParse({ command: 'agent_context_update', text: 'x' }).success).toBe(
      false,
    ); // old name
    expect(agentCommandBodySchema.safeParse({ command: 'ai_close' }).success).toBe(false);
  });
  it('rejects empty text and smuggled fields', () => {
    expect(agentCommandBodySchema.safeParse({ command: 'contextual_update', text: '  ' }).success).toBe(false);
    expect(agentCommandBodySchema.safeParse({ command: 'user_message', text: '' }).success).toBe(false);
    expect(agentCommandBodySchema.safeParse({ command: 'clear_buffer', text: 'x' }).success).toBe(false);
  });
  it('rejects call_end here — ending the call is a separate /end route', () => {
    expect(agentCommandBodySchema.safeParse({ command: 'call_end' }).success).toBe(false);
  });
});

describe('commandAckSchema', () => {
  it('accepts a truthful ack', () => {
    expect(
      commandAckSchema.safeParse({
        ok: true,
        request_id: 'req-1',
        command: 'contextual_update',
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
