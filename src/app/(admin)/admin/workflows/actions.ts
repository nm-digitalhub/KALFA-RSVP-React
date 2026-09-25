'use server';

import { randomBytes } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  listContactsForManualRun,
  listEventsForManualRun,
  type ManualRunContact,
  type ManualRunEvent,
  type ArmResult,
  type CancelRunResult,
  type DeleteResult,
  cancelRun,
  createWorkflow,
  deleteWorkflow,
  saveWorkflowDefinition,
  setWorkflowActive,
  testWorkflow,
} from '@/lib/data/admin/workflows';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { listVoximplantRules } from '@/lib/data/admin/voximplant-channel';
import { listElevenLabsAgents } from '@/lib/data/admin/elevenlabs-agents';
import {
  listSumitFoldersForEditor,
  listSumitViewsForEditor,
  registerSumitTrigger,
  type SumitListResult,
  type SumitRegisterResult,
} from '@/lib/data/admin/sumit-trigger-subscriptions';
import { logActivity } from '@/lib/data/activity';
import { startManualRun, type ManualRunResult } from '@/lib/workflow/manual-run';
import {
  DRY_RUN_GUEST_CASES,
  type DryRunResult,
} from '@/lib/workflow/engine/dry-run';

// Thin wrappers. Every one of these calls a data-layer function that performs
// `requireAdmin()` itself — the action never becomes the authorization boundary,
// and the id arriving from the browser is not trusted by anything here.

const idSchema = z.uuid();

// Free text, capped rather than constrained: these two stand in for whatever a
// guest would have sent, and the point of a manual start is to be able to try
// the thing that has not happened yet.
const manualRunSchema = z.object({
  eventId: z.uuid(),
  contactId: z.uuid(),
  messageText: z.string().max(4096).optional(),
  buttonPayload: z.string().max(256).optional(),
});

export async function createWorkflowAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '');
  const id = await createWorkflow(name);
  revalidatePath('/admin/workflows');
  redirect(`/admin/workflows/${id}`);
}

/**
 * The editor's save callback.
 *
 * THROWS on failure and returns nothing on success. That is not incidental: the
 * SDK's snackbar treats every non-empty resolution of `onDataSave` as success,
 * including the literal string `'error'`, so the only way to tell the owner a
 * save failed is to throw. See the comment in workflow-editor.tsx.
 */
export async function saveWorkflowAction(
  workflowId: string,
  definition: unknown,
): Promise<void> {
  const id = idSchema.parse(workflowId);
  await saveWorkflowDefinition(id, definition);
  // Not revalidated. The editor holds the canvas state and a refresh mid-edit
  // would fight the auto-save; the list page re-reads on its own navigation.
}

export async function setWorkflowActiveAction(
  formData: FormData,
): Promise<ArmResult> {
  const id = idSchema.parse(String(formData.get('id') ?? ''));
  const isActive = String(formData.get('isActive') ?? '') === 'true';

  const result = await setWorkflowActive(id, isActive);
  revalidatePath('/admin/workflows');
  revalidatePath(`/admin/workflows/${id}`);
  return result;
}

/**
 * Delete a workflow.
 *
 * Returns the refusal rather than throwing it: "armed" and "has runs" are
 * ordinary answers the owner needs to read, not failures. Only an unexpected
 * database error throws.
 */
export async function deleteWorkflowAction(formData: FormData): Promise<DeleteResult> {
  const id = idSchema.parse(String(formData.get('id') ?? ''));
  const result = await deleteWorkflow(id);
  if (result.ok) revalidatePath('/admin/workflows');
  return result;
}

/** Cancel a run that has not been picked up yet. */
export async function cancelRunAction(formData: FormData): Promise<CancelRunResult> {
  const workflowId = idSchema.parse(String(formData.get('workflowId') ?? ''));
  const runId = idSchema.parse(String(formData.get('runId') ?? ''));

  const result = await cancelRun(runId);
  // Revalidated even on refusal: a refusal means the row moved on without the
  // page noticing, so the table is stale either way.
  revalidatePath(`/admin/workflows/${workflowId}`);
  return result;
}

