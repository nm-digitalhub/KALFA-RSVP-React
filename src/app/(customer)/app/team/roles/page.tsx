import { requireActiveOrg, requireOrgOwner } from '@/lib/auth/dal';
import { getOrgRolePermissionMatrix } from '@/lib/data/orgs';

import { OrgRolesClient } from './org-roles-client';

export const metadata = { title: 'הרשאות תפקידים' };

// Customer: UI-editable ORG (per-organization) RBAC matrix editor. Sibling to
// ../page.tsx (member/invitation management). Owner-only — requireOrgOwner()
// redirects a non-owner to /app/team (belt-and-suspenders on top of the
// data-layer gate and the server action's own re-check). Mirrors
// /admin/roles/page.tsx one layer down.
export default async function OrgRolesPage() {
  const { orgId } = await requireActiveOrg();
  await requireOrgOwner(orgId);
  const matrix = await getOrgRolePermissionMatrix(orgId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">הרשאות תפקידים</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          הגדרת מה כל תפקיד בארגון רשאי לעשות. תפקיד הבעלים מקבל את כל
          ההרשאות ואינו ניתן לשינוי.
        </p>
      </div>

      {matrix.roles.length === 0 || matrix.permissions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          לא הוגדרו תפקידים או הרשאות.
        </div>
      ) : (
        <OrgRolesClient matrix={matrix} />
      )}
    </div>
  );
}
