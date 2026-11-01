'use server';

import { revalidatePath } from 'next/cache';
import { returnValidationErrors } from 'next-safe-action';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import { requirePlatformOwner } from '@/lib/auth/dal';
import {
  assignStaffRole,
  blockConsoleAgent,
  createPlatformRole,
  enrollConsoleAgent,
  removeConsoleAgent,
  revokeStaffRole,
  setRolePermission,
  unblockConsoleAgent,
} from '@/lib/data/admin/platform-roles';
import { actionClient, returnUserError } from '@/lib/safe-action';

// Server Actions for the platform (Owner/Staff) RBAC screen. Every action:
//   1. re-verifies requirePlatformOwner() FIRST, before its input is validated
//      (an action-level use() middleware runs before validation) — belt-and-
//      suspenders on top of the page-level gate and the data-layer gate,
//   2. validates input with Zod,
//   3. delegates to the data layer (service-role writes + audit + Slack),
//   4. revalidates the affected paths,
//   5. returns a result the client can render / roll back on.
// A thrown data-layer message reaches the admin through the action client.

const ROLES_PATH = '/admin/roles';

// The id-only actions answer any malformed input with the one message 'ערך לא תקין'.
const INVALID_VALUE = 'ערך לא תקין';

// Toggle one (role, permission) matrix cell. Called directly by the client
// Switch (optimistic + revert on an error), so it takes a typed object rather
// than FormData — mirrors setAlertToggleAction in ../integrations/slack/actions.ts.
const setRolePermissionSchema = z.object({
  roleId: z.uuid({ error: INVALID_VALUE }),
  permissionId: z.uuid({ error: INVALID_VALUE }),
  granted: z.boolean({ error: INVALID_VALUE }),
});

export const setRolePermissionAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformOwner();
    return next();
  })
  .inputSchema(setRolePermissionSchema)
  .action(async ({ parsedInput }) => {
    await setRolePermission(parsedInput.roleId, parsedInput.permissionId, parsedInput.granted);
    revalidatePath(ROLES_PATH);
    return { notice: 'נשמר' };
  });

// Create a new platform role (starts with zero permissions).
const createRoleSchema = z.object({
  // Machine name: lowercase letters/digits/underscore, used as a stable key.
  name: z
    .string()
    .trim()
    .min(2, { message: 'שם קצר מדי' })
    .max(50, { message: 'שם ארוך מדי' })
    .regex(/^[a-z][a-z0-9_]*$/, {
      message: 'שם התפקיד באנגלית קטנה, ספרות וקו תחתון בלבד',
    }),
  label: z
    .string()
    .trim()
    .min(2, { message: 'תווית קצרה מדי' })
    .max(80, { message: 'תווית ארוכה מדי' }),
});

// An absent field reads as '' (and gets the schema's own message).
export const createPlatformRoleAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformOwner();
    return next();
  })
  .inputSchema(
    zfd.formData({
      name: createRoleSchema.shape.name.prefault(''),
      label: createRoleSchema.shape.label.prefault(''),
    }),
  )
  .stateAction(async ({ parsedInput }) => {
    await createPlatformRole(parsedInput.name, parsedInput.label);
    revalidatePath(ROLES_PATH);
    return { notice: 'התפקיד נוצר' };
  });

// Assign a platform role to a user (single role per user). Called from the user
// detail screen's staff selector; revalidates both that page and the roles page.
const assignStaffSchema = z.object({
  userId: z.uuid({ error: INVALID_VALUE }),
  roleId: z.uuid({ error: INVALID_VALUE }),
});

export const assignStaffRoleAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformOwner();
    return next();
  })
  .inputSchema(assignStaffSchema)
  .action(async ({ parsedInput }) => {
    await assignStaffRole(parsedInput.userId, parsedInput.roleId);
    revalidatePath(ROLES_PATH);
    revalidatePath(`/admin/users/${parsedInput.userId}`);
    return { notice: 'התפקיד הוקצה' };
  });

// Revoke a user's platform staff membership (the DB last-owner guard may reject).
const revokeStaffSchema = z.object({ userId: z.uuid({ error: INVALID_VALUE }) });

export const revokeStaffRoleAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformOwner();
    return next();
  })
  .inputSchema(revokeStaffSchema)
  .action(async ({ parsedInput }) => {
    await revokeStaffRole(parsedInput.userId);
    revalidatePath(ROLES_PATH);
    revalidatePath(`/admin/users/${parsedInput.userId}`);
    return { notice: 'התפקיד נשלל' };
  });

