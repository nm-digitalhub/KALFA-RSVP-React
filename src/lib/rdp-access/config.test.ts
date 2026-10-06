import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getRdpGatewayConfig, RDPGW_ENV } from './config';

// 32+ characters each, all different: one secret per direction.
const SECRET_CHECK = 'c'.repeat(40);
const SECRET_CONNECT = 'n'.repeat(40);
const SECRET_ADMIN = 'a'.repeat(40);

const VALID = {
  RDPGW_LOOPBACK_URL: 'http://127.0.0.1:3013',
  RDPGW_ADMIN_URL: 'http://127.0.0.1:3014',
  RDPGW_TARGET: 'desktop.example.test:3389',
  RDPGW_USER: 'desktopuser',
  RDPGW_CHECK_SECRET: SECRET_CHECK,
  RDPGW_CONNECT_SECRET: SECRET_CONNECT,
  RDPGW_ADMIN_SECRET: SECRET_ADMIN,
} as const;

describe('getRdpGatewayConfig', () => {
  it('accepts a complete loopback configuration', () => {
    const result = getRdpGatewayConfig(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.gatewayOrigin).toBe('http://127.0.0.1:3013');
    expect(result.config.adminOrigin).toBe('http://127.0.0.1:3014');
    expect(result.config.target).toBe('desktop.example.test:3389');
    expect(result.config.gatewayUser).toBe('desktopuser');
  });

  it('accepts a literal IPv6 loopback', () => {
    const result = getRdpGatewayConfig({ ...VALID, RDPGW_LOOPBACK_URL: 'http://[::1]:3013' });
    expect(result.ok).toBe(true);
  });

  it.each(Object.values(RDPGW_ENV))('fails closed when %s is missing', (variable) => {
    const env: Record<string, string | undefined> = { ...VALID };
    delete env[variable];
    const result = getRdpGatewayConfig(env);
    expect(result).toEqual({ ok: false, problems: [{ variable, reason: 'missing' }] });
  });

  it('treats a blank value as missing', () => {
    const result = getRdpGatewayConfig({ ...VALID, RDPGW_TARGET: '   ' });
    expect(result).toEqual({ ok: false, problems: [{ variable: 'RDPGW_TARGET', reason: 'missing' }] });
  });

  it.each([
    ['a hostname instead of a literal address', 'http://localhost:3013'],
    ['a non-loopback address', 'http://10.0.0.5:3013'],
    ['a public address', 'http://203.0.113.9:3013'],
    ['TLS (the gateway listener is plain loopback HTTP)', 'https://127.0.0.1:3013'],
    ['no port', 'http://127.0.0.1'],
    ['embedded credentials', 'http://user:pass@127.0.0.1:3013'],
    ['a path', 'http://127.0.0.1:3013/connect'],
    ['a query string', 'http://127.0.0.1:3013/?x=1'],
    ['not a URL at all', 'not a url'],
  ])('rejects %s for the gateway URL', (_label, value) => {
    const result = getRdpGatewayConfig({ ...VALID, RDPGW_LOOPBACK_URL: value });
    expect(result).toEqual({ ok: false, problems: [{ variable: 'RDPGW_LOOPBACK_URL', reason: 'invalid' }] });
  });

  it('applies the same loopback rule to the admin URL', () => {
    const result = getRdpGatewayConfig({ ...VALID, RDPGW_ADMIN_URL: 'http://0.0.0.0:3014' });
    expect(result).toEqual({ ok: false, problems: [{ variable: 'RDPGW_ADMIN_URL', reason: 'invalid' }] });
  });

  it.each(['no-port', 'host:port:extra', 'host:', ':3389', 'host name:3389', 'host:33890000', 'host:70000', 'host:0', 'host:65536'])(
    'rejects the malformed target %s',
    (target) => {
      const result = getRdpGatewayConfig({ ...VALID, RDPGW_TARGET: target });
      expect(result).toEqual({ ok: false, problems: [{ variable: 'RDPGW_TARGET', reason: 'invalid' }] });
    },
  );

  it.each(['', 'has space', '1leadingdigit', 'a'.repeat(33), 'semi;colon'])(
    'rejects the OS user name %j',
    (user) => {
      const result = getRdpGatewayConfig({ ...VALID, RDPGW_USER: user });
      expect(result.ok).toBe(false);
    },
  );

  it('rejects a secret shorter than 32 characters', () => {
    const result = getRdpGatewayConfig({ ...VALID, RDPGW_CHECK_SECRET: 'x'.repeat(31) });
    expect(result).toEqual({ ok: false, problems: [{ variable: 'RDPGW_CHECK_SECRET', reason: 'invalid' }] });
  });

  it('rejects a secret reused for another direction, once per variable', () => {
    const result = getRdpGatewayConfig({ ...VALID, RDPGW_ADMIN_SECRET: SECRET_CHECK });
    expect(result).toEqual({ ok: false, problems: [{ variable: 'RDPGW_ADMIN_SECRET', reason: 'invalid' }] });
  });

  it('never puts a secret value in the result, valid or not', () => {
    const bad = getRdpGatewayConfig({ ...VALID, RDPGW_LOOPBACK_URL: 'nope' });
    const serialized = JSON.stringify(bad);
    for (const secret of [SECRET_CHECK, SECRET_CONNECT, SECRET_ADMIN]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
