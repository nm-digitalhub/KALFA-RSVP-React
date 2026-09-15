import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, formatDateTime } from "../../_components";

import { editorDiagramSchema } from "@/lib/workflow/adapter/editor-schema";
import { getWorkflow, listWorkflowRuns } from "@/lib/data/admin/workflows";
import { listProviderNumbers } from "@/lib/data/admin/integrations/provider-numbers";

import { saveWorkflowAction } from "../actions";

import { CancelRunButton } from "../row-actions";

import { RunNowPanel } from "./run-now-panel";
import { RunWatchButton } from "./run-watcher";
import { TestPanel } from "./test-panel";
import { listSecretNames } from "@/lib/workflow/secrets";

import { listDialableVoicePurposes } from "@/lib/data/voice-purposes";

import { WorkflowEditor } from "./workflow-editor";

export const metadata: Metadata = { title: "עריכת תהליך" };

/**
 * Run states, in the product's own language.
 *
 * The column printed the raw column value, so an owner reading a Hebrew screen
 * met `waiting` in English the day `logic.wait` shipped. Unknown values fall
 * through to the raw string rather than to a guess: a state nobody translated is
 * still more useful shown than hidden.
 */
const RUN_STATUS_HE: Record<string, string> = {
  pending: "ממתינה בתור",
  running: "רצה",
  // Not "waiting in queue" — this one is parked on a `logic.wait` deadline, and
  // conflating the two would make a run that sleeps for two days look stuck.
  waiting: "בהמתנה מתוזמנת",
  completed: "הושלמה",
  incomplete: "הסתיימה חלקית",
  failed: "נכשלה",
  cancelled: "בוטלה",
  cancelling: "בביטול",
};

