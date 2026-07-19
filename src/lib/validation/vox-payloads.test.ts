import { describe, expect, it } from 'vitest';

import {
  extractIpStrings,
  maskIp,
  normalizeAccountCallbackEnvelope,
  normalizeAccountInfo,
  normalizeAuditEntry,
  normalizeCallList,
  normalizeCallListTask,
  normalizeSessionLogPointer,
  payloadMeta,
} from './vox-payloads';

// Every normalizer: valid / partial / garbage / empty (plan §4).

describe('payloadMeta (metadata-only view of content fields)', () => {
  it('reports presence + byte size without exposing content', () => {
    const meta = payloadMeta('{"phone":"+972501234567"}');
    expect(meta.present).toBe(true);
    expect(meta.bytes).toBe(25);
    expect(JSON.stringify(meta)).not.toContain('0501234567');
  });
  it('treats null/undefined/empty as absent', () => {
    expect(payloadMeta(null)).toEqual({ present: false, bytes: 0 });
    expect(payloadMeta(undefined)).toEqual({ present: false, bytes: 0 });
    expect(payloadMeta('')).toEqual({ present: false, bytes: 0 });
  });
  it('measures objects via their JSON size', () => {
    expect(payloadMeta({ a: 1 })).toEqual({ present: true, bytes: 7 });
  });
});

describe('normalizeCallList', () => {
  it('normalizes a full documented row (with string-typed numbers)', () => {
    const n = normalizeCallList({
      list_id: '318',
      list_name: 'wedding-a',
      rule_id: 1494311,
      priority: 0,
      max_simultaneous: '3',
      num_attempts: 5,
      interval_seconds: 600,
      dt_submit: '2026-07-19 10:00:00',
      dt_complete: null,
      status: 'In progress',
    });
    expect(n).toMatchObject({
      listId: 318,
      name: 'wedding-a',
      ruleId: 1494311,
      maxSimultaneous: 3,
      status: 'in_progress',
      submittedAt: '2026-07-19T10:00:00.000Z',
      completedAt: null,
    });
  });
  it('degrades partial rows to nulls and unknown status', () => {
    const n = normalizeCallList({ list_name: 'x', status: 'Paused?' });
    expect(n.listId).toBeNull();
    expect(n.status).toBe('unknown');
  });
  it('survives garbage and empty inputs', () => {
    expect(normalizeCallList('garbage').status).toBe('unknown');
    expect(normalizeCallList(null).listId).toBeNull();
    expect(normalizeCallList(undefined).name).toBeNull();
  });
});

describe('normalizeCallListTask', () => {
  it('maps status_id 0-4 and reduces content fields to metadata only', () => {
    const n = normalizeCallListTask({
      task_id: 7,
      task_uuid: 'u-1',
      status_id: 2,
      attempts_left: 3,
      custom_data: '{"phone":"+972501234567","name":"דנה"}',
      result_data: null,
    });
    expect(n.status).toBe('processed');
    expect(n.customData.present).toBe(true);
    expect(n.resultData.present).toBe(false);
    // The normalized object must NOT carry the raw content anywhere.
    expect(JSON.stringify(n)).not.toContain('972501234567');
    expect(JSON.stringify(n)).not.toContain('דנה');
  });
  it('falls back to the textual status and then to unknown', () => {
    expect(normalizeCallListTask({ status: 'In progress' }).status).toBe('in_progress');
    expect(normalizeCallListTask({ status_id: 9 }).status).toBe('unknown');
    expect(normalizeCallListTask({}).status).toBe('unknown');
  });
  it('survives garbage', () => {
    expect(normalizeCallListTask(42).taskId).toBeNull();
  });
});

