import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge, PageHeading, formatDateTime } from '../_components';

import { Button } from '@/components/ui/button';
import { listWorkflows } from '@/lib/data/admin/workflows';

import { createWorkflowAction } from './actions';
import { ArmToggle } from './arm-toggle';
import { DeleteWorkflowButton } from './row-actions';

export const metadata: Metadata = { title: 'תהליכי אוטומציה' };

// Admin: the automation graphs an owner draws and arms. Authorization is in the
// data layer (src/lib/data/admin/workflows.ts), not here — `manage_settings` to
// read and arm one, `view_customer_data` for the readers that hand guest names
// to the manual-run picker. It was a bare requireAdmin() until 2026-09-10.
//
// "Armed" is the only word that matters on this page. A workflow that is drawn
// but not armed does nothing at all; an armed one runs on every inbound WhatsApp
// message that matches its trigger, and changes real guest rows.
export default async function AdminWorkflowsPage() {
  const workflows = await listWorkflows();

  return (
    <div className="space-y-6">
      <PageHeading>תהליכי אוטומציה</PageHeading>

      <form action={createWorkflowAction} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">שם התהליך החדש</span>
          <input
            name="name"
            required
            maxLength={120}
            className="min-h-11 w-72 rounded-md border border-input bg-background px-3"
            placeholder="למשל: אישור אוטומטי מוואטסאפ"
          />
        </label>
        <Button type="submit">יצירה</Button>
      </form>

      {workflows.length === 0 ? (
        <p className="text-muted-foreground">עדיין אין תהליכים. צרו את הראשון למעלה.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-start text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-start font-medium">שם</th>
                <th className="p-3 text-start font-medium">מצב</th>
                <th className="p-3 text-start font-medium">גרסה</th>
                <th className="p-3 text-start font-medium">עודכן</th>
                <th className="p-3 text-start font-medium">
                  <span className="sr-only">פעולות</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((workflow) => (
                <tr key={workflow.id} className="border-t border-border">
                  <td className="p-3">
                    <Link
                      href={`/admin/workflows/${workflow.id}`}
                      className="underline underline-offset-4"
                    >
                      {workflow.name}
                    </Link>
                  </td>
                  <td className="p-3">
                    <Badge variant={workflow.isActive ? 'success' : 'secondary'}>
                      {workflow.isActive ? 'פעיל' : 'כבוי'}
                    </Badge>
                  </td>
                  <td className="p-3 tabular-nums">{workflow.version}</td>
                  <td className="p-3">{formatDateTime(workflow.updatedAt)}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-start gap-2">
                      <ArmToggle id={workflow.id} isActive={workflow.isActive} />
                      <DeleteWorkflowButton id={workflow.id} name={workflow.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
