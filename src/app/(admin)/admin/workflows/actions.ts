'use server';

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
