import 'server-only';

// Admin reads and writes for workflows. Authorization lives here, at the data
// layer, exactly as it does for channels and the rest of /admin — a Server
// Action is a thin wrapper over these, never a second gate.
import { requireAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';
import { editorDiagramSchema } from '@/lib/workflow/adapter/editor-schema';
import { toWorkflowDefinition } from '@/lib/workflow/adapter/to-definition';
import {
  dryRunWorkflow,
  type DryRunResult,
  type DryRunScenario,
} from '@/lib/workflow/engine/dry-run';

export type WorkflowSummary = {
  id: string;
  name: string;
  eventId: string | null;
  isActive: boolean;
  version: number;
  updatedAt: string;
};

export type WorkflowDetail = WorkflowSummary & {
  definition: unknown;
};

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  await requireAdmin();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('workflows')
    .select('id, name, event_id, is_active, version, updated_at')
    .order('updated_at', { ascending: false });

  if (error) throw new Error('טעינת התהליכים נכשלה');

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    eventId: row.event_id,
    isActive: row.is_active,
    version: row.version,
    updatedAt: row.updated_at,
  }));
}

export async function getWorkflow(id: string): Promise<WorkflowDetail | null> {
  await requireAdmin();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('workflows')
    .select('id, name, event_id, is_active, version, updated_at, definition')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error('טעינת התהליך נכשלה');
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    eventId: data.event_id,
    isActive: data.is_active,
    version: data.version,
    updatedAt: data.updated_at,
    definition: data.definition,
  };
}

export async function createWorkflow(name: string): Promise<string> {
  await requireAdmin();

  const trimmed = name.trim();
  if (trimmed === '') throw new Error('שם התהליך לא יכול להיות ריק');

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('workflows')
    // is_active is left at its FALSE default: a new workflow is drawn, not
    // armed. Arming is always a separate, deliberate act.
    .insert({ name: trimmed, definition: {} })
    .select('id')
    .single();

  if (error) throw new Error('יצירת התהליך נכשלה');
  return data.id;
}

/**
 * Persist the editor's diagram.
 *
 * The definition is stored VERBATIM — a re-open must reproduce the canvas the
 * owner left, including node positions and any React Flow bookkeeping we do not
 * read. It is parsed here only to establish it is the right shape; the
 * conversion to an execution model happens at run time, not at save time, so a
 * work-in-progress graph can always be saved.
 *
 * `version` is bumped on every write, including the editor's background
 * auto-saves.
 */
export async function saveWorkflowDefinition(
  id: string,
  definition: unknown,
): Promise<void> {
  await requireAdmin();

  const parsed = editorDiagramSchema.safeParse(definition);
  if (!parsed.success) throw new Error('מבנה התהליך שהתקבל אינו תקין');

  const supabase = createAdminClient();

  const current = await supabase
    .from('workflows')
    .select('version, name')
    .eq('id', id)
    .maybeSingle();

  if (current.error || !current.data) throw new Error('התהליך לא נמצא');

  const { data: updated, error } = await supabase
    .from('workflows')
    .update({
      definition: definition as Json,
      // The editor owns the name once the workflow exists — it is edited in the
      // canvas header, and the save payload carries it.
      ...(typeof parsed.data.name === 'string' && parsed.data.name.trim() !== ''
        ? { name: parsed.data.name.trim() }
        : {}),
      version: current.data.version + 1,
    })
    .eq('id', id)
    // Optimistic concurrency, and it is load-bearing rather than decorative.
    // The editor auto-saves in the background at a rate we do not control, so
    // two saves overlapping is ordinary, not exotic: both read v5, both write
    // v6, and without this the later one silently erases the earlier one's
    // nodes. With it the loser matches zero rows and throws — which the editor
    // surfaces, because the action throwing is the only way to get an error
    // snackbar out of the SDK.
    .eq('version', current.data.version)
    .select('id');

  if (error) throw new Error('שמירת התהליך נכשלה');
  if ((updated?.length ?? 0) === 0) {
    throw new Error('התהליך נערך במקביל. רעננו את הדף לפני שמירה נוספת.');
  }
}

export type ArmResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Arm or disarm a workflow.
 *
 * Arming runs the full conversion contract first and REFUSES on any error. This
 * is the one place validation is a gate rather than a report: an armed workflow
 * fires on live inbound WhatsApp, and a graph that cannot convert would produce
 * a failed run for every message a guest sends. Better to refuse the switch than
 * to fill the run log with the same error.
 *
 * Disarming is never gated — a broken workflow must always be switchable off.
 */
export async function setWorkflowActive(
  id: string,
  isActive: boolean,
): Promise<ArmResult> {
  await requireAdmin();

  const supabase = createAdminClient();

  if (isActive) {
    const workflow = await supabase
      .from('workflows')
      .select('definition')
      .eq('id', id)
      .maybeSingle();

    if (workflow.error || !workflow.data) throw new Error('התהליך לא נמצא');

    const converted = toWorkflowDefinition(id, workflow.data.definition);
    if (!converted.ok) {
      return { ok: false, errors: converted.errors.map((e) => e.message) };
    }
  }

  const { error } = await supabase
    .from('workflows')
    .update({ is_active: isActive })
    .eq('id', id);

  if (error) throw new Error('עדכון מצב התהליך נכשל');
  return { ok: true };
}