describe('normalizeAuditEntry + maskIp', () => {
  it('produces at/command/actorType/ipMasked and NOTHING else', () => {
    const n = normalizeAuditEntry({
      requested: '2026-07-19 08:00:00',
      cmd_name: 'SetAccountInfo',
      account_email: 'x@y.z',
      ip: '84.32.11.9',
      detail: 'SECRET CONTENT MUST NOT SURVIVE',
    });
    expect(n).toEqual({
      at: '2026-07-19T08:00:00.000Z',
      command: 'SetAccountInfo',
      actorType: 'account',
      ipMasked: '84.32.11.xxx',
    });
    expect(JSON.stringify(n)).not.toContain('SECRET');
  });
  it('masks IPv6 to its first groups and rejects junk', () => {
    expect(maskIp('2a01:4f8:c2c:123::1')).toBe('2a01:4f8:…');
    expect(maskIp('not-an-ip')).toBeNull();
    expect(maskIp(null)).toBeNull();
  });
  it('degrades partial/garbage to nulls/unknown', () => {
    expect(normalizeAuditEntry({})).toEqual({
      at: null,
      command: null,
      actorType: 'unknown',
      ipMasked: null,
    });
    expect(normalizeAuditEntry('x').actorType).toBe('unknown');
  });
});

describe('extractIpStrings', () => {
  it('collects valid IPv4/IPv6 from any nested shape, deduped + sorted', () => {
    const ips = extractIpStrings({
      jsservers: ['84.201.130.55', { ip: '84.201.130.55' }, '10.0.0.300'],
      nested: [{ deep: { v6: '2a01:4f8::1' } }],
      noise: ['hello', 123, null, '999.1.1.1'],
    });
    expect(ips).toEqual(['2a01:4f8::1', '84.201.130.55']);
  });
  it('returns an empty list for garbage/empty inputs', () => {
    expect(extractIpStrings(null)).toEqual([]);
    expect(extractIpStrings('no ips here')).toEqual([]);
    expect(extractIpStrings({})).toEqual([]);
  });
});

describe('normalizeAccountCallbackEnvelope', () => {
  it('extracts typed events from a valid envelope', () => {
    const n = normalizeAccountCallbackEnvelope({
      callbacks: [
        { type: 'min_balance', callback_id: 991, min_balance: { balance: 0.9 } },
        { type: 'future_unknown_kind', callback_id: 'abc' },
      ],
    });
    expect(n.events).toEqual([
      { type: 'min_balance', callbackId: '991' },
      { type: 'future_unknown_kind', callbackId: 'abc' },
    ]);
    expect(n.unknownShapes).toBe(0);
  });
  it('counts malformed items without failing the envelope', () => {
    const n = normalizeAccountCallbackEnvelope({ callbacks: [{ no_type: 1 }, 'junk', { type: 'x' }] });
    expect(n.events).toEqual([{ type: 'x', callbackId: null }]);
    expect(n.unknownShapes).toBe(2);
  });
  it('returns an empty result for garbage — a poke is still a poke', () => {
    expect(normalizeAccountCallbackEnvelope('<html>').events).toEqual([]);
    expect(normalizeAccountCallbackEnvelope(null).events).toEqual([]);
    expect(normalizeAccountCallbackEnvelope({ callbacks: 'nope' }).events).toEqual([]);
  });
});

describe('normalizeAccountInfo', () => {
  it('reads balance/currency/echo from the result envelope', () => {
    const n = normalizeAccountInfo({
      result: {
        balance: '5.23',
        currency: 'USD',
        active: true,
        callback_url: 'https://beta.kalfa.me/api/voximplant/account-callback/x',
      },
    });
    expect(n.balance).toBeCloseTo(5.23);
    expect(n.currency).toBe('USD');
    expect(n.callbackUrl).toContain('account-callback');
  });
  it('yields balance null (→ "unknown balance" alert) on a non-numeric balance', () => {
    expect(normalizeAccountInfo({ result: { balance: 'NaN?' } }).balance).toBeNull();
    expect(normalizeAccountInfo({}).balance).toBeNull();
    expect(normalizeAccountInfo('garbage').balance).toBeNull();
  });
});

describe('normalizeSessionLogPointer', () => {
  it('extracts the session id and raw log url (validation happens later)', () => {
    expect(
      normalizeSessionLogPointer({ call_session_history_id: 12, log_file_url: 'https://x/y' }),
    ).toEqual({ sessionId: 12, logFileUrl: 'https://x/y' });
  });
  it('degrades partial/garbage to nulls', () => {
    expect(normalizeSessionLogPointer({})).toEqual({ sessionId: null, logFileUrl: null });
    expect(normalizeSessionLogPointer(null).sessionId).toBeNull();
  });
});