// Enrol / remove a HUMAN call-console representative — the person who monitors
// the AI agent's calls and can take one over (human_agent_call_legs.mode is
// 'monitor' | 'takeover'). Not to be confused with the ElevenLabs voice agent.
// Sibling of the staff pair above: the DB requires them to be platform staff, so
// this only ever narrows an existing staff membership — it can never grant
// platform access on its own.
const enrollConsoleAgentSchema = z.object({
  userId: z.uuid(),
  displayName: z
    .string()
    .trim()
    .min(2, { message: 'שם התצוגה קצר מדי' })
    .max(80, { message: 'שם התצוגה ארוך מדי' }),
});

export const enrollConsoleAgentAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformOwner();
    return next();
  })
  .inputSchema(enrollConsoleAgentSchema)
  .action(async ({ parsedInput }) => {
    const provisioning = await enrollConsoleAgent(parsedInput.userId, parsedInput.displayName);
    // Voximplant must succeed BEFORE any local access is granted (owner
    // directive) — so a failed provisioning means the enrolment did not happen
    // AT ALL, not "added but incomplete". Code 157 ("The 'user_display_name'
    // parameter is invalid" — verified live against voximplant.com/api/v2/
    // getDoc?fqdn=references.httpapi.errors, 2026-08-21) is the one case
    // attributable to a specific field.
    if (!provisioning.ok) {
      if (provisioning.reason === 'api_failed' && provisioning.voxErrorCode === 157) {
        return returnValidationErrors(enrollConsoleAgentSchema, {
          _errors: ['הוספת הנציג נכשלה — שם התצוגה נדחה על ידי מערכת השיחות.'],
          displayName: { _errors: ['שם התצוגה נדחה על ידי מערכת השיחות — נסו שם אחר.'] },
        });
      }
      return returnUserError(
        `הוספת הנציג נכשלה — לא ניתן היה ליצור עבורו זהות במערכת השיחות (${provisioning.reason}). נסו שוב.`,
      );
    }
    revalidatePath(ROLES_PATH);
    revalidatePath(`/admin/users/${parsedInput.userId}`);
    return { notice: 'הנציג נוסף למוקד' };
  });

const removeConsoleAgentSchema = z.object({ userId: z.uuid({ error: INVALID_VALUE }) });

export const removeConsoleAgentAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformOwner();
    return next();
  })
  .inputSchema(removeConsoleAgentSchema)
  .action(async ({ parsedInput }) => {
    const outcome = await removeConsoleAgent(parsedInput.userId);
    // Removal depends on Voximplant (owner directive): a failed deletion
    // there means the removal did NOT happen — the agent is still enrolled,
    // locally too. This must read as a real failure, not a completed removal
    // with a side note.
    if (!outcome.ok) {
      return returnUserError(
        `הסרת הנציג נכשלה — מחיקת הזהות שלו ב-Voximplant (${outcome.voxUsername}) לא הצליחה (${outcome.reason}). הנציג עדיין רשום במוקד. נסו שוב.`,
      );
    }
    revalidatePath(ROLES_PATH);
    revalidatePath(`/admin/users/${parsedInput.userId}`);
    return { notice: 'הנציג הוסר מהמוקד' };
  });

const setConsoleAgentActiveSchema = z.object({ userId: z.uuid({ error: INVALID_VALUE }) });

function voxActiveFailureText(reason: 'not_provisioned' | 'not_configured' | 'api_failed'): string {
  if (reason === 'not_provisioned') return 'לנציג זה אין זהות במערכת השיחות — אין מה לחסום.';
  return `הפעולה נכשלה במערכת השיחות (${reason}). נסו שוב.`;
}

// Block a console agent — deactivates the Voximplant identity FIRST; the
// local vox_active flag (what is_console_agent() actually checks) is written
// only once that succeeds. See setConsoleAgentVoxActive for the full
// rationale.
export const blockConsoleAgentAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformOwner();
    return next();
  })
  .inputSchema(setConsoleAgentActiveSchema)
  .action(async ({ parsedInput }) => {
    const outcome = await blockConsoleAgent(parsedInput.userId);
    if (!outcome.ok) return returnUserError(voxActiveFailureText(outcome.reason));
    revalidatePath(ROLES_PATH);
    revalidatePath(`/admin/users/${parsedInput.userId}`);
    return { notice: 'הנציג נחסם' };
  });

export const unblockConsoleAgentAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformOwner();
    return next();
  })
  .inputSchema(setConsoleAgentActiveSchema)
  .action(async ({ parsedInput }) => {
    const outcome = await unblockConsoleAgent(parsedInput.userId);
    if (!outcome.ok) return returnUserError(voxActiveFailureText(outcome.reason));
    revalidatePath(ROLES_PATH);
    revalidatePath(`/admin/users/${parsedInput.userId}`);
    return { notice: 'החסימה בוטלה' };
  });
