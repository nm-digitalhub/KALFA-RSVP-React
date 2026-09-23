import 'server-only';

// Admin reads and writes for workflows. Authorization lives here, at the data
// layer, exactly as it does for channels and the rest of /admin — a Server
// Action is a thin wrapper over these, never a second gate.
//
// EVERY function gates on a NAMED PLATFORM PERMISSION, not on requireAdmin().
//
// It used to gate on `requireAdmin()` alone — the coarse `has_role('admin')`
// flag, which is a DIFFERENT axis from the platform-permission matrix and is
// held by anyone with the admin role. That was measured on 2026-09-10 and it is
// the widest possible staff gate: `support_agent` and `auditor` — roles built
// deliberately WITHOUT `manage_voice` and WITHOUT `campaigns.runstate` — would
// have been able to arm an automation and place a real call to a guest.
//
// The split follows what each function actually does, not which page it serves:
//
//   configuration (create/save/arm/delete/cancel/dry-run/list) → manage_settings
//   reads that return GUEST NAMES (the manual-run pickers)     → view_customer_data
//   starting a real run (startManualRun, in manual-run.ts)     → view_customer_data
//                                                              + manage_voice
//
// The last one requires BOTH on purpose: it reads a guest's identity AND dials a
// phone, so neither permission alone should be enough. `voice-ops.ts` already
// requires manage_voice + view_recordings merely to LOOK at call history; it
// would be incoherent for placing a call to ask for less.
import { requirePlatformPermission } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';
import { assignRole } from '@/lib/data/admin/integrations/provider-numbers';
import { editorDiagramSchema } from '@/lib/workflow/adapter/editor-schema';
import { OWNER_WHATSAPP_MESSAGE_KINDS } from '@/lib/workflow/catalogue/types';
import { matchesKind } from '@/lib/workflow/trigger';
import { toWorkflowDefinition } from '@/lib/workflow/adapter/to-definition';
import { findArmBlockers } from '@/lib/workflow/catalogue/arm-check';
import { findVoiceDialBlockers } from '@/lib/data/admin/voice-node-arm-check';
import { runsFingerprint, RUNS_WINDOW } from '@/lib/workflow/runs-fingerprint';
import { sumitCardOutputFromSample } from '@/lib/workflow/catalogue/sumit-sample-output';
import type { SumitCardOutput } from '@/lib/workflow/catalogue/sumit-card-output';
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
  await requirePlatformPermission('manage_settings');

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
  await requirePlatformPermission('manage_settings');

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
  await requirePlatformPermission('manage_settings');

  const trimmed = name.trim();
  if (trimmed === '') throw new Error('שם התהליך לא יכול להיות ריק');

  const supabase = createAdminClient();

  // ⚠️ A DOUBLE SUBMIT MUST NOT LEAVE A SECOND EMPTY WORKFLOW BEHIND.
  // MEASURED 2026-09-10: fifteen rows named "Hhh"/"Hhhjj" created between
  // 04:29:27 and 04:29:44 — seventeen seconds. The create form used a bare
  // submit button, so it stayed clickable for the whole round-trip and every
  // further click was another INSERT. The button is now pending-aware, but a
  // disabled button cannot stop a genuine double POST (Enter pressed twice, a
  // proxy retry, a refresh of the POST), and this is a table an admin then has
  // to clean by hand.
  //
  // So: an UNTOUCHED workflow of the same name created seconds ago is the same
  // click, and its id is returned instead of inserting beside it. Deliberately
  // narrow — `definition->nodes` absent means nobody has saved a diagram yet,
  // and the 60-second window means a draft from last week with the same name is
  // never silently reused.
  const { data: recent } = await supabase
    .from('workflows')
    .select('id, definition, created_at')
    .eq('name', trimmed)
    .gte('created_at', new Date(Date.now() - 60_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  const candidate = recent?.[0];
  if (candidate && !Array.isArray((candidate.definition as { nodes?: unknown })?.nodes)) {
    return candidate.id;
  }

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
  await requirePlatformPermission('manage_settings');

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

export type ArmResult =
  | {
      ok: true;
      /**
       * Something the arming did BESIDES arming, in Hebrew, for the admin to read.
       *
       * Today there is exactly one: claiming the `whatsapp_import_sender` role for
       * the number a guest-list trigger is pinned to. A side effect on
       * account-wide routing must never be silent — see `claimImportRole`.
       */
      notice?: string;
    }
  | { ok: false; errors: string[] };

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
  await requirePlatformPermission('manage_settings');

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

    // ⚠️ AND THEN: is it CONFIGURED? Conversion proves the graph can run; it does
    // not prove every step was filled in. `action.start_for_each_guest` with no
    // target converts cleanly and then throws on Sunday at 10:00 — an owner who
    // pressed "arm" learns from a failed run hours later, if at all.
    //
    // Deliberately a SECOND gate rather than part of the converter: a starter
    // template ships with blanks on purpose and must stay loadable and saveable.
    // Only arming demands they be filled.
    const blockers = findArmBlockers(workflow.data.definition, id);
    if (blockers.length > 0) return { ok: false, errors: blockers };

    // ⚠️ AND THEN THE ONE QUESTION A PURE FUNCTION CANNOT ANSWER: is the voice
    // agent each call node names still there, still on, and still reachable by
    // some rule? That is a fact about `voice_purposes`, which is why it is a
    // second pass with a database behind it rather than another branch above.
    //
    // Reported together with, not instead of, the structural blockers — an owner
    // fixing one blank should see all of them, not discover a second after
    // pressing arm again.
    const dialBlockers = await findVoiceDialBlockers(workflow.data.definition);
    if (dialBlockers.length > 0) return { ok: false, errors: dialBlockers };

    const { error: armError } = await supabase
      .from('workflows')
      .update({ is_active: true })
      .eq('id', id);
    if (armError) throw new Error('עדכון מצב התהליך נכשל');

    // AFTER the workflow is armed, and deliberately in that order: claiming the
    // role is a convenience, and a failure in it must not leave the owner with a
    // workflow they pressed "arm" on that is not armed.
    const notice = await claimImportRole(workflow.data.definition);
    return notice ? { ok: true, notice } : { ok: true };
  }

  const { error } = await supabase
    .from('workflows')
    .update({ is_active: isActive })
    .eq('id', id);

  if (error) throw new Error('עדכון מצב התהליך נכשל');
  return { ok: true };
}

