'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import {
  acknowledgeTemplateCategory,
  updateMessageTemplate,
} from '@/lib/data/message-templates';
import {
  removeTemplateRoute,
  requestTemplateSync,
  saveTemplateParameters,
  setTemplateRoute,
} from '@/lib/data/admin/whatsapp-templates';
import type { FormState } from '@/lib/validation/result';
import { EVENT_TYPES } from '@/lib/validation/schemas';

const schema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().max(200).default(''),
  language: z.string().trim().max(16).default('he'),
  body: z.string().trim().max(4000).default(''),
});

export async function updateTemplateAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = schema.safeParse({
    id: formData.get('id'),
    name: formData.get('name') ?? '',
    language: formData.get('language') ?? '',
    body: formData.get('body') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const active = formData.get('active') === 'on';
  // Fail-closed: a template can only be activated once it has content (the
  // Meta-approved WhatsApp template name, or a call script).
  if (active && !parsed.data.name && !parsed.data.body) {
    return {
      error: 'לא ניתן להפעיל תבנית ללא שם תבנית מאושר / תוכן. מלאו תחילה ושמרו.',
    };
  }

  try {
    await updateMessageTemplate(parsed.data.id, {
      name: parsed.data.name,
      language: parsed.data.language,
      body: parsed.data.body,
      active,
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון התבנית נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/templates');
  return { notice: active ? 'נשמר — התבנית פעילה' : 'התבנית נשמרה' };
}

// Accept Meta's category for a template that drifted (D4). Not a fix — Meta
// classifies by message body and the template goes on being billed as MARKETING;
// this records that we expect it, so the badge clears, the nightly alert stops,
// and a LATER move by Meta alerts again as a new transition.
//
// The category the admin was LOOKING AT is posted alongside the id and the DAL
// pins the write to it, so a sync landing between page load and click cannot get a
// different value accepted silently.
const acknowledgeSchema = z.object({
  id: z.uuid(),
  observed_category: z.string().trim().min(1).max(32),
});

export async function acknowledgeTemplateCategoryAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = acknowledgeSchema.safeParse({
    id: formData.get('id'),
    observed_category: formData.get('observed_category') ?? '',
  });
  if (!parsed.success) return { error: 'בקשה לא תקינה' };

  try {
    const result = await acknowledgeTemplateCategory(
      parsed.data.id,
      parsed.data.observed_category,
    );
    if (!result.ok) return { error: result.reason };
    revalidatePath('/admin/templates');
    return {
      notice: `הקטגוריה ${result.to} אושרה — ההתראה על הפער תיפסק. החיוב והמגבלות של הקטגוריה הזו נשארים בתוקף.`,
    };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'אישור הקטגוריה נכשל. נסו שוב.' };
  }
}

// --- WhatsApp routes and variables (step 8, whatsapp-templates-meta-mirror) ---
//
// Called with the form's data object (JSON Forms), not FormData. Every input is
// re-validated here and again in the data layer against the live template;
// nothing the browser sends is trusted.

export type TemplateAdminActionResult =
  | { ok: true; warning?: string }
  | { ok: false; problems: string[] };

const INVALID: TemplateAdminActionResult = { ok: false, problems: ['בקשה לא תקינה'] };
const FAILED: TemplateAdminActionResult = { ok: false, problems: ['השמירה נכשלה. נסו שוב.'] };

const messageKey = z.string().trim().min(1).max(64);
const routeTarget = z.object({
  messageKey,
  eventType: z.enum(EVENT_TYPES).nullable(),
  withMedia: z.boolean(),
});

export async function setTemplateRouteAction(input: unknown): Promise<TemplateAdminActionResult> {
  const parsed = routeTarget.extend({ templateId: z.string().regex(/^\d{1,32}$/) }).safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    const result = await setTemplateRoute(parsed.data);
    if (result.ok) revalidatePath('/admin/templates');
    return result;
  } catch (err) {
    unstable_rethrow(err);
    return FAILED;
  }
}

export async function removeTemplateRouteAction(input: unknown): Promise<TemplateAdminActionResult> {
  const parsed = routeTarget.safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    const result = await removeTemplateRoute(parsed.data);
    if (result.ok) revalidatePath('/admin/templates');
    return result;
  } catch (err) {
    unstable_rethrow(err);
    return FAILED;
  }
}

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

export async function saveTemplateParametersAction(input: unknown): Promise<TemplateAdminActionResult> {
  const parsed = parametersSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    const result = await saveTemplateParameters(parsed.data);
    if (result.ok) revalidatePath('/admin/templates');
    return result;
  } catch (err) {
    unstable_rethrow(err);
    return FAILED;
  }
}

export async function requestTemplateSyncAction(): Promise<TemplateAdminActionResult> {
  try {
    await requestTemplateSync();
    return { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, problems: ['לא הצלחנו לבקש סנכרון. נסו שוב.'] };
  }
}
