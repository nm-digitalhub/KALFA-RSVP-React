import { describe, expect, it } from 'vitest';

import { RDP_FILE_MAX_BYTES } from './policy';
import { addXrdpLogon, validateRdpFile } from './rdp-file';
import { XRDP_LOGON_MAX_CHARS } from './xrdp-ticket';

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

describe('addXrdpLogon', () => {
  const TICKET = `k1.${'A'.repeat(38)}`;
  const add = (content: string, over: Partial<{ account: string; ticket: string }> = {}) =>
    addXrdpLogon(content, { account: 'kalfa.me', ticket: TICKET, ...over });

  it('adds exactly one username line with the unit separator between the account and the ticket', () => {
    const result = add(GOOD);
    expect(result).toEqual({ ok: true, content: `${GOOD}\r\nusername:s:kalfa.me\x1f${TICKET}\r\n` });
  });

  it('keeps the line ending style of the file and a trailing newline that is already there', () => {
    const lf = GOOD.replaceAll('\r\n', '\n') + '\n';
    expect(add(lf)).toEqual({ ok: true, content: `${lf}username:s:kalfa.me\x1f${TICKET}\n` });
  });

  it('changes nothing else in the file', () => {
    const result = add(GOOD);
    expect(result.ok && result.content.startsWith(GOOD)).toBe(true);
  });

  it('refuses a file that already names a user or a domain, whatever the case or spacing', () => {
    for (const line of ['username:s:someone', 'Username:s:someone', 'domain:s:CORP', ' username:s:x']) {
      expect(add(withLine(line))).toEqual({ ok: false, reason: 'has_username' });
    }
  });

  it('refuses an account that is not a plain account name', () => {
    for (const account of ['', 'root', 'kalfa me', 'a\x1fb', 'a\nb', '../x', 'x'.repeat(40)]) {
      expect(add(GOOD, { account })).toEqual({ ok: false, reason: 'bad_account' });
    }
  });

  it('refuses a ticket of the wrong shape, so nothing else can ride in the username line', () => {
    for (const ticket of ['', 'password', `${TICKET}\n`, `${TICKET}\x1fx`, `k2.${'A'.repeat(38)}`, `k1.${'A'.repeat(39)}`]) {
      expect(add(GOOD, { ticket })).toEqual({ ok: false, reason: 'bad_ticket' });
    }
  });

  it('fits the connection cookie limit even with the longest account name the pattern allows', () => {
    const longest = 'a'.repeat(32);
    const result = add(GOOD, { account: longest });
    expect(result.ok).toBe(true);
    expect(longest.length + 1 + TICKET.length).toBeLessThan(XRDP_LOGON_MAX_CHARS);
  });

  it('only runs after validation: the file it returns is no longer a file validateRdpFile accepts', () => {
    const composed = add(GOOD);
    expect(composed.ok && check(composed.content)).toEqual({ ok: false, reason: 'binary' });
  });
});
