import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

// Data Access Layer (Next.js recommended pattern). Authorization checks live
// close to the data and are memoized per render pass with React's cache().

// Verified current user (or null). getUser() validates the token with the
// Supabase Auth server — never use getSession() for authorization.
export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

// Require an authenticated user; redirect to login otherwise.
export const requireUser = cache(async () => {
  const user = await getUser();
  if (!user) {
    redirect('/auth/login');
  }
  return user;
});

// Whether the current user is an administrator. Non-redirecting — for
// conditional UI (e.g. showing an admin nav link). Returns false for
// anonymous users. Authorization for admin routes is still enforced by
// requireAdmin in the admin layout; this is convenience only, never a gate.
// Memoized per render pass so repeated calls share one RPC round-trip.
export const isAdmin = cache(async (): Promise<boolean> => {
  const user = await getUser();
  if (!user) {
    return false;
  }
  const supabase = await createClient();
  const { data } = await supabase.rpc('has_role', {
    _role: 'admin',
    _user_id: user.id,
  });
  return data === true;
});

// Require an administrator. Role is checked server-side via the trusted
// has_role() RPC against the user_roles table (not browser-supplied data).
export const requireAdmin = cache(async () => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: isAdminResult } = await supabase.rpc('has_role', {
    _role: 'admin',
    _user_id: user.id,
  });
  if (!isAdminResult) {
    redirect('/app');
  }
  return user;
});
