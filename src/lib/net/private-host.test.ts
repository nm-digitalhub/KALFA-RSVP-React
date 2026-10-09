import { describe, expect, it } from 'vitest';
import { isPrivateOrLocalHost } from './private-host';

describe('library-backed hostname policy', () => {
  it.each([
    'localhost',
    'x.local',
    'x.internal',
    '127.0.0.1',
    '8.8.8.8',
    '[::1]',
    '::',
    'fc00::1',
    'fd00::1',
    'fe90::1',
    'ff02::1',
    '[::ffff:127.0.0.1]',
    '[::ffff:8.8.8.8]',
  ])('rejects %s', (host) => {
    expect(isPrivateOrLocalHost(host)).toBe(true);
  });
  it.each([
    'fc-events.example.com',
    'fd.example.com',
    'example.com',
    '[2606:4700:4700::1111]',
  ])('accepts public host %s', (host) => {
    expect(isPrivateOrLocalHost(host)).toBe(false);
  });
});
