import { requirePlatformOwner } from '@/lib/auth/dal';
import { getRolePermissionMatrix } from '@/lib/data/admin/platform-roles';

import { EmptyState, PageHeading } from '../_components';
import { RolesClient } from './roles-client';

// Admin: UI-editable PLATFORM (Owner/Staff) RBAC matrix editor. Owner-only —
// requirePlatformOwner() redirects a non-owner to /app (belt-and-suspenders on
// top of the data-layer gate and each server action's own re-check). Staff are
// assigned their role from the user-detail screen; here the owner defines what
// each role can do.

export default async function AdminRolesPage() {
  await requirePlatformOwner();
  const matrix = await getRolePermissionMatrix();

  return (
    <div className="space-y-6">
      <div>
        <PageHeading>תפקידי צוות</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          הגדרת תפקידי הצוות של הפלטפורמה וההרשאות שלהם. תפקיד בעל המערכת מקבל את כל
          ההרשאות ואינו ניתן לשינוי.
        </p>
      </div>

      {matrix.roles.length === 0 || matrix.permissions.length === 0 ? (
        <EmptyState>לא הוגדרו תפקידים או הרשאות.</EmptyState>
      ) : (
        <RolesClient matrix={matrix} />
      )}
    </div>
  );
}
