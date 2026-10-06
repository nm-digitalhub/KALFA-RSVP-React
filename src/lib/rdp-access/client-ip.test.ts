import { describe, expect, it } from 'vitest';

import { rdpClientIp } from './client-ip';

const headers = (values: Record<string, string>) => (name: string) => values[name] ?? null;

describe('rdpClientIp', () => {
  it('returns the address nginx set in x-real-ip', () => {
    expect(rdpClientIp(headers({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(rdpClientIp(headers({ 'x-real-ip': ' 2001:db8::1 ' }))).toBe('2001:db8::1');
  });

  it('ignores x-forwarded-for, which the client controls', () => {
    expect(rdpClientIp(headers({ 'x-forwarded-for': '198.51.100.9, 203.0.113.7' }))).toBeNull();
    expect(
      rdpClientIp(headers({ 'x-forwarded-for': '198.51.100.9', 'x-real-ip': '203.0.113.7' })),
    ).toBe('203.0.113.7');
  });

  it('treats anything that is not a literal IP address as unknown', () => {
    expect(rdpClientIp(headers({}))).toBeNull();
    expect(rdpClientIp(headers({ 'x-real-ip': '' }))).toBeNull();
    expect(rdpClientIp(headers({ 'x-real-ip': 'unknown' }))).toBeNull();
    expect(rdpClientIp(headers({ 'x-real-ip': '203.0.113.7, 198.51.100.9' }))).toBeNull();
    expect(rdpClientIp(headers({ 'x-real-ip': '203.0.113.7\r\nX-Evil: 1' }))).toBeNull();
    expect(rdpClientIp(headers({ 'x-real-ip': 'example.test' }))).toBeNull();
  });
});
