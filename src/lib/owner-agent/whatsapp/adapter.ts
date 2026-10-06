import 'server-only';

import { randomBytes } from 'node:crypto';

import { WhatsAppAdapter } from '@chat-adapter/whatsapp';
import { WhatsAppAPI } from 'whatsapp-api-js';
import type { ServerMediaRetrieveResponse } from 'whatsapp-api-js/types';

import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

// The owner agent's WhatsApp layer: `@chat-adapter/whatsapp` (owner decision
// 27.9, plans/owner-agent-chat-sdk-capabilities-plan.md §9.2), wrapped so the
// package can never pick its own config, its own recipient or its own logging.
//
// Rules this module enforces (plan §3):
//   - `new WhatsAppAdapter({...})` directly. NEVER `createWhatsAppAdapter`: it
//     fills every missing field from WHATSAPP_* env, including `apiUrl`
//     (cawa dist/index.js:2177-2215), and the consumer runs with
//     `--env-file=.env.local`, which carries WHATSAPP_ACCESS_TOKEN.
//   - Every field comes from our caller (app_settings via getWhatsAppConfig +
//     the intake's phone_number_id). An empty or null one throws — never a
//     silent fallback to something else.
//   - `apiUrl` pinned to graph.facebook.com, `apiVersion` = GRAPH_API_VERSION.
//   - A quiet logger is MANDATORY. The constructor has no default (omitting it
//     is a TypeError on the first log call), and the package logs Meta's error
//     body (`graphFetchJson`, dist:2148), the media id (dist:1328) and the
//     thread id, which carries the phone (dist:1107, 1724-1733).
//   - `initialize()` and `handleWebhook()` are never called: without a Chat
//     instance the adapter keeps no identity state, and route.ts stays the only
//     public webhook.
//
// The subclass below reaches the adapter's PROTECTED send methods
// (sendSingleTextMessage, sendInteractiveMessage, graphApiRequest) because
// only they accept an explicit recipient. The public ones (postMessage,
// addReaction, startTyping) resolve the recipient through `recipient()`, which
// reads Chat state when a Chat instance exists (dist:1094-1113) — our `to` must
// be authoritative, never a state lookup. This relies on the protected surface
// of @chat-adapter/whatsapp 4.41.0; a version bump must re-run the tests in
// this directory (the "planted chat state" test pins it).

export const OWNER_AGENT_GRAPH_ORIGIN = 'https://graph.facebook.com';

// Random per process: the adapter demands a verify token, and we never serve
// the webhook challenge through it, so no value we store may be the one.
const PROCESS_VERIFY_TOKEN = randomBytes(32).toString('hex');

// Graph ids are digit strings; anything else would be concatenated into a URL
// path unencoded (dist:1300, 1498).
const GRAPH_ID_RE = /^[0-9]{1,32}$/;

export type OwnerAgentWhatsAppErrorCode =
  | 'wa_config_missing_access_token'
  | 'wa_config_missing_app_secret'
  | 'wa_config_missing_phone_number_id'
  | 'wa_config_invalid_phone_number_id';

export class OwnerAgentWhatsAppError extends Error {
  readonly code: OwnerAgentWhatsAppErrorCode;
  constructor(code: OwnerAgentWhatsAppErrorCode) {
    super(code);
    this.name = 'OwnerAgentWhatsAppError';
    this.code = code;
  }
}

// Our config shape (WhatsAppConfig from getWhatsAppConfig, or the consumer's
// WhatsAppSender) with the phone_number_id the intake arrived on. Nullable on
// purpose: the check happens here, once.
export interface OwnerAgentWhatsAppConfig {
  accessToken: string | null | undefined;
  appSecret: string | null | undefined;
  phoneNumberId: string | null | undefined;
}

type AdapterLogger = ConstructorParameters<typeof WhatsAppAdapter>[0]['logger'];

// What the quiet logger may say. The adapter's log MESSAGES are constant
// labels, but we still map them to our own codes instead of passing them on,
// and every argument (bodies, ids, thread ids, errors) is dropped unread.
const LOG_CODES: Readonly<Record<string, string>> = {
  'WhatsApp API error': 'wa_graph_error',
  'Failed to get media URL': 'wa_media_url_failed',
  'Failed to download media': 'wa_media_download_failed',
  'Failed to upload media': 'wa_media_upload_failed',
};

export type OwnerAgentWhatsAppLogSink = (code: string) => void;

const defaultSink: OwnerAgentWhatsAppLogSink = (code) => {
  console.warn(`[owner-agent-wa] ${code}`);
};

// debug/info are dropped entirely; warn/error emit ONE code, never the args.
export function createQuietLogger(sink: OwnerAgentWhatsAppLogSink = defaultSink): AdapterLogger {
  const emit = (level: 'warn' | 'error') => (message: string) => {
    sink(LOG_CODES[message] ?? `wa_adapter_${level}`);
  };
  const logger: AdapterLogger = {
    child: () => logger,
    debug: () => {},
    info: () => {},
    warn: emit('warn'),
    error: emit('error'),
  };
  return logger;
}

