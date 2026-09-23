// Run a workflow for real, against nothing.
//
// The gap this closes: before this, the only way to find out what a workflow
// does was to arm it and wait for a guest to message. That is a terrible place
// to discover a mistake — the graph fires on live traffic and changes a real
// RSVP.
//
// The trick is that a dry run is NOT a second implementation. It calls the same
// `runWorkflow`, which drives the same vendored `runGraph`, through the same
// adapter and the same step handlers. Only the three ports are swapped: the
// ledger is a Map, the run store is a variable, and the guest actions RECORD
// what they were asked to do instead of doing it. So what the owner sees is what
// the graph will actually do — not a model of it that can drift.
import type { WorkflowTriggerPayload } from '../steps';

import type {
  GuestActionsPort,
  RunStatus,
  StepClaim,
  StepLedgerPort,
  RunStorePort,
  TeamAlertsPort,
  OutboundWebhookPort,
  IntegrationsPort,
  AccountingPort,
  AiAgentPort,
} from './ports';
import { runWorkflow, type RunWorkflowOutcome } from './run-workflow';

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

/**
 * How many guests sit behind the pretend contact.
 *
 * This is a real branch, not a curiosity: a phone shared by a couple backs two
 * guest rows, and `update_guest_status` refuses to guess which one a message
 * meant. An owner testing only the happy path would never see that, then wonder
 * in production why a workflow "did nothing".
 */
export const DRY_RUN_GUEST_CASES = ['one', 'none', 'several'] as const;
export type DryRunGuestCase = (typeof DRY_RUN_GUEST_CASES)[number];

export type DryRunScenario = {
  /** The text of the pretend inbound message. */
  messageText: string;
  /** The quick-reply payload, if the pretend message was a button tap. */
  buttonPayload: string;
  guestCase: DryRunGuestCase;
};

// ---------------------------------------------------------------------------
// The trace
// ---------------------------------------------------------------------------

export type DryRunStep = {
  nodeId: string;
  nodeType: string;
  status: 'completed' | 'failed';
  /** The branch the node chose, for a condition. */
  nextPort?: string;
  output?: unknown;
  errorMessage?: string;
};

/**
 * Something the workflow would have done to real data, had this not been a test.
 *
 * A closed union rather than a string: every kind here is an OUTWARD effect —
 * a guest's row changed, a message left the building — and adding one should be
 * a deliberate edit to this line, not something a new handler can do quietly.
 */
export type DryRunEffect = {
  kind:
    | 'submit_rsvp'
    | 'send_whatsapp'
    | 'notify_team'
    | 'start_rsvp_ai_callback'
    | 'webhook'
    | 'integration'
    | 'set_guest_field'
    | 'callback_request'
    /** A SUMIT document or customer that WOULD have been created. */
    | 'accounting'
    | 'ai';
  description: string;
};

export type DryRunResult = {
  outcome: RunWorkflowOutcome;
  steps: DryRunStep[];
  effects: DryRunEffect[];
  /** Nodes the graph never reached — the branch that was not taken. */
  skippedNodeIds: string[];
};

// ---------------------------------------------------------------------------
// The ports
// ---------------------------------------------------------------------------

