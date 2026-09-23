import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, firstParam, formatDateTime } from "../../_components";

import { hasPlatformPermission } from "@/lib/auth/dal";
import { editorDiagramSchema } from "@/lib/workflow/adapter/editor-schema";
import {
  getSumitCardSampleOutput,
  getWorkflow,
  listWorkflowRuns,
} from "@/lib/data/admin/workflows";
import { runsFingerprint, RUNS_WINDOW } from "@/lib/workflow/runs-fingerprint";
import { readOAuthProviderConfig } from "@/lib/data/admin/integrations/oauth-provider-config";
import { listProviderNumbers } from "@/lib/data/admin/integrations/provider-numbers";
import { listActiveMicrosoftWorkflowConnections } from "@/lib/data/admin/integrations/workflow-connections";
import { resolveOAuthProviderAvailability } from "@/lib/integrations/provider-availability";
import { hasSystemOAuthClient } from "@/lib/integrations/system-oauth-client";

import { saveWorkflowAction } from "../actions";

import { CancelRunButton } from "../row-actions";

import { RunNowPanel } from "./run-now-panel";
import { RunAutoWatch } from "./run-auto-watch";
import { RunWatchButton } from "./run-watcher";
import { RunsAutoRefresh, type WorkflowRunStatus } from "./runs-auto-refresh";
import { TestPanel } from "./test-panel";
import { listSecretNames } from "@/lib/workflow/secrets";

import { listDialableVoicePurposes } from "@/lib/data/voice-purposes";

import { OAuthOutcome } from "../../integrations/workflow-oauth/oauth-outcome";
import { WorkflowEditor } from "./workflow-editor";

export const metadata: Metadata = { title: "עריכת תהליך" };

const RUN_STATUS_HE: Record<string, string> = {
  pending: "ממתינה בתור",
  running: "רצה",
  waiting: "בהמתנה מתוזמנת",
  completed: "הושלמה",
  incomplete: "הסתיימה חלקית",
  failed: "נכשלה",
  cancelled: "בוטלה",
  cancelling: "בביטול",
};

export default async function AdminWorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ oauth?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const workflow = await getWorkflow(id);
  if (!workflow) notFound();

  const runs = await listWorkflowRuns(id, RUNS_WINDOW);

  const voicePurposes = (await listDialableVoicePurposes()).map((p) => ({
    key: p.key,
    displayName: p.displayName,
  }));

  const providerNumbers = await listProviderNumbers();

  const [microsoftConnections, microsoftConfig, canManageIntegrations] =
    await Promise.all([
      listActiveMicrosoftWorkflowConnections(),
      readOAuthProviderConfig("microsoft"),
      hasPlatformPermission("integrations.manage"),
    ]);

  const microsoftAvailability = resolveOAuthProviderAvailability({
    config: microsoftConfig,
    systemConfigured: hasSystemOAuthClient("microsoft"),
    canManage: canManageIntegrations,
    providerName: "Microsoft 365",
  });

  const whatsappNumbers = providerNumbers
    .filter(
      (n) =>
        n.provider === "meta_whatsapp" && n.providerRef !== null && n.isActive,
    )
    .map((n) => ({
      providerRef: n.providerRef as string,
      label: `${n.e164 ?? n.providerRef} — ${n.displayLabel ?? "ללא שם"}`,
    }));

  const voiceCallerIds = providerNumbers
    .filter((n) => n.provider === "voximplant" && n.e164 !== null && n.isActive)
    .map((n) => ({
      value: n.e164 as string,
      label: `${n.e164} — ${n.displayLabel ?? "ללא שם"}`,
    }));

  const secretNames = listSecretNames();

  const parsed = editorDiagramSchema.safeParse(workflow.definition);
  const nodes = parsed.success ? parsed.data.nodes : [];
  const edges = parsed.success ? parsed.data.edges : [];

  // Only a workflow with a SUMIT trigger pays for the read — and it is keys and
  // types, never values (see getSumitCardSampleOutput).
  const hasSumitTrigger = nodes.some(
    (n) => (n.data as { type?: string } | undefined)?.type === "trigger.sumit_card",
  );
  const sumitCardOutput = hasSumitTrigger ? await getSumitCardSampleOutput(id) : null;

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

      <OAuthOutcome value={firstParam(query.oauth)} />

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
        microsoftConnections={microsoftConnections}
        canConnectMicrosoft={microsoftAvailability.canConnect}
        microsoftConnectionUnavailableReason={microsoftAvailability.reason}
        secretNames={secretNames}
        sumitCardOutput={sumitCardOutput}
        saveAction={saveWorkflowAction}
      />

      <RunNowPanel workflowId={workflow.id} scopedEventId={workflow.eventId} />

      <TestPanel workflowId={workflow.id} />

      <section className="space-y-2">
        {/*
          Renders nothing; it only re-runs this page while a run is moving, so
          the status column stops needing a manual reload. The statuses are the
          ones already fetched above — no extra query, and no client-side copy of
          the table to keep in sync. See runs-auto-refresh.tsx for why this is a
          refresh rather than the SSE stream the canvas uses.

          The fingerprint is seeded from THIS render rather than learned from the
          component's first poll: anything that happens in between would
          otherwise be swallowed, and that gap is exactly when a trigger fires.
        */}
        <RunsAutoRefresh
          workflowId={id}
          statuses={runs.map((run) => run.status as WorkflowRunStatus)}
          fingerprint={runsFingerprint(runs)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">הרצות אחרונות</h2>
          {/*
            Attaches the canvas to a run that APPEARS while the page is open —
            the trigger-fired ones nobody clicks. Given the newest run rather
            than a list: it reacts to that value changing, and seeds itself on
            the first render so opening the page does not light the canvas with
            an old run. See run-auto-watch.tsx.
          */}
          <RunAutoWatch
            newestRun={runs[0] ? { id: runs[0].id, status: runs[0].status } : null}
          />
        </div>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            עדיין לא רץ. תהליך כבוי לא רץ אף פעם — הפעילו אותו ברשימה.
          </p>
        ) : (
          <>
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
