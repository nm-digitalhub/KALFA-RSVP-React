import { describe, expect, it } from 'vitest';

import { RDP_FILE_MAX_BYTES } from './policy';
import { validateRdpFile } from './rdp-file';

const TARGET = 'desktop.example.test:3389';
const TOKEN = 'header.payload.signature';

// The shape rdpgw's /connect returns (verified against the live gateway: these keys, in this form).
const GOOD = [
  'gatewayhostname:s:gw.example.test',
  `full address:s:${TARGET}`,
  'gatewaycredentialssource:i:5',
  'gatewayprofileusagemethod:i:1',
  'gatewayusagemethod:i:1',
  `gatewayaccesstoken:s:${TOKEN}`,
  'authentication level:i:0',
  'enablecredsspsupport:i:0',
].join('\r\n');

const check = (text: string) => validateRdpFile(text, { target: TARGET });
const withLine = (line: string) => `${GOOD}\r\n${line}`;

describe('validateRdpFile', () => {
  it('accepts the file the gateway produces and returns it unchanged', () => {
    const result = check(GOOD);
    expect(result).toEqual({ ok: true, content: GOOD });
  });

  it('accepts LF line endings, blank lines and a mixed-case target', () => {
    const text = `${GOOD.replaceAll('\r\n', '\n')}\n\n`.replace(TARGET, TARGET.toUpperCase());
    expect(check(text).ok).toBe(true);
  });

  it('rejects an oversized file by bytes, not characters', () => {
    expect(check(withLine(`pad:s:${'א'.repeat(RDP_FILE_MAX_BYTES)}`))).toEqual({ ok: false, reason: 'too_large' });
  });

  it.each(['\u0000', '\u0001', '\u001B', '\u007F'])('rejects the control character %j', (char) => {
    expect(check(withLine(`note:s:a${char}b`))).toEqual({ ok: false, reason: 'binary' });
  });

  it.each([
    'just some text',
    'no type here:value',
    'bad type:x:1',
    ':s:empty name',
    '<script>alert(1)</script>',
    'name with / slash:s:1',
  ])('rejects the malformed line %j', (line) => {
    expect(check(withLine(line))).toEqual({ ok: false, reason: 'malformed' });
  });

  it('requires a gateway token', () => {
    expect(check(GOOD.replace(`gatewayaccesstoken:s:${TOKEN}`, 'gatewayaccesstoken:s:'))).toEqual({
      ok: false,
      reason: 'no_token',
    });
    expect(check(GOOD.replace(/gatewayaccesstoken:s:.*(\r\n|$)/, ''))).toEqual({ ok: false, reason: 'no_token' });
  });

  it('requires a gateway host name', () => {
    expect(check(GOOD.replace('gatewayhostname:s:gw.example.test', 'gatewayhostname:s:'))).toEqual({
      ok: false,
      reason: 'no_gateway',
    });
  });

  it.each([
    ['another host', 'full address:s:other.example.test:3389'],
    ['another port', `full address:s:desktop.example.test:3390`],
    ['no address', ''],
  ])('refuses a file that points at %s', (_label, replacement) => {
    const text = replacement
      ? GOOD.replace(`full address:s:${TARGET}`, replacement)
      : GOOD.replace(`full address:s:${TARGET}\r\n`, '');
    expect(check(text)).toEqual({ ok: false, reason: 'wrong_target' });
  });

  it.each(['gatewayaccesstoken:s:other', 'gatewayhostname:s:evil.example.test', 'full address:s:evil.example.test:3389'])(
    'refuses a second copy of %s (no client-side last-wins)',
    (line) => {
      expect(check(withLine(line))).toEqual({ ok: false, reason: 'duplicate_key' });
    },
  );

  it.each([
    'alternate shell:s:cmd.exe',
    'shell working directory:s:C:\\',
    'remoteapplicationmode:i:1',
    'remoteapplicationmode:i:0',
    'remoteapplicationprogram:s:||x',
    'RemoteApplicationCmdLine:s:/c calc',
  ])('refuses the program setting %j whatever its value', (line) => {
    expect(check(withLine(line))).toEqual({ ok: false, reason: 'forbidden_setting' });
  });

  it.each([
    'redirectclipboard:i:1',
    'redirectdrives:i:1',
    'drivestoredirect:s:*',
    'drivestoredirect:s:C:\\;',
    'devicestoredirect:s:*',
    'usbdevicestoredirect:s:*',
    'redirectprinters:i:1',
    'redirectsmartcards:i:1',
    'camerastoredirect:s:*',
  ])('refuses the redirection %j', (line) => {
    expect(check(withLine(line))).toEqual({ ok: false, reason: 'forbidden_setting' });
  });

  it.each(['redirectclipboard:i:0', 'redirectdrives:i:0', 'drivestoredirect:s:', 'redirectprinters:i:0'])(
    'allows the redirection %j when it switches the resource off',
    (line) => {
      expect(check(withLine(line)).ok).toBe(true);
    },
  );

  it('never puts the file content in a rejection', () => {
    const result = check(withLine('alternate shell:s:cmd.exe'));
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain('cmd.exe');
  });
});
