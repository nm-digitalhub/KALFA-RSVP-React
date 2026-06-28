'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';

import { ACTIVE_ORG_COOKIE, getOrgContext, requireActiveOrg } from '@/lib/auth/dal';
import {
  inviteMember,
  resendInvitation,
  revokeInvitation,
  changeMemberRole,
  removeMember,
} from '@/lib/data/orgs';
import {
  inviteMemberSchema,
  changeMemberRoleSchema,
  memberIdSchema,
  invitationIdSchema,
  activeOrgSchema,
} from '@/lib/validation/schemas';
import type { FormState } from '@/lib/validation/result';

function isNextRedirect(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

// Safe message for a thrown error. orgs.ts mutations only ever throw Error with
// our own Hebrew, user-facing messages (never raw DB/provider detail), so it is
// safe to surface err.message; anything else falls back to a generic string.
function safeMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

async function buildJoinLink(token: string): Promise<string> {
  const h = await headers();
  const host = h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}/join/${token}`;
}

// Switch the active organization. Plain form action (not useActionState): the
// requested org id is verified against the caller's memberships server-side
// before the cookie is written — a browser-supplied id is never trusted.
export async function setActiveOrgAction(formData: FormData): Promise<void> {
  const parsed = activeOrgSchema.safeParse({ org_id: formData.get('org_id') });
  if (!parsed.success) return;
  const ctx = await getOrgContext();
  if (!ctx.orgs.some((o) => o.id === parsed.data.org_id)) {
    return;
  }
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, parsed.data.org_id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  revalidatePath('/app', 'layout');
}

export async function inviteMemberAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { orgId } = await requireActiveOrg();
  const parsed = inviteMemberSchema.safeParse({
    email: formData.get('email'),
    role_id: formData.get('role_id'),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  let token: string;
  let email: string;
  try {
    const res = await inviteMember(orgId, parsed.data);
    token = res.token;
    email = res.email;
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: safeMessage(err, 'שליחת ההזמנה נכשלה') };
  }
  revalidatePath('/app/team');
  // Email delivery is wired separately (approval-gated); for now the inviter
  // shares this secure join link directly.
  return {
    notice: `הזמנה נוצרה עבור ${email}. קישור הצטרפות: ${await buildJoinLink(token)}`,
  };
}

export async function changeMemberRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { orgId } = await requireActiveOrg();
  const parsed = changeMemberRoleSchema.safeParse({
    member_id: formData.get('member_id'),
    role_id: formData.get('role_id'),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await changeMemberRole(orgId, parsed.data);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: safeMessage(err, 'שינוי התפקיד נכשל') };
  }
  revalidatePath('/app/team');
  return { notice: 'התפקיד עודכן' };
}

export async function removeMemberAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { orgId } = await requireActiveOrg();
  const parsed = memberIdSchema.safeParse({ member_id: formData.get('member_id') });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await removeMember(orgId, parsed.data.member_id);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: safeMessage(err, 'הסרת החבר נכשלה') };
  }
  revalidatePath('/app/team');
  return { notice: 'החבר הוסר' };
}

export async function resendInvitationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { orgId } = await requireActiveOrg();
  const parsed = invitationIdSchema.safeParse({
    invitation_id: formData.get('invitation_id'),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  let token: string;
  try {
    const res = await resendInvitation(orgId, parsed.data.invitation_id);
    token = res.token;
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: safeMessage(err, 'חידוש ההזמנה נכשל') };
  }
  revalidatePath('/app/team');
  return { notice: `הזמנה חודשה. קישור הצטרפות: ${await buildJoinLink(token)}` };
}

export async function revokeInvitationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { orgId } = await requireActiveOrg();
  const parsed = invitationIdSchema.safeParse({
    invitation_id: formData.get('invitation_id'),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await revokeInvitation(orgId, parsed.data.invitation_id);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: safeMessage(err, 'ביטול ההזמנה נכשל') };
  }
  revalidatePath('/app/team');
  return { notice: 'ההזמנה בוטלה' };
}
