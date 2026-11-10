import 'server-only';

import { randomUUID } from 'node:crypto';

import type { NextResponse } from 'next/server';
import { z } from 'zod';

import type { RouteStep } from '@/lib/console-calls/route-auth';
import {
  getConsoleCallById,
  getConsoleCallSessionUrls,
  LIVE_CUSTOMER_CALL_KINDS,
  resolveExternalDialTarget,
  resolveTransferTarget,
  type ConsoleCallSummary,
} from '@/lib/data/console-calls';
import { noStoreJson } from '@/lib/http/no-store-json';
import { readJsonBody } from '@/lib/http/read-json-body';
import { consoleEmptyActionBodySchema } from '@/lib/validation/console-calls';
import {
  pickSessionUrl,
  postCommandToSession,
  type SessionCommandEnvelope,
} from '@/lib/voximplant/session-command';

// The steps the live-call command routes share (/api/console-calls/{id}/transfer, /consult, /consult/cancel,
// /consult/complete, /conference, /conference/remove). Each step returns either its value or the exact response
// the route must return, so a route reads as its own ordered list of checks.
//
// AUTHORIZATION IS NOT HERE. Every one of these routes runs requireManageVoiceAgent first; these steps assume it
// already passed.
//
// What a route still owns, because it differs per action: the wording of its refusals, its body schema, its
// command name, its audit record and its 202 body.

const uuidSchema = z.uuid();
const INVALID_BODY = 'גוף הבקשה אינו תקין';

/** 400 for a call id (console_calls or call_attempts) in the URL that is not a UUID; null when it is one. */
export function invalidCallIdResponse(callId: string): NextResponse | null {
  return uuidSchema.safeParse(callId).success ? null : noStoreJson({ error: 'מזהה שיחה לא תקין' }, 400);
}

/**
 * The console_calls row a mid-call command may act on: it exists (404), is a customer call (409 with the route's
 * own wording — never ai_handoff/internal), and is bridged right now (409). Only a 'connected' call has anything
 * for the scenario's own guard to act on; the scenario silently drops the command otherwise, so gating here keeps
 * the route's 202 honest.
 */
export async function loadConnectedCustomerCall(
  callId: string,
  wrongKindError: string,
): Promise<RouteStep<{ call: ConsoleCallSummary }>> {
  const call = await getConsoleCallById(callId);
  if (!call) return { ok: false, response: noStoreJson({ error: 'שיחה לא נמצאה' }, 404) };
  if (!LIVE_CUSTOMER_CALL_KINDS.has(call.kind)) {
    return { ok: false, response: noStoreJson({ error: wrongKindError }, 409) };
  }
  if (call.status !== 'connected') {
    return { ok: false, response: noStoreJson({ error: 'השיחה אינה מחוברת כעת' }, 409) };
  }
  return { ok: true, call };
}

/** What a resolved target contributes to the command, to the audit record and to the 202 body. */
export interface ResolvedCallTarget {
  /** The scenario's command payload. Never built from a client-supplied Voximplant identity. */
  payload: { vox_username: string } | { phone: string };
  /** Identifiers only: the agent id, or the fact that the leg went outside. The number is never recorded. */
  audit: { toAgentId: string } | { externalTarget: true };
  /** The KIND of target accepted. The phone number is never echoed back. */
  accepted: { target: 'agent'; to_agent_id: string } | { target: 'external' };
}

/**
 * An agent named by id becomes a routable vox_username (provisioned + ready, never the requester). Any refusal is
 * a 409; `selfError` is the route's wording for naming yourself.
 */
export async function resolveAgentCallTarget(
  toAgentId: string,
  requestingAgentId: string,
  selfError: string,
): Promise<RouteStep<{ target: ResolvedCallTarget & { payload: { vox_username: string } } }>> {
  const resolved = await resolveTransferTarget(toAgentId, requestingAgentId);
  if (!resolved.ok) {
    const messages: Record<typeof resolved.reason, string> = {
      self: selfError,
      not_found: 'הנציג המבוקש לא נמצא',
      not_provisioned: 'לנציג המבוקש אין זהות טלפוניה במוקד',
      not_ready: 'הנציג המבוקש אינו זמין כעת',
    };
    return { ok: false, response: noStoreJson({ error: messages[resolved.reason] }, 409) };
  }
  return {
    ok: true,
    target: {
      payload: { vox_username: resolved.voxUsername },
      audit: { toAgentId },
      accepted: { target: 'agent', to_agent_id: toAgentId },
    },
  };
}

/**
 * The target of a consult or a conference: an agent (resolveAgentCallTarget) or an outside number cleared by
 * resolveExternalDialTarget (E.164 + country allowlist + per-agent rate limit + DNC — see its kdoc for the order).
 * Two authorities, and neither trusts the browser with a Voximplant identity or a dialable number.
 *
 * An outside number refused for the rate limit is 429, so a client can tell "wait" from "this will never work";
 * every other refusal is 409.
 */
