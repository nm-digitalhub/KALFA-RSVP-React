import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/auth/dal';

// Fine-grained authorization layer (the app-side half of the two-tier model).
//
// DB Row Level Security guarantees tenant ISOLATION (you can only touch your
// org's rows). The VERB ("may this member edit guests / manage members?") is
// enforced here, in the server layer, against the single DB source of truth:
//   public.has_org_permission(_org_id, _resource, _action)
// which joins organization_members -> role_permissions -> permission_definitions.
//
// `resource` and `action` are plain strings validated at the DB against the
// seeded permission catalog — there is deliberately NO hardcoded union of
// permissions here, so the catalog stays data-driven and editable as data.

// Whether the current user holds `resource.action` in `orgId`. Non-throwing —
// for conditional UI and gating. Memoized per render pass so repeated checks
// for the same (org, resource, action) share one RPC round-trip.
export const can = cache(
  async (orgId: string, resource: string, action: string): Promise<boolean> => {
    const user = await getUser();
    if (!user) {
      return false;
    }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('has_org_permission', {
      _org_id: orgId,
      _resource: resource,
      _action: action,
    });
    if (error) {
      return false;
    }
    return data === true;
  },
);

// Require `resource.action` in `orgId`; throws a safe, user-facing error
// otherwise. Use at the top of every privileged Server Action / data mutation.
export async function requirePermission(
  orgId: string,
  resource: string,
  action: string,
): Promise<void> {
  if (!(await can(orgId, resource, action))) {
    throw new Error('אין לך הרשאה לבצע פעולה זו');
  }
}
