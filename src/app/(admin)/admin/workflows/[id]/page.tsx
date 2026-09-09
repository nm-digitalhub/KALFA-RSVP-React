import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, formatDateTime } from '../../_components';

import { editorDiagramSchema } from '@/lib/workflow/adapter/editor-schema';
import { getWorkflow, listWorkflowRuns } from '@/lib/data/admin/workflows';

import { saveWorkflowAction } from '../actions';

import { TestPanel } from './test-panel';
import { WorkflowEditor } from './workflow-editor';

export const metadata: Metadata = { title: 'עריכת תהליך' };

export default async function AdminWorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const workflow = await getWorkflow(id);
  if (!workflow) notFound();

  const runs = await listWorkflowRuns(id, 20);

  // The stored jsonb is parsed before it reaches the editor. A row that cannot
  // be parsed opens as an empty canvas rather than crashing the page — the
  // owner can always draw their way out, which is not true if the route throws.
  const parsed = editorDiagramSchema.safeParse(workflow.definition);
  const nodes = parsed.success ? parsed.data.nodes : [];
  const edges = parsed.success ? parsed.data.edges : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/workflows" className="text-sm underline underline-offset-4">
          ← כל התהליכים
        </Link>
        <h1 className="text-2xl font-bold">{workflow.name}</h1>
        <Badge variant={workflow.isActive ? 'success' : 'secondary'}>
          {workflow.isActive ? 'פעיל' : 'כבוי'}
        </Badge>
        {!parsed.success && (
          <span role="alert" className="text-sm text-destructive">
            התהליך השמור לא ניתן לקריאה ונפתח כקנבס ריק. שמירה תדרוס אותו.
          </span>
        )}
      </div>

      <WorkflowEditor
        workflowId={workflow.id}
        name={workflow.name}
        initialNodes={nodes as never}
        initialEdges={edges as never}
        saveAction={saveWorkflowAction}
      />

      <TestPanel workflowId={workflow.id} />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">הרצות אחרונות</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            עדיין לא רץ. תהליך כבוי לא רץ אף פעם — הפעילו אותו ברשימה.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-start text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-start font-medium">מצב</th>
                  <th className="p-3 text-start font-medium">מקור</th>
                  <th className="p-3 text-start font-medium">התחיל</th>
                  <th className="p-3 text-start font-medium">הסתיים</th>
                  <th className="p-3 text-start font-medium">שגיאה</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-border">
                    <td className="p-3">{run.status}</td>
                    <td className="p-3">{run.triggerSource}</td>
                    <td className="p-3">{formatDateTime(run.createdAt)}</td>
                    <td className="p-3">
                      {run.finishedAt ? formatDateTime(run.finishedAt) : '—'}
                    </td>
                    <td className="p-3 text-destructive">{run.errorMessage ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
