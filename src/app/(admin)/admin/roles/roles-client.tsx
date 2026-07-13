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
          הרשאות (שורות, מקובצות לפי תחום) מול תפקידים (עמודות). סימון תא מעניק את
          ההרשאה לתפקיד; ביטול הסימון שולל אותה. עמודת בעל המערכת קבועה.
        </p>
      </div>

      {error ? <FormError message={error} /> : null}

      <Table className="min-w-[36rem]">
        <TableHeader>
          <TableRow className="text-xs text-muted-foreground">
            <TableHead>הרשאה</TableHead>
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
                  <TableCell className="whitespace-normal">
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
                          initialChecked={grantedSet.has(`${role.id}:${permission.id}`)}
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