const scenarioSchema = z.object({
  messageText: z.string().max(4096),
  buttonPayload: z.string().max(256),
  guestCase: z.enum(DRY_RUN_GUEST_CASES),
});

/**
 * Run the saved workflow against nothing and return the trace.
 *
 * Nothing is revalidated: a test writes no row, changes no guest, and leaves no
 * run in the history. That is the point of it.
 */
/**
 * Start a REAL run, because a person asked.
 *
 * The ONE action in this file that carries its own gate, and deliberately so.
 * Everywhere else the rule holds — the data layer gates, the action is a thin
 * wrapper — but `startManualRun` is domain logic in `src/lib/workflow/`, not a
 * DAL function, so nothing below it would check anything.
 *
 * Unlike `testWorkflowAction` this DOES have side effects: the run is executed
 * by the worker with the real ports, so a `send_whatsapp` node sends and a
 * `start_rsvp_ai_callback` node dials. The panel that calls it says so, names
 * the person, and asks for a confirmation first.
 */
export async function startManualRunAction(
  workflowId: string,
  input: unknown,
): Promise<ManualRunResult> {
  const id = idSchema.parse(workflowId);
  const parsed = manualRunSchema.parse(input);

  // BOTH permissions, and that is the point.
  //
  // This one action reads a guest's identity AND dials their phone, so neither
  // half should be enough on its own: `view_customer_data` without
  // `manage_voice` must not become a way to place calls, and `manage_voice`
  // without `view_customer_data` must not become a way to enumerate guests.
  // `requireAdmin()` — which this used to call — is neither; it is the coarse
  // `has_role('admin')` flag that `support_agent` and `auditor` also carry.
  await requirePlatformPermission('view_customer_data');
  await requirePlatformPermission('manage_voice');

  const result = await startManualRun({
    workflowId: id,
    eventId: parsed.eventId,
    contactId: parsed.contactId,
    messageText: parsed.messageText,
    buttonPayload: parsed.buttonPayload,
  });

  // AUDITED. A workflow run started by a person can send a message and place a
  // call, and until now it left no trace at all — while flipping a cookie-consent
  // switch did (`admin.cookie_consent.master_toggled`). The contact id is
  // recorded, never the phone or the name: the id is enough to answer "who was
  // called" from the event's own records, and `logActivity` is not a place for
  // guest PII.
  try {
    await logActivity({
      action: 'admin.workflow.manual_run',
      meta: {
        workflowId: id,
        eventId: parsed.eventId,
        contactId: parsed.contactId,
        outcome: result.ok ? 'started' : result.reason,
        ...(result.ok ? { runId: result.runId } : {}),
      },
    });
  } catch {
    // Audit only — never fails a run the worker has already been handed.
  }

  // The run row exists now; the runs list on the page is stale.
  revalidatePath(`/admin/workflows/${id}`);
  return result;
}

/** Events a manual run may target. Thin wrapper; the loader carries the gate. */
export async function listManualRunEventsAction(): Promise<ManualRunEvent[]> {
  return listEventsForManualRun();
}

/** Contacts of one event, with the guest names behind each phone. */
export async function listManualRunContactsAction(
  eventId: unknown,
): Promise<ManualRunContact[]> {
  return listContactsForManualRun(idSchema.parse(eventId));
}

export async function testWorkflowAction(
  workflowId: string,
  scenario: unknown,
): Promise<DryRunResult> {
  const id = idSchema.parse(workflowId);
  return testWorkflow(id, scenarioSchema.parse(scenario));
}

/**
 * Mint a token for a `trigger.webhook` node.
 *
 * SERVER-SIDE, and that is the only reason this action exists: the palette runs
 * in the browser, and a token minted there is one whose entropy nobody audited.
 * 256 bits from the platform CSPRNG, hex-encoded so it survives a URL path
 * segment untouched.
 *
 * It does not save anything — the owner pastes it into the node and saves the
 * diagram like any other edit. Generating and storing in one step would mean a
 * click silently rewrote a live endpoint's address.
 */