function createRecordingPorts(scenario: DryRunScenario) {
  const steps: DryRunStep[] = [];
  const effects: DryRunEffect[] = [];
  // Only `claimStep` is told the node's type; `completeStep` and `failStep` are
  // not. Captured here so every trace line can name what ran, rather than
  // showing an id the owner has to hunt for on the canvas.
  const typeByNode = new Map<string, string>();
  const finished = new Map<string, unknown>();
  let status: RunStatus = 'pending';

  const ledger: StepLedgerPort = {
    async claimStep({ nodeId, nodeType }): Promise<StepClaim> {
      typeByNode.set(nodeId, nodeType);
      const done = finished.get(nodeId);
      if (done !== undefined) return { kind: 'already_done', result: done };
      // A dry run is single-threaded and never retried, so `in_flight` cannot
      // arise. Claiming twice inside one run would be a bug in the runner, and
      // it would surface as a duplicated trace line rather than being hidden.
      return { kind: 'claimed' };
    },

    async completeStep({ nodeId, result }) {
      finished.set(nodeId, result);
      const r = result as { output?: unknown; nextPort?: string } | undefined;
      steps.push({
        nodeId,
        nodeType: typeByNode.get(nodeId) ?? '',
        status: 'completed',
        ...(r?.nextPort ? { nextPort: r.nextPort } : {}),
        output: r?.output,
      });
    },

    async failStep({ nodeId, message }) {
      steps.push({
        nodeId,
        nodeType: typeByNode.get(nodeId) ?? '',
        status: 'failed',
        errorMessage: message,
      });
    },
  };

  const runs: RunStorePort = {
    async setRunStatus({ status: next }) {
      status = next;
    },
  };

  const guests: GuestActionsPort = {
    async startRsvpAiCallback() {
      effects.push({
        kind: 'start_rsvp_ai_callback',
        description: 'היה מפעיל שיחה חוזרת באמצעות סוכן RSVP הקולי הקיים.',
      });
      return { ok: true, status: 'dry_run' };
    },

    async getGuestsForContact() {
      // Synthetic, and deliberately so. A test must not read a real guest's
      // token: the token is the credential on their public RSVP link, and a
      // dry run is not a reason to put one in an admin's browser.
      switch (scenario.guestCase) {
        case 'none':
          return [];
        case 'several':
          return [
            { id: 'guest-a', rsvp_token: 'test-token-a' },
            { id: 'guest-b', rsvp_token: 'test-token-b' },
          ];
        case 'one':
          return [{ id: 'guest-a', rsvp_token: 'test-token-a' }];
      }
    },

    async submitRsvp(_token, input) {
      // Recorded, not performed. This is the line that makes the whole thing a
      // test rather than a live run against a guest.
      effects.push({
        kind: 'submit_rsvp',
        description: `היה מעדכן את סטטוס האורח ל־"${input.status}" (${input.adults} מבוגרים, ${input.kids} ילדים).`,
      });
      return { ok: true };
    },

    async recordRsvpFromWhatsapp() {
      // The audit marker for a change that did not happen. Nothing to record.
    },

    async setGuestField({ field, value }) {
      // Recorded, never written. The guest row is untouched by a test run.
      effects.push({
        kind: 'set_guest_field',
        description: `היה מעדכן את השדה "${field}" של האורח ל-"${value}"`,
      });
      return { ok: true, guestId: 'dry-run-guest' };
    },

    async createCallbackRequest({ topic }) {
      // Recorded, never inserted. A real row here would put a real phone call in
      // a human's queue from a button that promises no outward effect.
      effects.push({
        kind: 'callback_request',
        description: `היה יוצר בקשת חזרה בנושא "${topic}"`,
      });
      // `created: true`, because a dry run reports what the graph WOULD do.
      // Modelling the dedupe would depend on live rows from a different day.
      return { ok: true, created: true };
    },

    async sendWhatsAppReply(_contactId, body) {
      // The whole point of the dry run: the owner sees the exact text that
      // WOULD reach a guest, and no guest receives anything. Quoted in full
      // rather than summarised — a message is judged by its wording.
      effects.push({
        kind: 'send_whatsapp',
        description: `היה שולח לאורח בוואטסאפ: "${body}"`,
      });
      return { ok: true };
    },
  };

  const alerts: TeamAlertsPort = {
    async notifyTeam({ level, title, detail }) {
      // Recorded, never posted. Without this the "test" button in the editor
      // would put a real message in the team's Slack channel — an outward
      // effect from the one control that promises none.
      effects.push({
        kind: 'notify_team',
        description: `היה שולח התראה לצוות (${level}): "${title}"${detail === '' ? '' : ` — ${detail}`}`,
      });
      // `true`, because a dry run reports what the graph WOULD do. Answering
      // `false` here would model the alert layer's suppression, which depends
      // on live settings and on what was already sent today — an owner testing
      // a diagram must not see their node "skipped" for a reason that belongs
      // to a different run.
      return { sent: true };
    },
  };

  const webhook: OutboundWebhookPort = {
    async post({ url, method, headers, idempotencyKey }) {
      // NO REQUEST IS MADE. This is the whole reason the outgoing call is a port:
      // with a `fetch` in the handler, pressing "test" would POST a guest's
      // details to a third party from a control whose entire promise is that it
      // has no outward effect.
      //
      // ⚠️ HEADER VALUES ARE COUNTED, NEVER PRINTED. A dry-run trace is rendered
      // in the browser and is the most casually shared artefact this subsystem
      // produces. A value here is still `{{secrets.<NAME>}}` — the real port is
      // what substitutes — but printing values would also print whatever an
      // owner typed literally before reading the warning, and a screenshot of a
      // dry run is exactly how that reaches a group chat.
      const count = (headers ?? []).filter((h) => h?.name?.trim()).length;
      const withHeaders = count > 0 ? `, ${count} כותרות` : '';
      effects.push({
        kind: 'webhook',
        description: `היה שולח ${method ?? 'POST'} אל ${url}${withHeaders} (מפתח ייחודיות ${idempotencyKey})`,
      });
      // 200, because a dry run reports what the graph WOULD do. Modelling a
      // failure here would send an owner testing a diagram down the error branch
      // for a reason that belongs to someone else's server on a different day.
      return { ok: true, status: 200 };
    },
  };

  const integrations: IntegrationsPort = {
    async execute({ provider, capability }) {
      // NO PROVIDER REQUEST IS MADE. Connection ids and node input may identify
      // an account or contain guest data, so neither is copied into the trace.
      effects.push({
        kind: 'integration',
        description: `היה מפעיל את יכולת האינטגרציה "${capability}" אצל ${provider}`,
      });
      return { status: 200 };
    },
  };

  /**
   * ⚠️ THE STUB THAT MAKES A TEST RUN SAFE. Nothing is issued: no document
   * reaches SUMIT, no customer row is created, and the company's books are not
   * touched. It records what WOULD have happened and returns plausible ids so
   * the graph keeps routing exactly as it will in production.
   *
   * Owner decision 2026-09-22, asked explicitly: a test run must say "הייתי
   * מחייב" and do nothing. Without this stub a handler would reach the live
   * provider from the editor's own "הרצת בדיקה" button, whose panel promises
   * the opposite.
   *
   * The ids are NEGATIVE on purpose. A dry run's trace can be copied into a
   * ticket, and a positive-looking document id would be indistinguishable from
   * a real one; no SUMIT document ever carries a negative id, so nothing
   * downstream can mistake this for a document that exists.
   */
  const accounting: AccountingPort = {
    async createDocument(input) {
      effects.push({
        kind: 'accounting',
        description: `היה מפיק מסמך מסוג "${input.type}"${
          input.customerName ? ` עבור ${input.customerName}` : ''
        } — לא הופק מסמך אמיתי`,
      });
      return {
        documentId: -1,
        documentNumber: null,
        customerId: null,
        documentDownloadUrl: null,
      };
    },
    async createCustomer(input) {
      effects.push({
        kind: 'accounting',
        description: `היה יוצר לקוח בשם "${input.name}" — לא נוצר לקוח אמיתי`,
      });
      return { customerId: -1, customerHistoryUrl: null };
    },
  };

  /**
   * ⚠️ A DRY RUN NEVER REACHES A MODEL, and this is the only thing standing
   * between the editor's "הרצת בדיקה" button and a billed Claude session.
   *
   * The panel promises the run changes nothing. A model call changes nothing in
   * the database — but it costs money, takes seconds, and its answer would look
   * to the owner exactly like a real one. So the stub reports what WOULD be
   * asked and answers with a marked string rather than prose that could be
   * mistaken for the model's.
   *
   * Same shape as the accounting stub above and for the same reason: the dry run
   * swaps PORTS, so a handler that reached a model any other way would walk
   * straight past this.
   */
  const ai: AiAgentPort = {
    async run(input) {
      effects.push({
        kind: 'ai',
        description: `היה שואל את המודל (${input.model})${
          input.tools.length > 0 ? ` עם ${input.tools.length} כלים` : ' בלי כלים'
        } — לא בוצעה קריאה אמיתית`,
      });
      return {
        text: '[הרצה יבשה — המודל לא נשאל]',
        // Null, not 0: a dry run has no cost, and 0 would read as "asked and
        // it was free".
        costUsd: null,
        sessionId: null,
      };
    },
  };

  return {
    deps: { ledger, runs, guests, alerts, webhook, integrations, accounting, ai },
    steps,
    effects,
    getStatus: () => status,
  };
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

export async function dryRunWorkflow(args: {
  workflowId: string;
  storedDefinition: unknown;
  scenario: DryRunScenario;
  /** Node ids present in the graph, so the trace can name what never ran. */
  allNodeIds?: string[];
}): Promise<DryRunResult> {
  const { workflowId, storedDefinition, scenario } = args;
  const recording = createRecordingPorts(scenario);

  const trigger: WorkflowTriggerPayload = {
    // Placeholders. Nothing reads them except the synthetic guest lookup above,
    // and giving them recognisable values keeps a stray real id from appearing
    // in a trace and being mistaken for one.
    eventId: 'dry-run-event',
    contactId: 'dry-run-contact',
    message_text: scenario.messageText,
    button_payload: scenario.buttonPayload,
    // Recognisable stand-ins, for the same reason as the ids above. An owner
    // testing `שלום {{trigger.guest_name}}` must SEE the substitution happen —
    // an empty string would look identical to a broken reference, which is the
    // one thing a dry run exists to tell apart.
    //
    // 'several' mirrors the live rule exactly, down to the ABSENCE: with more
    // than one guest behind a phone there is no answer to "whose name", so the
    // key is omitted rather than emptied — which is what lets an owner's
    // `| default:'אורח יקר'` fire here just as it would in production. Emptying
    // it would make the dry run report a passing template that fails live.
    ...(scenario.guestCase === 'one' ? { guest_name: 'דנה' } : {}),
    event_name: 'אירוע לדוגמה',
    event_date: '01.01.2027',
  };

  const outcome = await runWorkflow({
    // The run id is only ever a Map key here — no row exists and none is written.
    runId: 'dry-run',
    workflowId,
    storedDefinition,
    trigger,
    // The server-injected bag, with a stand-in for the same reason the trigger
    // ids above have one: an owner writing `{{variables.app_url}}` must SEE the
    // substitution happen. A real origin here would also invite copying a live
    // link out of a test trace.
    variables: { app_url: 'https://dry-run.example' },
    deps: recording.deps,
  });

  const ranNodeIds = new Set(recording.steps.map((s) => s.nodeId));
  const skippedNodeIds = (args.allNodeIds ?? []).filter((id) => !ranNodeIds.has(id));

  return {
    outcome,
    steps: recording.steps,
    effects: recording.effects,
    skippedNodeIds,
  };
}