export default async function AdminWorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const workflow = await getWorkflow(id);
  if (!workflow) notFound();

  const runs = await listWorkflowRuns(id, 20);

  // The WhatsApp lines the trigger node may be pointed at.
  //
  // Read HERE and passed down because the palette is built in the browser and
  // the numbers are rows. No new permission: `getWorkflow` above already
  // requires `manage_settings`, which is exactly what this reader requires, so
  // anyone who can open this page could already see them.
  //
  // INACTIVE NUMBERS ARE NOT OFFERED — including one deleted at Meta, which the
  // sync now switches off. A workflow already pointing at such a number keeps
  // working: matching is against the stored phone_number_id, never against this
  // list. The list answers "what may be chosen today", not "what is still valid".
  // The voice agents that are actually configured, for the call node's dropdown.
  // Rows, not a constant: a purpose added today must appear without a deploy.
  //
  // ⚠️ `listDialable…`, not `listVoicePurposes`: a built-in or rule-less purpose
  // is refused by the dialler, so offering it here would let an owner arm a
  // workflow that cannot place its call. See the function's own note.
  const voicePurposes = (await listDialableVoicePurposes()).map((p) => ({
    key: p.key,
    displayName: p.displayName,
  }));

  // ONE READ, TWO LISTS. Both dropdowns are fed by `provider_numbers`, which is
  // the synced mirror of what each vendor says the account owns — so neither
  // costs a vendor round trip here.
  const providerNumbers = await listProviderNumbers();

  const whatsappNumbers = providerNumbers
    .filter(
      (n) =>
        n.provider === "meta_whatsapp" && n.providerRef !== null && n.isActive,
    )
    .map((n) => ({
      providerRef: n.providerRef as string,
      label: `${n.e164 ?? n.providerRef} — ${n.displayLabel ?? "ללא שם"}`,
    }));

  // The numbers a call may go out FROM.
  //
  // ⚠️ KEYED ON `e164`, NOT ON `providerRef` — and the difference is load-bearing.
  // The WhatsApp list above matches on the provider's own id because that is what
  // an inbound webhook carries. This one is handed to `VoxEngine.callPSTN(to,
  // callerid)` as the caller id, and that argument is a NUMBER. A `phone_id`
  // there would present as an invalid CLI, so a row with no synced E.164 is not
  // offerable at all.
  //
  // Deactivated numbers are excluded for the same reason as there: the list says
  // what may be chosen today. A node already pointing at one keeps its stored
  // value — matching never consults this list.
  const voiceCallerIds = providerNumbers
    .filter((n) => n.provider === "voximplant" && n.e164 !== null && n.isActive)
    .map((n) => ({
      value: n.e164 as string,
      label: `${n.e164} — ${n.displayLabel ?? "ללא שם"}`,
    }));

  // NAMES ONLY — `listSecretNames` strips the values, and this is a server
  // component, so the environment is read here and never shipped. An empty list
  // is a legitimate state (no secret has been configured yet) and the header
  // control says so with the instruction rather than showing nothing.
  const secretNames = listSecretNames();

  // The stored jsonb is parsed before it reaches the editor. A row that cannot
  // be parsed opens as an empty canvas rather than crashing the page — the
  // owner can always draw their way out, which is not true if the route throws.
  const parsed = editorDiagramSchema.safeParse(workflow.definition);
  const nodes = parsed.success ? parsed.data.nodes : [];
  const edges = parsed.success ? parsed.data.edges : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/workflows"
          className="text-sm underline underline-offset-4"
        >
          ← כל התהליכים
        </Link>
        <h1 className="text-2xl font-bold">{workflow.name}</h1>
        <Badge variant={workflow.isActive ? "success" : "secondary"}>
          {workflow.isActive ? "פעיל" : "כבוי"}
        </Badge>
        {!parsed.success && (
          <span role="alert" className="text-sm text-destructive">
            התהליך השמור לא ניתן לקריאה ונפתח כקנבס ריק. שמירה תדרוס אותו.
          </span>
        )}
      </div>

      <WorkflowEditor
        key={workflow.id}
        workflowId={workflow.id}
        name={workflow.name}
        layoutDirection={
          parsed.success ? parsed.data.layoutDirection : undefined
        }
        initialGlobalVariables={
          parsed.success ? parsed.data.globalVariables : undefined
        }
        initialNodes={nodes as never}
        initialEdges={edges as never}
        whatsappNumbers={whatsappNumbers}
        voicePurposes={voicePurposes}
        voiceCallerIds={voiceCallerIds}
        secretNames={secretNames}
        saveAction={saveWorkflowAction}
      />

      <RunNowPanel workflowId={workflow.id} scopedEventId={workflow.eventId} />

      <TestPanel workflowId={workflow.id} />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">הרצות אחרונות</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            עדיין לא רץ. תהליך כבוי לא רץ אף פעם — הפעילו אותו ברשימה.
          </p>
        ) : (
          <>
            {/*
              Cards on a phone, the table from `lg` up — the same shape as the
              workflow list, and for the reason recorded there: a `min-w` table
              on this page put "מעקב", and with it the cancel button, off-frame
              with no way to reach them.
            */}
            <ul className="space-y-3 lg:hidden">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="space-y-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {RUN_STATUS_HE[run.status] ?? run.status}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {run.triggerSource}
                    </span>
                  </div>
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <div className="flex gap-1">
                      <dt>התחיל:</dt>
                      <dd>{formatDateTime(run.createdAt)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>הסתיים:</dt>
                      <dd>
                        {run.finishedAt ? formatDateTime(run.finishedAt) : "—"}
                      </dd>
                    </div>
                  </dl>
                  {/* Only when there IS one — an empty "שגיאה:" label on every
                      successful run is noise on the screen with the least room. */}
                  {run.errorMessage ? (
                    <p className="text-sm text-destructive">
                      {run.errorMessage}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-start gap-2">
                    <RunWatchButton runId={run.id} />
                    {(run.status === "pending" || run.status === "waiting") && (
                      <CancelRunButton
                        workflowId={workflow.id}
                        runId={run.id}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto rounded-lg border border-border lg:block">
              <table className="w-full text-start text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-3 text-start font-medium">מצב</th>
                    <th className="p-3 text-start font-medium">מקור</th>
                    <th className="p-3 text-start font-medium">התחיל</th>
                    <th className="p-3 text-start font-medium">הסתיים</th>
                    <th className="p-3 text-start font-medium">שגיאה</th>
                    <th className="p-3 text-start font-medium">מעקב</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-t border-border">
                      <td className="p-3">
                        {RUN_STATUS_HE[run.status] ?? run.status}
                      </td>
                      <td className="p-3">{run.triggerSource}</td>
                      <td className="p-3">{formatDateTime(run.createdAt)}</td>
                      <td className="p-3">
                        {run.finishedAt ? formatDateTime(run.finishedAt) : "—"}
                      </td>
                      <td className="p-3 text-destructive">
                        {run.errorMessage ?? ""}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-start gap-2">
                          <RunWatchButton runId={run.id} />
                          {/* Queued OR PARKED. `cancelRun` refuses anything else,
                              because the vendored runner cannot be interrupted
                              once it is inside runGraph — which is exactly why a
                              parked run CAN be cancelled: it is not inside it. It
                              is a row with a deadline and a job that has not
                              fired, and `logic.wait` allows up to a year of that. */}
                          {(run.status === "pending" ||
                            run.status === "waiting") && (
                            <CancelRunButton
                              workflowId={workflow.id}
                              runId={run.id}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
