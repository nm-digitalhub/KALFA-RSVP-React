'use server';

import { zfd } from 'zod-form-data';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';

import { ACTIVE_ORG_COOKIE, getOrgContext, requireActiveOrg } from '@/lib/auth/dal';
import { getAppUrl } from '@/lib/url';
import {
  inviteMember,
  resendInvitation,
  revokeInvitation,
  changeMemberRole,
  removeMember,
} from '@/lib/data/orgs';
import { actionClient, returnUserError } from '@/lib/safe-action';
import {
  inviteMemberSchema,
  changeMemberRoleSchema,
  memberIdSchema,
  invitationIdSchema,
  activeOrgSchema,
} from '@/lib/validation/schemas';

// The forms post exactly the fields these schemas name, so each action's input is the shared schema read from the
// FormData as posted (zfd.formData): a failed field comes back with the schema's own Hebrew message.
//
// The member/invitation actions resolve the active org (requireActiveOrg — from the cookie, never a browser-supplied
// org id) BEFORE their input is read, as they always did: each runs it in a pre-validation middleware (`use()` runs
// ahead of the input schema), which hands the org to the body as ctx.

// A failed mutation. orgs.ts mutations only ever throw Error with our own
// Hebrew, user-facing messages (never raw DB/provider detail): those go on to
// the client's error policy (src/lib/safe-action.ts), which passes them
// through unchanged. A rejection that is not an Error (or carries no message)
// has nothing to show, so the action's own fallback is sent instead.
function rethrowOrFallback(err: unknown, fallback: string): never {
  unstable_rethrow(err);
  if (err instanceof Error && err.message) throw err;
  return returnUserError(fallback);
}

async function buildJoinLink(token: string): Promise<string> {
  return getAppUrl(`/join/${token}`);
}

// Switch the active organization. Plain form action (not useActionState): the
// requested org id is verified against the caller's memberships server-side
// before the cookie is written — a browser-supplied id is never trusted. An
// invalid id or one the caller is not a member of changes nothing.
export const setActiveOrgAction = actionClient
  .inputSchema(zfd.formData(activeOrgSchema))
  .action(async ({ parsedInput: { org_id } }) => {
    const ctx = await getOrgContext();
    if (!ctx.orgs.some((o) => o.id === org_id)) {
      return;
    }
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_ORG_COOKIE, org_id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    revalidatePath('/app', 'layout');
  });

export const inviteMemberAction = actionClient
  .use(async ({ next }) => next({ ctx: await requireActiveOrg() }))
  .inputSchema(zfd.formData(inviteMemberSchema))
  .stateAction(async ({ parsedInput, ctx: { orgId } }) => {
    let token: string;
    let email: string;
    try {
      const res = await inviteMember(orgId, parsedInput);
      token = res.token;
      email = res.email;
    } catch (err) {
      rethrowOrFallback(err, 'שליחת ההזמנה נכשלה');
    }
    revalidatePath('/app/team');
    // Email delivery is wired separately (approval-gated); for now the inviter
    // shares this secure join link directly.
    return {
      notice: `הזמנה נוצרה עבור ${email}. קישור הצטרפות: ${await buildJoinLink(token)}`,
    };
  });

export const changeMemberRoleAction = actionClient
  .use(async ({ next }) => next({ ctx: await requireActiveOrg() }))
  .inputSchema(zfd.formData(changeMemberRoleSchema))
  .stateAction(async ({ parsedInput, ctx: { orgId } }) => {
    try {
      await changeMemberRole(orgId, parsedInput);
    } catch (err) {
      rethrowOrFallback(err, 'שינוי התפקיד נכשל');
    }
    revalidatePath('/app/team');
    return { notice: 'התפקיד עודכן' };
  });

export const removeMemberAction = actionClient
  .use(async ({ next }) => next({ ctx: await requireActiveOrg() }))
  .inputSchema(zfd.formData(memberIdSchema))
  .stateAction(async ({ parsedInput, ctx: { orgId } }) => {
    try {
      await removeMember(orgId, parsedInput.member_id);
    } catch (err) {
      rethrowOrFallback(err, 'הסרת החבר נכשלה');
    }
    revalidatePath('/app/team');
    return { notice: 'החבר הוסר' };
  });

export const resendInvitationAction = actionClient
  .use(async ({ next }) => next({ ctx: await requireActiveOrg() }))
  .inputSchema(zfd.formData(invitationIdSchema))
  .stateAction(async ({ parsedInput, ctx: { orgId } }) => {
    let token: string;
    try {
      const res = await resendInvitation(orgId, parsedInput.invitation_id);
      token = res.token;
    } catch (err) {
      rethrowOrFallback(err, 'חידוש ההזמנה נכשל');
    }
    revalidatePath('/app/team');
    return { notice: `הזמנה חודשה. קישור הצטרפות: ${await buildJoinLink(token)}` };
  });

export const revokeInvitationAction = actionClient
  .use(async ({ next }) => next({ ctx: await requireActiveOrg() }))
  .inputSchema(zfd.formData(invitationIdSchema))
  .stateAction(async ({ parsedInput, ctx: { orgId } }) => {
    try {
      await revokeInvitation(orgId, parsedInput.invitation_id);
    } catch (err) {
      rethrowOrFallback(err, 'ביטול ההזמנה נכשל');
    }
    revalidatePath('/app/team');
    return { notice: 'ההזמנה בוטלה' };
  });
