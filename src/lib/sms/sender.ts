import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { createAdminClient } from '@/lib/supabase/admin';

// SMS transport abstraction. The OTP logic is provider-agnostic; only this
// adapter knows about ExtrA (exm.co.il). Swapping providers = a new adapter.
const EXTRA_SMS_URL = 'https://www.exm.co.il/api/v1/sms/send/';

export interface SmsSender {
  send(params: { to: string; text: string }): Promise<{ id: string }>;
}

export class SmsConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SmsConfigError';
  }
}
export class SmsSendError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SmsSendError';
  }
}

// ExtrA: POST /api/v1/sms/send/ with Bearer token; body { message, destination,
// sender }; response { success, id, messages_count, errors[] }.
export function createExtraSmsSender(config: {
  token: string;
  sender: string;
}): SmsSender {
  return {
    async send({ to, text }) {
      let res: Response;
      try {
        res = await fetch(EXTRA_SMS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify({
            message: text,
            destination: to,
            sender: config.sender,
          }),
        });
      } catch {
        // Fail-safe ops alert (non-throwing, no PII — no destination/token).
        void sendSlackAlert({
          level: 'warn',
          title: 'SMS send failed',
          detail: 'transport',
          source: 'sms',
          category: 'send_health',
        });
        throw new SmsSendError('שליחת ההודעה נכשלה (תקשורת)');
      }
      // Carry the provider's HTTP status / error detail in the thrown message so
      // the server can LOG why a send failed (the message is for server logs, not
      // shown to the user — callers map it to a generic notice). No token (it is
      // request-only) or PII destination is included here.
      if (!res.ok) {
        void sendSlackAlert({
          level: 'warn',
          title: 'SMS send failed',
          detail: `http_${res.status}`,
          source: 'sms',
          category: 'send_health',
        });
        throw new SmsSendError(`שליחת ההודעה נכשלה (HTTP ${res.status})`);
      }

      let json: { success?: boolean; id?: string; errors?: unknown };
      try {
        json = (await res.json()) as {
          success?: boolean;
          id?: string;
          errors?: unknown;
        };
      } catch {
        void sendSlackAlert({
          level: 'warn',
          title: 'SMS send failed',
          detail: 'invalid_response',
          source: 'sms',
          category: 'send_health',
        });
        throw new SmsSendError('תגובה לא תקינה מספק ה-SMS');
      }
      if (!json.success || !json.id) {
        // Provider rejected THIS destination (invalid/blocked number). This is a
        // routine per-destination business outcome — common for OTP — NOT a
        // transport/config/outage failure, so it is deliberately NOT alerted
        // (symmetric with whatsapp's 131049/131026 and sumit's declined cases).
        // ExtrA exposes no code here that separates a config/auth failure from a
        // bad destination, so no alert is emitted. Control flow is unchanged.
        const detail = json.errors ? ` (${JSON.stringify(json.errors)})` : '';
        throw new SmsSendError(`שליחת ההודעה נדחתה${detail}`);
      }
      return { id: json.id };
    },
  };
}

export type SmsSettingsRead =
  | { kind: 'ok'; token: string; sender: string; enabled: boolean }
  /** The row could not be read at all — infrastructure, not an SMS fault. */
  | { kind: 'unreadable' }
  /** Read fine; no credentials stored. A valid state for an install that has none. */
  | { kind: 'unconfigured' };

/**
 * The admin-managed row, as a result rather than an exception.
 *
 * ⚠️ `enabled` IS RETURNED SEPARATELY AND IS NOT PART OF `unconfigured`. This is the
 * exact bug that made /admin/debug report ExtrA as NOT CONFIGURED whenever the SMS
 * switch was off: getSmsSender() throws on `!sms_enabled`, so anything asking it
 * "are we configured" got "no" for a switched-off but perfectly configured account.
 * The key-expiry check has to run whether or not sending is switched on — an expiring
 * key is worth knowing about while the channel is dark, and finding out on the day
 * someone switches it back on is exactly the failure this monitor exists to prevent.
 */
export async function readSmsSettings(): Promise<SmsSettingsRead> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_settings')
    .select('sms_enabled, extra_sms_token, extra_sms_sender')
    .eq('id', true)
    .maybeSingle();
  if (error) return { kind: 'unreadable' };
  if (!data?.extra_sms_token || !data.extra_sms_sender) return { kind: 'unconfigured' };
  return {
    kind: 'ok',
    token: data.extra_sms_token,
    sender: data.extra_sms_sender,
    enabled: data.sms_enabled === true,
  };
}

// Build a configured sender from the admin-managed app_settings (server-only).
// Throws SmsConfigError when SMS is disabled or not configured — for a caller about
// to send, "switched off" and "not set up" are the same answer. Only the health
// check needs them apart; see readSmsSettings above.
export async function getSmsSender(): Promise<SmsSender> {
  const read = await readSmsSettings();
  if (read.kind === 'unreadable') throw new SmsConfigError('טעינת הגדרות ה-SMS נכשלה');
  if (read.kind === 'unconfigured' || !read.enabled) {
    throw new SmsConfigError('שירות ה-SMS אינו מוגדר');
  }
  return createExtraSmsSender({ token: read.token, sender: read.sender });
}
