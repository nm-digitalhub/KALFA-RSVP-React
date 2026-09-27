import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

// Historical direct link to one request (Slack alerts, push, pasted URLs).
// /admin/fleet is now one conversation per agent, so this only forwards to
// ?focus=<id>; the page resolves the agent and scrolls to the message.
export default async function AdminFleetRequestRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Non-UUID path segments 404 instead of redirecting into "not found".
  if (!z.uuid().safeParse(id).success) notFound();
  redirect(`/admin/fleet?focus=${id}`);
}