export type DeleteResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Remove a workflow.
 *
 * TWO refusals, and both are the point of the feature rather than friction.
 *
 * ARMED. A live automation is switched off before it is removed. Deleting one
 * in a single press would end an automation the owner may only have meant to
 * pause, and the disarm is already one click away.
 *
 * HAS RUNS. `workflow_runs.workflow_id` is declared `on delete restrict`, and
 * the table comment says why: "The audit record of what an automation did —
 * workflow deletion is RESTRICTed against it rather than cascading." A run
 * records that a guest's status was changed by an automation, so it outlives
 * the automation. We ask BEFORE attempting the delete rather than translating
 * a 23503 afterwards: the count is what the owner needs to hear, and Postgres's
 * error carries a constraint name instead.
 */
export async function deleteWorkflow(id: string): Promise<DeleteResult> {
  await requireAdmin();

  const supabase = createAdminClient();

  const workflow = await supabase
    .from('workflows')
    .select('is_active')
    .eq('id', id)
    .maybeSingle();

  if (workflow.error) throw new Error('קריאת התהליך נכשלה');
  if (!workflow.data) return { ok: false, errors: ['התהליך לא נמצא.'] };

  if (workflow.data.is_active) {
    return { ok: false, errors: ['התהליך פעיל. יש לכבות אותו לפני מחיקה.'] };
  }

  const runs = await supabase
    .from('workflow_runs')
    .select('id', { count: 'exact', head: true })
    .eq('workflow_id', id);

  if (runs.error) throw new Error('בדיקת ההרצות נכשלה');
  if ((runs.count ?? 0) > 0) {
    return {
      ok: false,
      errors: [
        `לתהליך יש ${runs.count} הרצות שמורות והן תיעוד של מה שהאוטומציה עשתה, ` +
          'לכן אי אפשר למחוק אותו. אפשר להשאיר אותו כבוי.',
      ],
    };
  }

  const { error } = await supabase.from('workflows').delete().eq('id', id);
  if (error) throw new Error('מחיקת התהליך נכשלה');
  return { ok: true };
}

export type CancelRunResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Cancel a run that has not started yet.
 *
 * DELIBERATELY PENDING-ONLY. The vendored `runGraph` has no cancellation seam —
 * it never polls for a cancel signal, and it cannot, because it is written to
 * be replay-deterministic (see replay-audit.md rules 1-3: no clock, no I/O, no
 * ambient state). Upstream gets cancellation from Temporal, which injects a
 * `CancelledFailure` at the next activity boundary; pg-boss has no equivalent,
 * so a run already inside `runGraph` will finish whatever it is doing.
 *
 * Offering a button that claims to stop a running graph and does not would be
 * worse than offering none. What this does stop is the gap between enqueue and
 * pickup, which for a queued backlog is the window that matters.
 *
 * The status filter is the whole concurrency story: the update matches only
 * while the row is still `pending`, so a worker that claimed the job first
 * simply leaves zero rows matched, and `handleWorkflowRun` refuses to execute a
 * run whose status is no longer pending or running.
 */
export async function cancelRun(runId: string): Promise<CancelRunResult> {
  await requireAdmin();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('workflow_runs')
    .update({ status: 'cancelled', finished_at: new Date().toISOString() })
    .eq('id', runId)
    .eq('status', 'pending')
    .select('id');

  if (error) throw new Error('ביטול ההרצה נכשל');
  if ((data ?? []).length === 0) {
    return {
      ok: false,
      errors: ['ההרצה כבר יצאה לדרך או הסתיימה, ולא ניתן לבטל אותה.'],
    };
  }
  return { ok: true };
}

/**
 * Run a workflow against nothing, and report what it would have done.
 *
 * The definition is read from the row, so a test always describes what is
 * SAVED — not whatever is on the canvas unsaved. The reference app does the
 * opposite (it POSTs the live canvas), which is right for a design toy and
 * wrong here: the thing an owner needs to trust before arming is the stored
 * definition, because that is the one that will fire on a guest's message.
 */
export async function testWorkflow(
  id: string,
  scenario: DryRunScenario,
): Promise<DryRunResult> {
  await requireAdmin();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('workflows')
    .select('definition')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) throw new Error('התהליך לא נמצא');

  const parsed = editorDiagramSchema.safeParse(data.definition);
  const allNodeIds = parsed.success ? parsed.data.nodes.map((n) => n.id) : [];

  return dryRunWorkflow({
    workflowId: id,
    storedDefinition: data.definition,
    scenario,
    allNodeIds,
  });
}

export type RunSummary = {
  id: string;
  status: string;
  triggerSource: string;
  createdAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
};

/** The execution record for one workflow, newest first. */
export async function listWorkflowRuns(
  workflowId: string,
  limit = 50,
): Promise<RunSummary[]> {
  await requireAdmin();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('workflow_runs')
    .select('id, status, trigger_source, created_at, finished_at, error_message')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error('טעינת ההרצות נכשלה');

  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    triggerSource: row.trigger_source,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
  }));
}
