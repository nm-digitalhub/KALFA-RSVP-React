import type { Metadata } from "next";
import Link from "next/link";

import { Badge, PageHeading, formatDateTime } from "../_components";

import { listWorkflows } from "@/lib/data/admin/workflows";

import { SubmitButton } from "@/components/forms";

import { createWorkflowAction } from "./actions";
import { ArmToggle } from "./arm-toggle";
import { DeleteWorkflowButton } from "./row-actions";

export const metadata: Metadata = { title: "תהליכי אוטומציה" };

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

      <form
        action={createWorkflowAction}
        className="flex flex-wrap items-end gap-3"
      >
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
        {/* SubmitButton, not a bare Button. It carries useFormStatus and disables
            itself for the round-trip; a plain button stays clickable while the
            action runs, and every further click is another INSERT. MEASURED: 15
            empty workflows created in 17 seconds on 2026-09-10 that way. */}
        <SubmitButton className="w-auto">יצירה</SubmitButton>
      </form>

      {workflows.length === 0 ? (
        <p className="text-muted-foreground">
          עדיין אין תהליכים. צרו את הראשון למעלה.
        </p>
      ) : (
        <>
          {/*
            ⚠️ CARDS ON A PHONE, A TABLE ON A DESKTOP — the pattern this admin
            already proved on the guest list (`<ul className="space-y-3
            lg:hidden">` beside `<div className="hidden … lg:block">`, commit
            8be4d25).

            ⚠️ AND IT REPLACES A FIX THAT MADE THINGS WORSE, recorded so the
            same road is not taken a third time. The table was `w-full` inside
            `overflow-x-auto`, which never overflows and so COMPRESSES: on a
            phone the five columns were crushed into ~343px and every row was
            113px tall with names broken mid-word. Adding `min-w-[46rem]` fixed
            the crushing — rows dropped to 65px — and broke something worse: the
            table then extended past the screen, so "עודכן" AND BOTH ACTION
            BUTTONS sat off-frame with no scroll affordance to reveal them.
            MEASURED on a real iPhone, not inferred. A table whose whole purpose
            is arming and deleting must not put arming and deleting out of reach.

            Horizontal scroll inside a nested container is technically real
            (the wrapper's scrollLeft ranged -396..0) and practically invisible:
            nothing on screen says to swipe, and on touch a nested scroller
            fights the page's own gesture.
          */}
          <ul className="space-y-3 lg:hidden">
            {workflows.map((workflow) => (
              <li
                key={workflow.id}
                className="space-y-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/admin/workflows/${workflow.id}`}
                    className="font-medium underline underline-offset-4"
                  >
                    {workflow.name}
                  </Link>
                  <Badge variant={workflow.isActive ? "success" : "secondary"}>
                    {workflow.isActive ? "פעיל" : "כבוי"}
                  </Badge>
                </div>
                {/* The two columns a phone can afford to show, labelled — a bare
                    number and a bare date mean nothing without their header, and
                    the header row is exactly what a card layout drops. */}
                <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <div className="flex gap-1">
                    <dt>גרסה:</dt>
                    <dd className="tabular-nums">{workflow.version}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>עודכן:</dt>
                    <dd>{formatDateTime(workflow.updatedAt)}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap items-start gap-2">
                  <ArmToggle id={workflow.id} isActive={workflow.isActive} />
                  <DeleteWorkflowButton id={workflow.id} name={workflow.name} />
                </div>
              </li>
            ))}
          </ul>

          {/* `hidden … lg:block`, so the table is not merely invisible on a
              phone — it is not laid out at all, and cannot leak its width into
              the shell the way the previous attempt did. */}
          <div className="hidden overflow-x-auto rounded-lg border border-border lg:block">
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
                      <Badge
                        variant={workflow.isActive ? "success" : "secondary"}
                      >
                        {workflow.isActive ? "פעיל" : "כבוי"}
                      </Badge>
                    </td>
                    <td className="p-3 tabular-nums">{workflow.version}</td>
                    <td className="p-3">
                      {formatDateTime(workflow.updatedAt)}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-start gap-2">
                        <ArmToggle
                          id={workflow.id}
                          isActive={workflow.isActive}
                        />
                        <DeleteWorkflowButton
                          id={workflow.id}
                          name={workflow.name}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
