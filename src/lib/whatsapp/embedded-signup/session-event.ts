import { z } from 'zod';

// The `message` event Meta's Embedded Signup popup posts back to the window that
// opened it (implementation.md, "Session logging message event listener").
//
// Pure: runs in the browser (the launcher) and in tests. No I/O.
//
// The ids parsed here are DISPLAY HINTS ONLY. They arrive from the browser, and
// the project rule is never to trust a submitted identifier: the server derives
// the WABA from the exchanged token (debug_token granular_scopes) and never
// reads these.

const META_HOSTS = new Set(['www.facebook.com', 'web.facebook.com', 'facebook.com']);

// Meta's sample uses `origin.endsWith('facebook.com')`, which also accepts
// evilfacebook.com. Exact host, https only.
export function isMetaOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && META_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

const FINISH_EVENTS = [
  'FINISH',
  'FINISH_ONLY_WABA',
  'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
] as const;
export type FinishEvent = (typeof FINISH_EVENTS)[number];

export function isFinishEvent(value: string): value is FinishEvent {
  return (FINISH_EVENTS as readonly string[]).includes(value);
}

export type SessionEvent =
  | { kind: 'finish'; event: FinishEvent; wabaId: string | null; phoneNumberId: string | null }
  | { kind: 'cancel'; currentStep: string | null }
  | { kind: 'error'; errorCode: string | null; sessionId: string | null; message: string | null };

const graphId = z.string().regex(/^\d{1,32}$/);
const shortText = z.string().max(500);

const envelope = z.object({
  type: z.literal('WA_EMBEDDED_SIGNUP'),
  event: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

function idOrNull(v: unknown): string | null {
  const r = graphId.safeParse(v);
  return r.success ? r.data : null;
}

function textOrNull(v: unknown): string | null {
  const r = shortText.safeParse(v);
  return r.success ? r.data : null;
}

/**
 * Anything this does not recognise returns null and is ignored by the caller —
 * other scripts on the page post messages too, and an unknown Meta event
 * (FINISH_OBO_MIGRATION, FINISH_GRANT_ONLY_API_ACCESS) is not a flow this page
 * launches.
 */
export function parseSessionEvent(raw: unknown): SessionEvent | null {
  let json: unknown = raw;
  if (typeof raw === 'string') {
    try {
      json = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const env = envelope.safeParse(json);
  if (!env.success) return null;
  const { event } = env.data;
  const data = env.data.data ?? {};

  if (isFinishEvent(event)) {
    return {
      kind: 'finish',
      event,
      wabaId: idOrNull(data.waba_id),
      phoneNumberId: idOrNull(data.phone_number_id),
    };
  }

  // A user-reported error is ALSO sent as event CANCEL (errors.md); what tells
  // it apart from an abandoned flow is the error fields.
  if (event === 'CANCEL' || event === 'ERROR') {
    if (data.error_code !== undefined || data.error_message !== undefined) {
      return {
        kind: 'error',
        errorCode: textOrNull(data.error_code),
        sessionId: textOrNull(data.session_id),
        message: textOrNull(data.error_message),
      };
    }
    return { kind: 'cancel', currentStep: textOrNull(data.current_step) };
  }

  return null;
}