function required(
  value: string | null | undefined,
  code: OwnerAgentWhatsAppErrorCode,
): string {
  if (typeof value !== 'string' || value.trim() === '') throw new OwnerAgentWhatsAppError(code);
  return value;
}

// Outbound interactive payload, as the Cloud API takes it. Mirrors the
// package's (unexported) WhatsAppInteractiveMessage for the two shapes we send.
interface InteractiveBase {
  body: { text: string };
  footer?: { text: string };
  header?: { type: 'text'; text: string };
}

export type OwnerAgentInteractive =
  | (InteractiveBase & {
      type: 'button';
      action: { buttons: Array<{ type: 'reply'; reply: { id: string; title: string } }> };
    })
  | (InteractiveBase & {
      type: 'list';
      action: {
        button: string;
        sections: Array<{
          title: string;
          rows: Array<{ id: string; title: string; description?: string }>;
        }>;
      };
    });

// The Graph response of a /messages POST, as far as we read it.
export interface GraphSendResponse {
  messages?: Array<{ id?: string | null } | null> | null;
  success?: boolean;
}

export class OwnerAgentWhatsApp extends WhatsAppAdapter {
  get businessPhoneNumberId(): string {
    return this.phoneNumberId;
  }

  private threadFor(to: string): string {
    return this.encodeThreadId({ phoneNumberId: this.phoneNumberId, userWaId: to });
  }

  // One text message, ≤ 4096 chars (the caller checks). Never the splitting
  // sendTextMessage: a chunk failing after an earlier chunk went out would be
  // reported as that chunk's error — a "not sent" for a message that partly
  // was. Body goes out verbatim (no markdown conversion), as sendWhatsAppText.
  async sendTextTo(to: string, body: string, replyToWamid?: string): Promise<string> {
    const sent = await this.sendSingleTextMessage(this.threadFor(to), to, body, replyToWamid, { to });
    return sent.id;
  }

  async sendInteractiveTo(
    to: string,
    interactive: OwnerAgentInteractive,
    replyToWamid?: string,
  ): Promise<string> {
    const sent = await this.sendInteractiveMessage(this.threadFor(to), to, interactive, replyToWamid, { to });
    return sent.id;
  }

  // emoji '' removes our reaction (Cloud API reaction-messages).
  async sendReactionTo(to: string, wamid: string, emoji: string): Promise<GraphSendResponse> {
    return this.graphApiRequest<GraphSendResponse>(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: wamid, emoji },
    });
  }

  // The media-id lookup SCOPED to our business number, exactly as
  // whatsapp-import.ts:downloadDocument does it: Meta processes
  // `?phone_number_id=` only when the media was received on that number, so a
  // forged or replayed id from another line of the WABA is refused. The
  // adapter's own lookup (dist:1300) sends no phone_number_id and no timeout,
  // which is why downloadMedia is only ever called after this passed. Lives on
  // the subclass so the token never leaves it. The fetch carries a real
  // AbortSignal, not a Promise.race.
  async lookupMediaScoped(mediaId: string, timeoutMs: number): Promise<ServerMediaRetrieveResponse> {
    const api = new WhatsAppAPI({
      token: this.accessToken,
      secure: false,
      v: GRAPH_API_VERSION,
      ponyfill: {
        fetch: (input: string | URL | Request, init?: RequestInit) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
      },
    });
    return api.retrieveMedia(mediaId, this.phoneNumberId);
  }

  // The payload of the adapter's own startTyping (dist:1743-1752) without its
  // state lookup of "the latest inbound message": we name the wamid ourselves.
  async markReadWithTyping(wamid: string): Promise<GraphSendResponse> {
    return this.graphApiRequest<GraphSendResponse>(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: wamid,
      typing_indicator: { type: 'text' },
    });
  }
}

export function createOwnerAgentWhatsApp(
  cfg: OwnerAgentWhatsAppConfig,
  opts: { logSink?: OwnerAgentWhatsAppLogSink } = {},
): OwnerAgentWhatsApp {
  const accessToken = required(cfg.accessToken, 'wa_config_missing_access_token');
  const appSecret = required(cfg.appSecret, 'wa_config_missing_app_secret');
  const phoneNumberId = required(cfg.phoneNumberId, 'wa_config_missing_phone_number_id');
  if (!GRAPH_ID_RE.test(phoneNumberId)) {
    throw new OwnerAgentWhatsAppError('wa_config_invalid_phone_number_id');
  }
  return new OwnerAgentWhatsApp({
    accessToken,
    appSecret,
    phoneNumberId,
    apiUrl: OWNER_AGENT_GRAPH_ORIGIN,
    apiVersion: GRAPH_API_VERSION,
    verifyToken: PROCESS_VERIFY_TOKEN,
    userName: 'kalfa-owner-agent',
    logger: createQuietLogger(opts.logSink),
  });
}