export async function resolveCallTarget(
  body: { to_agent_id: string } | { to_phone: string },
  requestingAgentId: string,
  selfError: string,
): Promise<RouteStep<{ target: ResolvedCallTarget }>> {
  if ('to_agent_id' in body) {
    return resolveAgentCallTarget(body.to_agent_id, requestingAgentId, selfError);
  }

  const external = await resolveExternalDialTarget(body.to_phone, requestingAgentId);
  if (!external.ok) {
    const messages: Record<typeof external.reason, string> = {
      invalid: 'מספר הטלפון אינו תקין',
      not_allowed_country: 'ניתן לחייג למספרים ישראליים בלבד',
      dnc: 'המספר מופיע ברשימת החסומים',
      rate_limited: 'בוצעו יותר מדי חיוגים החוצה. נסו שוב בעוד זמן מה.',
    };
    return {
      ok: false,
      response: noStoreJson(
        { error: messages[external.reason] },
        external.reason === 'rate_limited' ? 429 : 409,
      ),
    };
  }
  return {
    ok: true,
    target: {
      payload: { phone: external.phone },
      audit: { externalTarget: true },
      accepted: { target: 'external' },
    },
  };
}

export interface CommandDeliveryErrors {
  /** 409: the call has no usable session handle. */
  unavailable: string;
  /** 502: the session did not accept the command. */
  undelivered: string;
}

/**
 * Posts `{command, request_id, payload}` to the call's live VoxEngine session (HTTPS handle preferred) under a
 * fresh request id. Success means DELIVERED, never "applied" — the scenario reports the outcome out-of-band.
 */
export async function deliverConsoleCallCommand(
  callId: string,
  command: string,
  payload: Record<string, unknown>,
  errors: CommandDeliveryErrors,
): Promise<RouteStep<{ requestId: string }>> {
  const sessionUrls = await getConsoleCallSessionUrls(callId);
  const sessionUrl = pickSessionUrl(
    sessionUrls?.secureSessionUrl ?? null,
    sessionUrls?.sessionUrl ?? null,
  );
  if (!sessionUrl) return { ok: false, response: noStoreJson({ error: errors.unavailable }, 409) };

  const requestId = randomUUID();
  const envelope: SessionCommandEnvelope = { command, request_id: requestId, payload };

  const delivery = await postCommandToSession(sessionUrl, envelope);
  if (!delivery.delivered) {
    return { ok: false, response: noStoreJson({ error: errors.undelivered }, 502) };
  }
  return { ok: true, requestId };
}

/** The body cap of the three routes that take no parameters. */
const PARAMETERLESS_MAX_BODY_BYTES = 256;

export interface ParameterlessCallCommand {
  /** The scenario command, sent with an empty payload. */
  command: string;
  /** 409 wording when the call is not a customer call. */
  wrongKindError: string;
  /** 502 wording when the session did not accept the command. */
  undeliveredError: string;
  /** The audit record for this action. Runs only after a delivered command. */
  audit: (entry: {
    fromAgentId: string;
    consoleCallId: string;
    eventId: string | null;
    requestId: string;
  }) => Promise<void>;
  /** The flag the 202 body carries next to request_id, e.g. 'cancelling'. */
  acceptedFlag: string;
}

/**
 * Everything after authorization for a command that names no target (consult/cancel, consult/complete,
 * conference/remove): the scenario acts on whatever consult or conference it already has in flight, so the route
 * only delivers. An empty body is accepted as `{}`; any field in it is a 400.
 *
 * Deliberately no pre-check of console_calls for an in-flight consult or conference: that state can already be
 * stale when the command lands, and the scenario's own guard makes a stray command a logged no-op.
 */
export async function deliverParameterlessCallCommand(
  request: Request,
  callId: string,
  requestingAgentId: string,
  action: ParameterlessCallCommand,
): Promise<NextResponse> {
  const badId = invalidCallIdResponse(callId);
  if (badId) return badId;

  const read = await readJsonBody(request, {
    maxSize: PARAMETERLESS_MAX_BODY_BYTES,
    measure: 'utf8-bytes',
    emptyAsObject: true,
  });
  if (!read.ok) return read.response;
  if (!consoleEmptyActionBodySchema.safeParse(read.value).success) {
    return noStoreJson({ error: INVALID_BODY }, 400);
  }

  const loaded = await loadConnectedCustomerCall(callId, action.wrongKindError);
  if (!loaded.ok) return loaded.response;

  const delivery = await deliverConsoleCallCommand(
    callId,
    action.command,
    {},
    { unavailable: 'השיחה אינה זמינה כעת', undelivered: action.undeliveredError },
  );
  if (!delivery.ok) return delivery.response;

  await action.audit({
    fromAgentId: requestingAgentId,
    consoleCallId: callId,
    eventId: loaded.call.eventId,
    requestId: delivery.requestId,
  });

  return noStoreJson({ [action.acceptedFlag]: true, request_id: delivery.requestId }, 202);
}
