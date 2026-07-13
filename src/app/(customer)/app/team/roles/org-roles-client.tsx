'use client';

import { Fragment, useMemo, useState, useTransition } from 'react';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FormError } from '@/components/forms';
import type {
  OrgRoleDTO,
  PermissionDefDTO,
  OrgRolePermissionMatrix,
} from '@/lib/data/orgs';
import { setOrgRolePermissionAction } from './actions';

// Client matrix editor for the ORG (customer) role-permission screen —
// COPIED (not imported) from ../../../../(admin)/admin/roles/roles-client.tsx
// one layer down, per the design doc: the DTOs differ (OrgRoleDTO/
// PermissionDefDTO vs PlatformRoleDTO/PlatformPermissionDTO) and this screen
// has no "create role" form (the 4 org roles are fixed globally; only what
// each one may do, per-org, is editable here). Permissions are rows (grouped
// by resource — the org catalog has no separate `category` field, unlike the
// platform catalog); roles are columns; each cell is a Switch that
// grants/revokes one (role, permission) pair. Toggling is SERVER-VERIFIED: the
// switch flips optimistically, awaits the action, and reverts + surfaces the
// error if the server rejects.
//
// TWO kinds of locked, disabled cells (both mirror roles-client.tsx's owner
// column lock):
//   - the OWNER column — always granted, disabled, for every permission.
//   - any SYSTEM_PROTECTED permission cell for a non-owner role — disabled,
//     UNCHECKED, tooltip "שמור לבעלים בלבד" (currently campaigns.create /
//     campaigns.manage — see permission_definitions.system_protected).
//
// Responsive strategy: identical to the platform screen — sm: breakpoint
// switches between the matrix table (roles as columns, sticky permission
// column) and a per-role Accordion (table-to-card mobile pattern).

const RESOURCE_LABEL: Record<string, string> = {
  events: 'אירועים',
  guests: 'אורחים',
  contacts: 'אנשי קשר',
  campaigns: 'קמפיינים',
  reports: 'דוחות',
  billing: 'חיוב',
  members: 'חברי צוות',
  organization: 'ארגון',
};

