import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

// Historical direct-link target (Slack alerts, pasted URLs) for a single
// fleet REQUEST — /admin/fleet's unified master-detail list now renders that
// same detail inline via ?id=&type=, so this route's only job is to redirect
// old links there. Goals never had an individual route before this redesign,
// so there is no equivalent old link to preserve for them.
export default async function AdminFleetRequestRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Non-UUID path segments 404 cleanly instead of redirecting into a page
  // that will just show "not found" anyway.
  if (!z.uuid().safeParse(id).success) notFound();
  redirect(`/admin/fleet?id=${id}&type=request`);
}
