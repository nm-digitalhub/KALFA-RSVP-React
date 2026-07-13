'use client';

import { Fragment, useActionState, useMemo, useState, useTransition } from 'react';
import { Lock } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
} from '@/components/ui/accordion';
import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import type {
  PlatformPermissionDTO,
  PlatformRoleDTO,
  RolePermissionMatrix,
} from '@/lib/data/admin/platform-roles';
import { createPlatformRoleAction, setRolePermissionAction } from './actions';

// Client matrix editor for the PLATFORM (Owner/Staff) RBAC screen. Permissions
// are rows (grouped by category); roles are columns; each cell is a Switch that
// grants/revokes one (role, permission) pair. Toggling is SERVER-VERIFIED: the
// switch flips optimistically, awaits the action, and reverts + surfaces the
// error if the server rejects (mirrors the ToggleRow mechanics in
// ../alerts/alerts-client.tsx). The owner role's column is locked (its
// permissions are immutable — owner is always all-permissions).
//
// Responsive strategy (Tailwind CSS docs, tailwindcss.com/docs/responsive-design):
// a wide role x permission grid does not fold into a phone-width viewport no
// matter how much horizontal scroll padding you add — the sm: breakpoint (not
// @container: this section always spans the full admin content column, so a
// viewport breakpoint is the right signal, not a parent-size query) switches
// between two renderings of the SAME data:
//   - sm and up: the matrix table (roles as columns), sticky permission column.
//   - below sm: one Accordion per role (shadcn/ui Base UI accordion, already
//     used in ../channels/channels-client.tsx) whose panel lists permissions
//     grouped by category as labeled toggle rows — the standard
//     table-becomes-cards mobile pattern, and the natural fit for "which
//     permissions does THIS role have" editing on a narrow screen.
// Both renderings share MatrixCell (the toggle/optimistic/revert logic) and
// groupByCategory so there is exactly one place that owns grant/revoke
// behavior and one place that owns grouping.

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';

// Human labels for the permission categories (fallback: the raw key).
const CATEGORY_LABEL: Record<string, string> = {
  platform: 'פלטפורמה',
  billing: 'חיוב',
  support: 'תמיכה',
  ops: 'תפעול',
};

// One matrix cell bound to setRolePermissionAction. Optimistic local state;
// reverts and bubbles the error to the shared banner if the action rejects.
function MatrixCell({
  roleId,
  permissionId,
  ariaLabel,
  locked,
  initialChecked,
  onError,
}: {
  roleId: string;
  permissionId: string;
  ariaLabel: string;
  locked: boolean;
  initialChecked: boolean;
  onError: (message: string | null) => void;
}) {
  const [checked, setChecked] = useState(initialChecked);
  const [pending, startTransition] = useTransition();

  if (locked) {
    // Owner column: always granted, immutable. Render a disabled, checked switch.
    return (
      <Switch
        checked
        disabled
        aria-label={`${ariaLabel} (קבוע)`}
        title="הרשאות בעל המערכת קבועות"
      />
    );
  }

  const onChange = (next: boolean): void => {
    setChecked(next); // optimistic
    onError(null);
    startTransition(async () => {
      const result = await setRolePermissionAction({
        roleId,
        permissionId,
        granted: next,
      });
      if (result && 'error' in result && result.error) {
        setChecked(!next); // revert
        onError(result.error);
      }
    });
  };

  return (
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      disabled={pending}
      aria-label={ariaLabel}
    />
  );
}

// Create-role form: a new role starts with ZERO permissions (owner grants them
// via the matrix afterwards).
function CreateRoleForm() {
  const [state, action] = useActionState(createPlatformRoleAction, null);
  const fieldErrors = state?.fieldErrors;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">תפקיד חדש</h2>
        <p className="text-sm text-muted-foreground">
          תפקיד חדש נוצר ללא הרשאות. לאחר היצירה סמנו את ההרשאות שלו במטריצה.
        </p>
      </div>

      <form action={action} className="space-y-4">
        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="role-name" className="text-sm font-medium">
              שם מזהה (אנגלית)
            </label>
            <input
              id="role-name"
              name="name"
              type="text"
              dir="ltr"
              autoComplete="off"
              placeholder="support_agent"
              className={inputClass}
            />
            <p className="text-xs text-muted-foreground">
              מזהה יציב באנגלית קטנה, ספרות וקו תחתון בלבד.
            </p>
            <FieldError errors={fieldErrors?.name} />
          </div>

          <div className="space-y-1">
            <label htmlFor="role-label" className="text-sm font-medium">
              תווית לתצוגה
            </label>
            <input
              id="role-label"
              name="label"
              type="text"
              autoComplete="off"
              placeholder="נציג תמיכה"
              className={inputClass}
            />
            <FieldError errors={fieldErrors?.label} />
          </div>
        </div>

        <SubmitButton className="w-auto">יצירת תפקיד</SubmitButton>
      </form>
    </section>
  );
}

// Group permissions by category, preserving first-appearance order (the data
// layer already orders permissions by sort_order).
function groupByCategory(
  permissions: PlatformPermissionDTO[],
): { category: string; items: PlatformPermissionDTO[] }[] {
  const groups: { category: string; items: PlatformPermissionDTO[] }[] = [];
  const index = new Map<string, number>();
  for (const permission of permissions) {
    let i = index.get(permission.category);
    if (i === undefined) {
      i = groups.length;
      index.set(permission.category, i);
      groups.push({ category: permission.category, items: [] });
    }
    groups[i].items.push(permission);
  }
  return groups;
}