/**
 * Give the `whatsapp_import_sender` role to the number a guest-list trigger names.
 *
 * ⚠️ OWNER'S RULING 2026-09-13, and it overrides my own objection, which is worth
 * recording because it was not baseless: this role is ACCOUNT-WIDE routing, and a
 * single workflow silently repurposing a number for every other flow is a real
 * hazard. The owner's counter is stronger — he pinned the trigger to a number and
 * ticked "files and contact cards", which IS the statement of intent, and making
 * him repeat it in a second screen is the system failing to join two things it
 * already knows.
 *
 * THREE RULES KEEP IT HONEST:
 *
 *   1. ON ARM, never on save. Arming is the deliberate act, and it already takes
 *      `manage_settings` — the same permission `assignRole` requires for this
 *      role, so the caller is authorised for exactly this.
 *   2. IT NEVER STEALS. If another number already holds the role, this does
 *      nothing and says so. Displacing an account-wide assignment because someone
 *      armed a second workflow is the surprise the objection was about.
 *   3. IT IS NEVER SILENT. The notice reaches the admin, because assigning it
 *      changes how EVERY inbound message routes: a message arriving on any number
 *      that is neither the RSVP line nor this one becomes 'unknown' — alerted and
 *      not processed. That is a consequence someone has to be told about.
 *
 * Returns the sentence to show, or null when there was nothing to do. NEVER
 * throws: the workflow is already armed by the time this runs.
 */