export async function generateWebhookTokenAction(): Promise<string> {
  await requirePlatformPermission('manage_settings');
  return randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// The call node's live dial lists
// ---------------------------------------------------------------------------

/**
 * The rules and agents the voice-call node may be pointed at.
 *
 * ⚠️ ON DEMAND, NOT ON RENDER — the same rule the Voximplant rule field on
 * /admin/integrations already follows, and for the same reason it gives: these
 * are unbounded-latency external dependencies, and this page must open when
 * Voximplant or ElevenLabs is unreachable. Nothing is fetched until an operator
 * asks; until then the node's dropdowns offer only their blank defaults, which
 * mean "the rule configured for the purpose" and "the agent configured in the
 * scenario" — exactly what dialled before these fields existed.
 *
 * ⚠️ ONE ACTION FOR BOTH LISTS, and one failure per list. They come from two
 * unrelated vendors; a Voximplant outage must not hide the agents, and a missing
 * ElevenLabs key must not hide the rules. So each half carries its own message
 * and the caller renders whichever half arrived.
 *
 * Caller ids are deliberately absent: they are rows in `provider_numbers`, read
 * with the page itself like the WhatsApp numbers beside them, and a database
 * read is not the thing this deferral exists to avoid.
 */
export type VoiceDialListsResult = {
  rules: { ok: true; items: Array<{ value: string; label: string }> } | { ok: false; message: string };
  agents: { ok: true; items: Array<{ value: string; label: string }> } | { ok: false; message: string };
};

export async function loadVoiceDialListsAction(): Promise<VoiceDialListsResult> {
  // The permission is re-checked inside each reader; this one fails fast so a
  // caller without it never reaches either vendor.
  await requirePlatformPermission('manage_voice');

  // Sequential, not parallel, and on purpose: `listVoximplantRules` walks the
  // account's applications one GetRules at a time, and the platform caps an
  // account at 3 concurrent HTTP requests. Racing the ElevenLabs read against
  // that walk buys nothing and spends a slot.
  const rulesRes = await listVoximplantRules();
  const agentsRes = await listElevenLabsAgents();

  return {
    rules: rulesRes.ok
      ? {
          ok: true,
          items: rulesRes.rules.map((r) => ({
            value: r.ruleId,
            // The scenario names are the half that matters — a rule id says
            // nothing about what will answer, and the whole reason this field
            // is a list is that a bare id is unverifiable by eye.
            label: `${r.ruleName} — ${r.scenarios.length ? r.scenarios.join(' + ') : 'ללא תרחיש'}`,
          })),
        }
      : { ok: false, message: rulesRes.message },
    agents: agentsRes.ok
      ? { ok: true, items: agentsRes.agents.map((a) => ({ value: a.agentId, label: a.name })) }
      : { ok: false, message: agentsRes.message },
  };
}

// ---------------------------------------------------------------------------
// The SUMIT trigger node: folder / view lists and "רישום ב-SUMIT"
// ---------------------------------------------------------------------------
//
// Thin wrappers, like the rest of this file: each data function checks
// `manage_settings` itself. Loaded on demand, never on render — the editor must
// open when SUMIT is unreachable.

export async function loadSumitFoldersAction(): Promise<SumitListResult> {
  return listSumitFoldersForEditor();
}

export async function loadSumitViewsAction(folderId: unknown): Promise<SumitListResult> {
  return listSumitViewsForEditor(z.string().regex(/^\d{1,19}$/).parse(folderId));
}

const registerSumitSchema = z.object({
  workflowId: z.uuid(),
  nodeId: z.string().min(1).max(200),
  url: z.url().max(2048),
});

/**
 * Register the address just minted for a SUMIT trigger node. The URL is
 * re-checked against the SAVED diagram inside `registerSumitTrigger` — the
 * browser's word for it is not enough, because SUMIT will POST card data there.
 */
export async function registerSumitTriggerAction(input: unknown): Promise<SumitRegisterResult> {
  const parsed = registerSumitSchema.parse(input);
  const result = await registerSumitTrigger(parsed.workflowId, parsed.nodeId, parsed.url);
  revalidatePath(`/admin/workflows/${parsed.workflowId}`);
  return result;
}