// One matrix cell bound to setOrgRolePermissionAction. Optimistic local state;
// reverts and bubbles the error to the shared banner if the action rejects.
function MatrixCell({
  roleId,
  permissionId,
  ariaLabel,
  locked,
  lockedReason,
  initialChecked,
  onError,
}: {
  roleId: string;
  permissionId: string;
  ariaLabel: string;
  locked: boolean;
  lockedReason: string;
  initialChecked: boolean;
  onError: (message: string | null) => void;
}) {
  const [checked, setChecked] = useState(initialChecked);
  const [pending, startTransition] = useTransition();

  if (locked) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span>
              <Switch
                checked={checked}
                disabled
                aria-label={`${ariaLabel} (${lockedReason})`}
              />
            </span>
          }
        />
        <TooltipContent>{lockedReason}</TooltipContent>
      </Tooltip>
    );
  }

  const onChange = (next: boolean): void => {
    setChecked(next); // optimistic
    onError(null);
    startTransition(async () => {
      const result = await setOrgRolePermissionAction({
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

// Group permissions by resource, preserving first-appearance order (the data
// layer already orders permissions by sort_order).
function groupByResource(
  permissions: PermissionDefDTO[],
): { resource: string; items: PermissionDefDTO[] }[] {
  const groups: { resource: string; items: PermissionDefDTO[] }[] = [];
  const index = new Map<string, number>();
  for (const permission of permissions) {
    let i = index.get(permission.resource);
    if (i === undefined) {
      i = groups.length;
      index.set(permission.resource, i);
      groups.push({ resource: permission.resource, items: [] });
    }
    groups[i].items.push(permission);
  }
  return groups;
}

// Whether a (role, permission) cell should render locked, and why.
function cellLock(
  role: OrgRoleDTO,
  permission: PermissionDefDTO,
): { locked: boolean; reason: string } {
  if (role.isOwnerRole) {
    return { locked: true, reason: 'הרשאות הבעלים קבועות' };
  }
  if (permission.systemProtected) {
    return { locked: true, reason: 'שמור לבעלים בלבד' };
  }
  return { locked: false, reason: '' };
}

// One labeled toggle row inside a role's mobile card (mirrors the platform
// screen's PermissionToggleRow).
function PermissionToggleRow({
  permission,
  role,
  granted,
  onError,
}: {
  permission: PermissionDefDTO;
  role: OrgRoleDTO;
  granted: boolean;
  onError: (message: string | null) => void;
}) {
  const lock = cellLock(role, permission);
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{permission.label}</p>
        <p className="text-xs text-muted-foreground" dir="ltr">
          {permission.resource}.{permission.action}
        </p>
      </div>
      <MatrixCell
        roleId={role.id}
        permissionId={permission.id}
        ariaLabel={`${permission.label} – ${role.label}`}
        locked={lock.locked}
        lockedReason={lock.reason}
        initialChecked={lock.locked ? role.isOwnerRole : granted}
        onError={onError}
      />
    </div>
  );
}

// Mobile rendering (below `sm`): one accordion item per role instead of a
// horizontally-scrolling matrix.
function RolesAccordion({
  roles,
  groups,
  grantedSet,
  onError,
}: {
  roles: OrgRoleDTO[];
  groups: { resource: string; items: PermissionDefDTO[] }[];
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
              role.isOwnerRole || grantedSet.has(`${role.id}:${permission.id}`),
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
                {role.isOwnerRole ? <Lock className="size-3.5" aria-hidden /> : null}
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
                <div key={`${role.id}-${group.resource}`}>
                  <p className="pt-2 text-xs font-semibold text-muted-foreground">
                    {RESOURCE_LABEL[group.resource] ?? group.resource}
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

function RolesMatrix({ roles, permissions, granted }: OrgRolePermissionMatrix) {
  // Shared feedback banner for cell toggles (success is silent; only failures
  // surface, alongside the automatic revert).
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => groupByResource(permissions), [permissions]);
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
          ביטול הסימון שולל אותה. תפקיד הבעלים קבוע, וכמה הרשאות שמורות לבעלים
          בלבד.
        </p>
      </div>

      {error ? <FormError message={error} /> : null}

      {/* Below `sm`: per-role accordion (table-to-card mobile pattern). */}
      <div className="sm:hidden">
        <RolesAccordion roles={roles} groups={groups} grantedSet={grantedSet} onError={setError} />
      </div>

      {/* `sm` and up: the role x permission matrix table. */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow className="text-xs text-muted-foreground">
              <TableHead className="sticky start-0 z-20 bg-card">הרשאה</TableHead>
              {roles.map((role: OrgRoleDTO) => (
                <TableHead key={role.id} className="text-center">
                  <span className="inline-flex items-center gap-1">
                    {role.isOwnerRole ? <Lock className="size-3" aria-hidden /> : null}
                    {role.label}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <Fragment key={`res-${group.resource}`}>
                <TableRow className="bg-muted/40">
                  <TableCell colSpan={colCount} className="text-xs font-semibold text-muted-foreground">
                    {RESOURCE_LABEL[group.resource] ?? group.resource}
                  </TableCell>
                </TableRow>
                {group.items.map((permission) => (
                  <TableRow key={permission.id}>
                    <TableCell className="sticky start-0 z-10 min-w-[11rem] bg-card whitespace-normal">
                      <span className="font-medium">{permission.label}</span>
                      <span className="block text-xs text-muted-foreground" dir="ltr">
                        {permission.resource}.{permission.action}
                      </span>
                    </TableCell>
                    {roles.map((role) => {
                      const lock = cellLock(role, permission);
                      return (
                        <TableCell key={role.id} className="text-center">
                          <div className="flex justify-center">
                            <MatrixCell
                              roleId={role.id}
                              permissionId={permission.id}
                              ariaLabel={`${permission.label} – ${role.label}`}
                              locked={lock.locked}
                              lockedReason={lock.reason}
                              initialChecked={
                                lock.locked && role.isOwnerRole
                                  ? true
                                  : grantedSet.has(`${role.id}:${permission.id}`)
                              }
                              onError={setError}
                            />
                          </div>
                        </TableCell>
                      );
                    })}
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

export function OrgRolesClient({ matrix }: { matrix: OrgRolePermissionMatrix }) {
  return (
    <RolesMatrix roles={matrix.roles} permissions={matrix.permissions} granted={matrix.granted} />
  );
}
