// The owner-agent input schemas. Each bound mirrors a CHECK in the migration, and
// the two traps each schema exists to close are asserted by name: an empty cap that
// coerces to 0, and bare foreign digits that parse as a different Israeli number.
import { describe, expect, it } from 'vitest';

import {
  addAllowlistEntrySchema,
  agentNumberSchema,
  allowlistLabelSchema,
  allowlistPhoneSchema,
  dailyCapSchema,
} from './owner-agent';

describe('dailyCapSchema', () => {
  it.each([
    ['0', 0],
    ['50', 50],
    [' 10000 ', 10000],
  ])('accepts %j', (raw, value) => {
    expect(dailyCapSchema.parse(raw)).toBe(value);
  });

  it('refuses an EMPTY field rather than reading it as 0 (= agent silently off)', () => {
    expect(dailyCapSchema.safeParse('').success).toBe(false);
    expect(dailyCapSchema.safeParse('   ').success).toBe(false);
  });

  it.each(['10001', '-1', '1.5', 'abc', '1e3'])('refuses %j', (raw) => {
    expect(dailyCapSchema.safeParse(raw).success).toBe(false);
  });
});

describe('agentNumberSchema', () => {
  it('reads "" as none', () => {
    expect(agentNumberSchema.parse('')).toBeNull();
  });

  it('accepts a Meta phone_number_id', () => {
    expect(agentNumberSchema.parse('1234567890123456')).toBe('1234567890123456');
  });

  it.each(['+972501234567', '12a4', '1'.repeat(26)])('refuses %j', (raw) => {
    expect(agentNumberSchema.safeParse(raw).success).toBe(false);
  });
});

describe('allowlistPhoneSchema', () => {
  it.each([
    ['0501234567', '+972501234567'],
    ['050-123-4567', '+972501234567'],
    ['+972 50-123-4567', '+972501234567'],
    ['+15417543010', '+15417543010'],
  ])('normalises %j to %j', (raw, e164) => {
    expect(allowlistPhoneSchema.parse(raw)).toBe(e164);
  });

  it('refuses bare foreign digits — normalizePhone would make them a DIFFERENT Israeli number', () => {
    // Measured: '15417543010' → '+97215417543010' under the IL default.
    expect(allowlistPhoneSchema.safeParse('15417543010').success).toBe(false);
  });

  it.each(['', 'abc', '+972', '0123'])('refuses %j', (raw) => {
    expect(allowlistPhoneSchema.safeParse(raw).success).toBe(false);
  });

  it('never echoes the submitted number in its error message', () => {
    const result = allowlistPhoneSchema.safeParse('+97299');
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues.map((i) => i.message))).not.toContain('99');
  });
});

describe('allowlistLabelSchema', () => {
  it('trims, and reads "" as no label', () => {
    expect(allowlistLabelSchema.parse('  ')).toBeNull();
    expect(allowlistLabelSchema.parse(' נייד ')).toBe('נייד');
  });

  it('refuses more than the 120 characters the table allows', () => {
    expect(allowlistLabelSchema.safeParse('א'.repeat(120)).success).toBe(true);
    expect(allowlistLabelSchema.safeParse('א'.repeat(121)).success).toBe(false);
  });
});

describe('addAllowlistEntrySchema', () => {
  it('requires a real staff user id', () => {
    const result = addAllowlistEntrySchema.safeParse({
      e164: '0501234567',
      staffUserId: 'not-a-uuid',
      label: '',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['staffUserId']);
  });
});