async function claimImportRole(definition: unknown): Promise<string | null> {
  try {
    const parsed = editorDiagramSchema.safeParse(definition);
    if (!parsed.success) return null;

    const trigger = parsed.data.nodes.find(
      (n) => n.data.type === 'trigger.whatsapp_inbound',
    );
    if (!trigger) return null;

    // Only a trigger that actually asks for lists. A workflow pinned to a number
    // for ordinary guest replies must not claim the import role.
    if (!acceptsOwnerListKinds(trigger.data.properties?.messageKinds)) return null;

    const providerRef = trigger.data.properties?.phoneNumberId;
    if (typeof providerRef !== 'string' || providerRef.trim() === '') return null;

    const supabase = createAdminClient();

    const { data: target } = await supabase
      .from('provider_numbers')
      .select('id, e164, is_active')
      .eq('provider', 'meta_whatsapp')
      .eq('provider_ref', providerRef)
      .maybeSingle();
    // An inactive number must not take over routing — `resolveNumberForRole`
    // would answer null for it anyway, so the assignment would be inert and the
    // notice would be a lie.
    if (!target || !target.is_active) return null;

    const { data: held } = await supabase
      .from('provider_number_roles')
      .select('number_id')
      .eq('role', 'whatsapp_import_sender')
      .maybeSingle();

    if (held?.number_id === target.id) return null; // already ours, nothing to say
    if (held) {
      // RULE 2. Someone else holds it; say so rather than taking it.
      return 'שימו לב: תפקיד קליטת הרשימות כבר משויך למספר אחר, ולכן לא שונה. אם התהליך הזה אמור לקלוט — שנו את השיוך ב-/admin/integrations/numbers.';
    }

    await assignRole('whatsapp_import_sender', target.id);
    return `המספר ${target.e164 ?? providerRef} שויך לתפקיד קליטת רשימות אורחים. מעכשיו הודעות שמגיעות למספר שאינו זה ואינו מספר ה-RSVP לא יעובדו — תקבלו התראה על כל אחת כזו.`;
  } catch {
    // The workflow is armed. A role that could not be claimed is a message the
    // admin does not get, never a failed arming.
    return null;
  }
}

