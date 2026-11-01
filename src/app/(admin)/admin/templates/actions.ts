'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import {
  acknowledgeTemplateCategory,
  updateMessageTemplate,
} from '@/lib/data/message-templates';
import {
  acknowledgeWhatsAppTemplateCategory,
  removeTemplateRoute,
  requestTemplateSync,
  saveTemplateParameters,
  setTemplateRoute,
  setWhatsAppStepActive,
} from '@/lib/data/admin/whatsapp-templates';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { EVENT_TYPES } from '@/lib/validation/schemas';

// The edit form: a missing text field counts as blank (''), and `active` is the checkbox (absent when unchecked).
const updateTemplateSchema = zfd.formData({
  id: z.uuid(),
  name: z.string().trim().max(200).prefault(''),
  language: z.string().trim().max(16).prefault(''),
  body: z.string().trim().max(4000).prefault(''),
  active: z.preprocess((v) => v === 'on', z.boolean()),
});

export const updateTemplateAction = actionClient
  .inputSchema(updateTemplateSchema)
  .stateAction(async ({ parsedInput: { id, name, language, body, active } }) => {
    // Fail-closed: a template can only be activated once it has content (the
    // Meta-approved WhatsApp template name, or a call script).
    if (active && !name && !body) {
      returnUserError('לא ניתן להפעיל תבנית ללא שם תבנית מאושר / תוכן. מלאו תחילה ושמרו.');
    }

    try {
      await updateMessageTemplate(id, { name, language, body, active });
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('עדכון התבנית נכשל. נסו שוב.');
    }

    revalidatePath('/admin/templates');
    return { notice: active ? 'נשמר — התבנית פעילה' : 'התבנית נשמרה' };
  });

// Accept Meta's category for a template that drifted. Not a fix — Meta
// classifies by message body and the template goes on being billed under Meta's category;
// this records that we expect it, so the badge clears, the nightly alert stops,
// and a LATER move by Meta alerts again as a new transition.
//
// The category the admin was LOOKING AT is posted alongside the id and the DAL
// pins the write to it, so a sync landing between page load and click cannot get a
// different value accepted silently.
const acknowledgeSchema = zfd.formData({
  id: z.uuid(),
  observed_category: z.string().trim().min(1).max(32).prefault(''),
});

// Any request that fails its schema gets this one line, never the schema's own messages.
const invalidRequest = {
  handleValidationErrorsShape: async () => ({ formErrors: ['בקשה לא תקינה'], fieldErrors: {} }),
};

export const acknowledgeTemplateCategoryAction = actionClient
  .inputSchema(acknowledgeSchema, invalidRequest)
  .stateAction(async ({ parsedInput: { id, observed_category } }) => {
    let result: Awaited<ReturnType<typeof acknowledgeTemplateCategory>>;
    try {
      result = await acknowledgeTemplateCategory(id, observed_category);
      if (result.ok) revalidatePath('/admin/templates');
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('אישור הקטגוריה נכשל. נסו שוב.');
    }
    if (!result.ok) returnUserError(result.reason);
    return {
      notice: `הקטגוריה ${result.to} אושרה — ההתראה על הפער תיפסק. החיוב והמגבלות של הקטגוריה הזו נשארים בתוקף.`,
    };
  });

// --- WhatsApp routes and variables ---
//
// Called with plain objects, not FormData (the variables form's data comes from
// JSON Forms). Every input is re-validated here and again in the data layer
// against the live template; nothing the browser sends is trusted. What the
// data layer answers ({ ok, warning } / { ok: false, problems }) comes back as
// the result's `data`; a bad request or a thrown failure as one line
// (validationErrors.formErrors / serverError).

export type TemplateAdminActionResult =
  | { ok: true; warning?: string }
  | { ok: false; problems: string[] };

// The list and guest-journey view, and every template's own page. Two calls:
// there is no layout.tsx at /admin/templates for a 'layout' revalidation to hang on.
function revalidateTemplates(): void {
  revalidatePath('/admin/templates');
  revalidatePath('/admin/templates/[templateId]', 'page');
}

// A failure the data layer did not report (it threw) gets one generic line; a bad request gets invalidRequest's.
const SAVE_FAILED = 'השמירה נכשלה. נסו שוב.';

const messageKey = z.string().trim().min(1).max(64);
const routeTarget = z.object({
  messageKey,
  eventType: z.enum(EVENT_TYPES).nullable(),
  withMedia: z.boolean(),
});

export const setTemplateRouteAction = actionClient
  .inputSchema(routeTarget.extend({ templateId: z.string().regex(/^\d{1,32}$/) }), invalidRequest)
  .action(async ({ parsedInput }) => {
    try {
      const result = await setTemplateRoute(parsedInput);
      if (result.ok) revalidateTemplates();
      return result;
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(SAVE_FAILED);
    }
  });

export const removeTemplateRouteAction = actionClient
  .inputSchema(routeTarget, invalidRequest)
  .action(async ({ parsedInput }) => {
    try {
      const result = await removeTemplateRoute(parsedInput);
      if (result.ok) revalidateTemplates();
      return result;
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(SAVE_FAILED);
    }
  });

const parametersSchema = z.object({
  templateId: z.string().regex(/^\d{1,32}$/),
  values: z
    .array(
      z.object({
        type: z.enum(['header', 'body', 'button']),
        sub_type: z.string().max(32).nullable(),
        index: z.number().int().min(0).max(10).nullable(),
        position: z.number().int().min(1).max(100),
        source_path: z.string().trim().min(1).max(128),
      }),
    )
    .max(100),
});

export const saveTemplateParametersAction = actionClient
  .inputSchema(parametersSchema, invalidRequest)
  .action(async ({ parsedInput }) => {
    try {
      const result = await saveTemplateParameters(parsedInput);
      if (result.ok) revalidateTemplates();
      return result;
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(SAVE_FAILED);
    }
  });

export const requestTemplateSyncAction = actionClient.action(async (): Promise<TemplateAdminActionResult> => {
  try {
    await requestTemplateSync();
    return { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    returnUserError('לא הצלחנו לבקש סנכרון. נסו שוב.');
  }
});

export const setStepActiveAction = actionClient
  .inputSchema(z.object({ messageKey, active: z.boolean() }), invalidRequest)
  .action(async ({ parsedInput }) => {
    try {
      const result = await setWhatsAppStepActive(parsedInput);
      if (result.ok) revalidateTemplates();
      return result;
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(SAVE_FAILED);
    }
  });

export const acknowledgeWhatsAppCategoryAction = actionClient
  .inputSchema(
    z.object({ templateId: z.string().regex(/^\d{1,32}$/), observedCategory: z.string().trim().min(1).max(32) }),
    invalidRequest,
  )
  .action(async ({ parsedInput }) => {
    try {
      const result = await acknowledgeWhatsAppTemplateCategory(parsedInput);
      if (result.ok) revalidateTemplates();
      return result;
    } catch (err) {
      unstable_rethrow(err);
      returnUserError(SAVE_FAILED);
    }
  });
