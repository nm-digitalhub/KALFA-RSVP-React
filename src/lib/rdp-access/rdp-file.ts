import { RDP_FILE_MAX_BYTES } from './policy';

// Validation of the .rdp file the gateway's /connect returns, BEFORE it reaches a staff member's browser.
//
// The file comes from our own gateway over loopback, so this is defense in depth against a gateway that is
// misconfigured or compromised: the staff member double-clicks this file, and an .rdp file can run a program on
// connect or open the local machine's drives and clipboard to the remote one. The file must point at the pinned
// target and carry a token; it must not carry anything that starts a program or redirects a local resource.
//
// The body is never stored and never logged. A rejection reports a fixed reason only.

export type RdpFileRejection =
  | 'too_large'
  | 'binary'
  | 'malformed'
  | 'duplicate_key'
  | 'no_token'
  | 'no_gateway'
  | 'wrong_target'
  | 'forbidden_setting';

export type RdpFileValidation = { ok: true; content: string } | { ok: false; reason: RdpFileRejection };

// One .rdp setting: `name:type:value`, type s (string), i (integer) or b (binary).
const SETTING_LINE = /^([A-Za-z0-9 ._-]+):([sib]):(.*)$/;

// Bytes that never belong in a text file. Tab, CR and LF are allowed.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// Settings that start a program or a RemoteApp on connect: never acceptable, whatever the value.
const PROGRAM_SETTINGS: ReadonlySet<string> = new Set([
  'alternate shell',
  'shell working directory',
  'remoteapplicationmode',
  'remoteapplicationprogram',
  'remoteapplicationname',
  'remoteapplicationcmdline',
  'remoteapplicationfile',
  'remoteapplicationguid',
  'remoteapplicationicon',
  'remoteapplicationappid',
  'remoteapplicationexpandcmdline',
  'remoteapplicationexpandworkingdir',
]);

// Settings that expose a local resource to the remote machine. Allowed only when they switch it OFF.
const REDIRECTION_SETTINGS: ReadonlySet<string> = new Set([
  'drivestoredirect',
  'devicestoredirect',
  'usbdevicestoredirect',
  'camerastoredirect',
  'redirectdrives',
  'redirectprinters',
  'redirectcomports',
  'redirectsmartcards',
  'redirectclipboard',
  'redirectposdevices',
  'redirectlocation',
  'redirectwebauthn',
]);

// Settings that identify the file's purpose; a second copy would make "which one wins" a client decision.
const UNIQUE_SETTINGS: ReadonlySet<string> = new Set(['gatewayaccesstoken', 'gatewayhostname', 'full address']);

function switchesRedirectionOff(type: string, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;
  if (type === 'i') return trimmed === '0';
  return false;
}

export function validateRdpFile(raw: string, expected: { target: string }): RdpFileValidation {
  if (Buffer.byteLength(raw, 'utf8') > RDP_FILE_MAX_BYTES) return { ok: false, reason: 'too_large' };
  if (CONTROL_CHARACTERS.test(raw)) return { ok: false, reason: 'binary' };

  const seen = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const match = SETTING_LINE.exec(line);
    if (!match) return { ok: false, reason: 'malformed' };
    const key = match[1]!.trim().toLowerCase();
    const type = match[2]!;
    const value = match[3]!;

    if (PROGRAM_SETTINGS.has(key)) return { ok: false, reason: 'forbidden_setting' };
    if (REDIRECTION_SETTINGS.has(key) && !switchesRedirectionOff(type, value)) {
      return { ok: false, reason: 'forbidden_setting' };
    }
    if (UNIQUE_SETTINGS.has(key) && seen.has(key)) return { ok: false, reason: 'duplicate_key' };
    seen.set(key, value.trim());
  }

  if (!seen.get('gatewayaccesstoken')) return { ok: false, reason: 'no_token' };
  if (!seen.get('gatewayhostname')) return { ok: false, reason: 'no_gateway' };
  if (seen.get('full address')?.toLowerCase() !== expected.target.toLowerCase()) {
    return { ok: false, reason: 'wrong_target' };
  }
  return { ok: true, content: raw };
}
