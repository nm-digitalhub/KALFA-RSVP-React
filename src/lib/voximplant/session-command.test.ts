import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { pickSessionUrl } from './session-command';

describe('session command IP classification', () => {
  it.each(['127.0.0.1', '169.254.169.254', '0.0.0.0', '[::1]', '[::]',
    '[fe80::1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::ffff:a9fe:a9fe]'])
  ('rejects local capability host %s', host => {
    expect(pickSessionUrl(`https://${host}/token`, null)).toBeNull();
  });

  it.each(['84.201.130.55', '[2a01:4f8::1]', 'media.voximplant.com'])
  ('preserves provider host %s', host => {
    expect(pickSessionUrl(`https://${host}/token`, null)?.protocol).toBe('https:');
  });

  it('prefers the secure URL and preserves the provider HTTP fallback', () => {
    expect(pickSessionUrl('https://media.voximplant.com/secure', 'http://84.201.130.55/plain')?.pathname).toBe('/secure');
    expect(pickSessionUrl(null, 'http://84.201.130.55/plain')?.protocol).toBe('http:');
  });
});