// One labeled toggle row inside a role's mobile card (mirrors ToggleRow in
// ../alerts/alerts-client.tsx): permission label + key on the start side, the
// shared MatrixCell switch on the end side.
function PermissionToggleRow({
  permission,
  role,
  granted,
  onError,
}: {
  permission: PlatformPermissionDTO;
  role: PlatformRoleDTO;
  granted: boolean;
  onError: (message: string | null) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{permission.label}</p>
        <p className="text-xs text-muted-foreground" dir="ltr">
          {permission.key}
        </p>
      </div>
      <MatrixCell
        roleId={role.id}
        permissionId={permission.id}
        ariaLabel={`${permission.label} – ${role.label}`}
        locked={role.isOwnerRole}
        initialChecked={granted}
        onError={onError}
      />
    </div>
  );
}

// Mobile rendering (below `sm`): one accordion item per role instead of a
// horizontally-scrolling matrix — the standard responsive table-to-card
// pattern (see file header). Each panel groups the role's permissions by
// category, same grouping and same MatrixCell as the desktop table.
function RolesAccordion({
  roles,
  groups,
  grantedSet,
  onError,
}: {
  roles: PlatformRoleDTO[];
  groups: { category: string; items: PlatformPermissionDTO[] }[];
  grantedSet: Set<string>;
  onError: (message: string | null) => void;
}) {
  return (
    <Accordion defaultValue={[roles[0]?.id].filter(Boolean)}>
      {roles.map((role) => {
        const grantedCount = groups.reduce(
          (total, group) =>
            total +
            group.items.filter((permission) =>
              grantedSet.has(`${role.id}:${permission.id}`),
            ).length,
          0,
        );
        const permissionCount = groups.reduce(
          (total, group) => total + group.items.length,
          0,
        );

        return (
          <AccordionItem key={role.id} value={role.id}>
            <AccordionTrigger>
              <span className="inline-flex items-center gap-1.5 text-foreground">
                {role.isOwnerRole ? (
                  <Lock className="size-3.5" aria-hidden />
                ) : null}
                {role.label}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {role.isOwnerRole
                  ? 'כל ההרשאות (קבוע)'
                  : `${grantedCount} מתוך ${permissionCount}`}
              </span>
            </AccordionTrigger>
            <AccordionPanel className="space-y-1">
              {groups.map((group) => (
                <div key={`${role.id}-${group.category}`}>
                  <p className="pt-2 text-xs font-semibold text-muted-foreground">
                    {CATEGORY_LABEL[group.category] ?? group.category}
                  </p>
                  <div className="divide-y divide-border">
                    {group.items.map((permission) => (
                      <PermissionToggleRow
                        key={permission.id}
                        permission={permission}
                        role={role}
                        granted={grantedSet.has(`${role.id}:${permission.id}`)}
                        onError={onError}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </AccordionPanel>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

function RolesMatrix({
  roles,
  permissions,
  granted,
}: RolePermissionMatrix) {
  // Shared feedback banner for cell toggles (success is silent; only failures
  // surface, alongside the automatic revert).
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => groupByCategory(permissions), [permissions]);
  // Fast lookup: is (role, permission) currently granted?
  const grantedSet = useMemo(() => {
    const set = new Set<string>();
    for (const [roleId, permissionIds] of Object.entries(granted)) {
      for (const permissionId of permissionIds) set.add(`${roleId}:${permissionId}`);
    }
    return set;
  }, [granted]);

  const colCount = roles.length + 1;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">מטריצת הרשאות</h2>
        <p className="text-sm text-muted-foreground">
          הרשאות מקובצות לפי תחום, מול תפקידים. סימון מעניק את ההרשאה לתפקיד;
          ביטול הסימון שולל אותה. תפקיד בעל המערכת קבוע.
        </p>
      </div>

      {error ? <FormError message={error} /> : null}

      {/* Below `sm`: per-role accordion (table-to-card mobile pattern). */}
      <div className="sm:hidden">
        <RolesAccordion
          roles={roles}
          groups={groups}
          grantedSet={grantedSet}
          onError={setError}
        />
      </div>

      {/* `sm` and up: the role x permission matrix table. */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow className="text-xs text-muted-foreground">
              <TableHead className="sticky start-0 z-20 bg-card">הרשאה</TableHead>
              {roles.map((role: PlatformRoleDTO) => (
                <TableHead key={role.id} className="text-center">
                  <span className="inline-flex items-center gap-1">
                    {role.isOwnerRole ? (
                      <Lock className="size-3" aria-hidden />
                    ) : null}
                    {role.label}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <Fragment key={`cat-${group.category}`}>
                <TableRow className="bg-muted/40">
                  <TableCell
                    colSpan={colCount}
                    className="text-xs font-semibold text-muted-foreground"
                  >
                    {CATEGORY_LABEL[group.category] ?? group.category}
                  </TableCell>
                </TableRow>
                {group.items.map((permission) => (
                  <TableRow key={permission.id}>
                    <TableCell className="sticky start-0 z-10 min-w-[11rem] bg-card whitespace-normal">
                      <span className="font-medium">{permission.label}</span>
                      <span className="block text-xs text-muted-foreground" dir="ltr">
                        {permission.key}
                      </span>
                    </TableCell>
                    {roles.map((role) => (
                      <TableCell key={role.id} className="text-center">
                        <div className="flex justify-center">
                          <MatrixCell
                            roleId={role.id}
                            permissionId={permission.id}
                            ariaLabel={`${permission.label} – ${role.label}`}
                            locked={role.isOwnerRole}
                            initialChecked={grantedSet.has(
                              `${role.id}:${permission.id}`,
                            )}
                            onError={setError}
                          />
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

export function RolesClient({ matrix }: { matrix: RolePermissionMatrix }) {
  return (
    <div className="space-y-6">
      <RolesMatrix
        roles={matrix.roles}
        permissions={matrix.permissions}
        granted={matrix.granted}
      />
      <CreateRoleForm />
    </div>
  );
}
