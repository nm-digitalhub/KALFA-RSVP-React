'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
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
import {
  DRY_RUN_GUEST_CASES,
  type DryRunResult,
} from '@/lib/workflow/engine/dry-run';

// Thin wrappers. Every one of these calls a data-layer function that performs
// `requireAdmin()` itself — the action never becomes the authorization boundary,
// and the id arriving from the browser is not trusted by anything here.

const idSchema = z.uuid();

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
export async function testWorkflowAction(
  workflowId: string,
  scenario: unknown,
): Promise<DryRunResult> {
  const id = idSchema.parse(workflowId);
  return testWorkflow(id, scenarioSchema.parse(scenario));
}