/** Does this trigger ask for the kinds only an OWNER sends — a file or contact cards? */
function acceptsOwnerListKinds(configured: unknown): boolean {
  return OWNER_WHATSAPP_MESSAGE_KINDS.some((kind) => matchesKind(configured, kind));
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
  await requirePlatformPermission('manage_settings');

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
  await requirePlatformPermission('manage_settings');

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('workflow_runs')
    // `resume_at` is cleared with the status: it means "wake me then", and a
    // cancelled run is never waking. Leaving it would also leave the row in the
    // partial index the stuck-run sweep reads.
    .update({ status: 'cancelled', finished_at: new Date().toISOString(), resume_at: null })
    .eq('id', runId)
    // ⚠️ 'waiting' TOO, and the original reasoning is exactly why it is safe.
    // The note above says a run cannot be stopped "once it is inside runGraph" —
    // a PARKED run is not inside runGraph. It is a row with a deadline and a
    // pg-boss job that has not fired, doing nothing at all. With
    // `logic.wait` allowing up to a year, refusing to cancel it meant an owner
    // could watch a run they no longer wanted and have no way to stop it:
    // disarming the workflow does not touch runs already in flight.
    //
    // Nothing else is needed to make it stick. When the wake-up job does fire,
    // `handleWorkflowRun` reloads the row, sees a status that is not
    // pending/running/waiting, and skips — the same gate that already protects a
    // redelivered terminal run.
    .in('status', ['pending', 'waiting'])
    .select('id');

  if (error) throw new Error('ביטול ההרצה נכשל');
  if ((data ?? []).length === 0) {
    return {
      ok: false,
      errors: ['ההרצה כבר רצה או הסתיימה, ולא ניתן לבטל אותה.'],
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
  await requirePlatformPermission('manage_settings');

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

/**
 * The SUMIT trigger's picker fields, read off this workflow's latest SUMIT call.
 *
 * Returns KEYS AND TYPES ONLY — `sumitCardOutputFromSample` drops every value,
 * because the stored body carries a customer's name and card digits and the
 * editor needs only the shape. Same gate as the run list on the same page.
 *
 * `null` means "keep the fixed list": no SUMIT call yet, none of the recent
 * webhook runs is a SUMIT card (a `trigger.webhook` run shares the source), or
 * the read failed. ⚠️ A failed read is deliberately NOT thrown — the fields are
 * a convenience on an editor that must still open; the fixed list is the same
 * behaviour the node had before this existed.
 */
export async function getSumitCardSampleOutput(workflowId: string): Promise<SumitCardOutput | null> {
  await requirePlatformPermission('manage_settings');

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('workflow_runs')
    .select('trigger_payload')
    .eq('workflow_id', workflowId)
    .eq('trigger_source', 'webhook')
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) return null;

  for (const row of data ?? []) {
    const payload = row.trigger_payload as { body?: unknown } | null;
    const output = sumitCardOutputFromSample(payload?.body);
    if (output) return output;
  }
  return null;
}

/** The execution record for one workflow, newest first. */
export async function listWorkflowRuns(
  workflowId: string,
  limit = 50,
): Promise<RunSummary[]> {
  await requirePlatformPermission('manage_settings');

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

/**
 * A short value that changes exactly when the runs table would look different.
 *
 * ⚠️ WHY THIS EXISTS AT ALL. `runs-auto-refresh.tsx` used to stop polling once
 * every visible run was terminal, on the reasoning that nothing could change
 * after that. A live test disproved it: an inbound WhatsApp message created a
 * run at 18:55:53 and finished it at 18:55:57 while the page sat open and
 * visible, and the table still showed only the two runs from the previous day.
 * A trigger creates rows with no browser involved, so "everything I can see has
 * finished" says nothing about what is about to appear.
 *
 * ⚠️ AND WHY NOT JUST REFRESH ON A TIMER. `router.refresh()` re-runs the whole
 * page — seven uncached queries — and in the idle case the answer is almost
 * always "nothing changed". This is ONE query, and the refresh happens only
 * when the answer actually differs.
 *
 * ⚠️ THE FINGERPRINT COVERS EVERY VISIBLE ROW, NOT JUST THE NEWEST. Taking only
 * the latest run would miss a parked run waking up behind a newer one — a
 * `logic.wait` step can leave a run non-terminal for days while later runs come
 * and go. `id:status` per row catches an insert, a status change, and a
 * deletion alike.
 *
 * The shape of the value — which rows, in which order — lives in
 * `@/lib/workflow/runs-fingerprint`, where it can be tested directly.
 */
export async function workflowRunsFingerprint(workflowId: string): Promise<string> {
  await requirePlatformPermission('manage_settings');

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('workflow_runs')
    .select('id, status')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
    .limit(RUNS_WINDOW);

  if (error) throw new Error('בדיקת ההרצות נכשלה');

  return runsFingerprint(data ?? []);
}


// ---------------------------------------------------------------------------
// Picking what a manual run acts on
// ---------------------------------------------------------------------------

export type ManualRunEvent = { id: string; name: string; eventDate: string | null };

export type ManualRunContact = {
  id: string;
  /** Last four digits only. Enough to recognise a person, not a phone book. */
  phoneTail: string;
  /** Every guest behind this phone. A phone may back several — see the note in
   *  webhook-processing.ts — and the admin has to see which people they are
   *  about to act on before a real run places a call. */
  guestNames: string[];
};

/**
 * Events a manual run may target, newest first.
 *
 * Capped rather than paginated: this feeds a picker in one panel, and an admin
 * choosing what to test against is looking at recent events, not browsing an
 * archive.
 */
export async function listEventsForManualRun(limit = 50): Promise<ManualRunEvent[]> {
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('events')
    .select('id, name, event_date')
    .order('event_date', { ascending: false })
    .limit(limit);

  if (error) throw new Error('טעינת האירועים נכשלה');

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    eventDate: row.event_date,
  }));
}

/**
 * Contacts of one event, with the guest names behind each phone.
 *
 * The phone is truncated to its last four digits on the SERVER. A real run can
 * place a call, so the admin must be able to tell one person from another — but
 * that is a recognition need, not a reason to ship a full guest phone list into
 * a browser bundle.
 */
export async function listContactsForManualRun(
  eventId: string,
  limit = 200,
): Promise<ManualRunContact[]> {
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
  const [contacts, guests] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, normalized_phone')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true })
      .limit(limit),
    supabase.from('guests').select('contact_id, full_name').eq('event_id', eventId),
  ]);

  if (contacts.error) throw new Error('טעינת אנשי הקשר נכשלה');

  const namesByContact = new Map<string, string[]>();
  for (const guest of guests.data ?? []) {
    if (!guest.contact_id) continue;
    const list = namesByContact.get(guest.contact_id) ?? [];
    if (guest.full_name) list.push(guest.full_name);
    namesByContact.set(guest.contact_id, list);
  }

  return (contacts.data ?? []).map((row) => ({
    id: row.id,
    phoneTail: (row.normalized_phone ?? '').slice(-4),
    guestNames: namesByContact.get(row.id) ?? [],
  }));
}
