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
  kind: 'submit_rsvp' | 'send_whatsapp' | 'notify_team';
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

  return {
    deps: { ledger, runs, guests, alerts },
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
    // 'several' mirrors the live rule: with more than one guest behind a phone
    // there is no answer to "whose name", so the field is empty and a template
    // greeting silently loses its name. Seeing that in a test is the point.
    guest_name: scenario.guestCase === 'one' ? 'דנה' : '',
    event_name: 'אירוע לדוגמה',
    event_date: '01.01.2027',
  };

  const outcome = await runWorkflow({
    // The run id is only ever a Map key here — no row exists and none is written.
    runId: 'dry-run',
    workflowId,
    storedDefinition,
    trigger,
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
