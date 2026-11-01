'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { returnValidationErrors } from 'next-safe-action';
import { z } from 'zod';

import { requirePlatformAction } from '@/lib/auth/platform-ability';
import { actionClient, returnUserError } from '@/lib/safe-action';

import {
  createPackage,
  updatePackage,
  deletePackage,
  validateOutreachScheduleForPackage,
} from '@/lib/data/admin/packages';
import { packageBaseSchema, operationalFieldsSchema } from '@/lib/validation/admin';
import type { OperationalFieldsInput, PackageInput } from '@/lib/validation/admin';
import { issuesToFieldErrors, mergeFieldErrors } from '@/lib/validation/result';

// Read the package fields from the form into the shape packageBaseSchema parses.
// Prices/flags are validated and coerced server-side; nothing is trusted from
// the browser.
function readPackageForm(formData: FormData) {
  return {
    name: formData.get('name'),
    tier: formData.get('tier'),
    category: formData.get('category'),
    description: formData.get('description'),
    price_with_vat: formData.get('price_with_vat'),
    includes: formData.get('includes'),
    active: formData.get('active'),
    sort_order: formData.get('sort_order'),
  };
}

// The operational (campaign) fields. `channels` is a multi-select checkbox
// group — MUST use getAll(), not get() (get() returns only the first value
// and can't distinguish "nothing checked" from "field not sent").
// `outreach_schedule` is edited as a structured row-editor in the browser
// and synced into one hidden JSON field; parsed here as controlled JSON
// (never Zod'd directly as a raw string) before being handed to Zod as an
// array. A malformed/missing value becomes `[]`, which Zod then validates
// normally (empty schedule is rejected for a campaign-enabled package).
function readOperationalForm(formData: FormData) {
  const channels = formData.getAll('channels');
  const scheduleRaw = formData.get('outreach_schedule_json');
  let outreach_schedule: unknown = [];
  if (typeof scheduleRaw === 'string' && scheduleRaw.trim() !== '') {
    try {
      outreach_schedule = JSON.parse(scheduleRaw);
    } catch {
      outreach_schedule = [];
    }
  }
  return {
    contact_quota: formData.get('contact_quota'),
    channels,
    outreach_schedule,
  };
}

// A fixed-price quota package is charged once, at its own price: a free one has nothing to charge. The base schema
// allows 0 (a non-campaign package may be free), so the rule that couples the price to the quota lives here.
function fixedPriceErrors(
  base: PackageInput,
  operational: OperationalFieldsInput,
): Record<string, string[]> | null {
  if (operational.contact_quota !== null && base.price_with_vat <= 0) {
    return { price_with_vat: ['בחבילה במחיר קבוע המחיר חייב להיות חיובי'] };
  }
  return null;
}

// Whether the package is campaign-enabled (it has a contact quota): only then are its outreach templates validated,
// so a draft of a non-campaign package may name templates that do not exist yet.
function isCampaignEnabled(operational: OperationalFieldsInput): boolean {
  return operational.contact_quota !== null;
}

// The package form stays FormData and is parsed in the action as before (getAll for the channels, the schedule's JSON
// with its fallback). Its field errors are keyed by the field's dotted path ("outreach_schedule.0.message_key", as
// issuesToFieldErrors builds them): that is how the form finds the touchpoint a message belongs to. They leave one level
// deep (refuse, with fieldPaths naming their key space) and are read back as they are (shapeByPath).
const packageForm = z.instanceof(FormData);
const fieldPaths = z.record(z.string(), z.unknown());

function refuse(fieldErrors: Record<string, string[]>): never {
  return returnValidationErrors(
    fieldPaths,
    Object.fromEntries(Object.entries(fieldErrors).map(([path, messages]) => [path, { _errors: messages }])),
  );
}

function shapeByPath(errors: object): { formErrors: string[]; fieldErrors: Record<string, string[]> } {
  const formErrors: string[] = [];
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, node] of Object.entries(errors)) {
    if (key === '_errors') {
      if (Array.isArray(node)) formErrors.push(...node.map(String));
    } else if (node && typeof node === 'object' && '_errors' in node && Array.isArray(node._errors)) {
      fieldErrors[key] = node._errors.map(String);
    }
  }
  return { formErrors, fieldErrors };
}

const packageFormErrors = { handleValidationErrorsShape: async (errors: object) => shapeByPath(errors) };

// Both package-form actions answer alike, so one form serves both: update says it saved; create redirects instead, and
// declares the same output.
const packageFormOutput = z.object({ notice: z.string() });

// The fields, parsed and checked, or the field errors the form shows.
async function parsePackageForm(formData: FormData) {
  const parsed = packageBaseSchema.safeParse(readPackageForm(formData));
  const operationalParsed = operationalFieldsSchema.safeParse(readOperationalForm(formData));
  if (!parsed.success || !operationalParsed.success) {
    refuse(
      mergeFieldErrors(
        parsed.success ? undefined : issuesToFieldErrors(parsed.error.issues),
        operationalParsed.success ? undefined : issuesToFieldErrors(operationalParsed.error.issues),
      ),
    );
  }

  const priceErrors = fixedPriceErrors(parsed.data, operationalParsed.data);
  if (priceErrors) refuse(priceErrors);

  // Template validation runs only for a campaign-enabled package (one with a contact quota) — campaign-field
  // requirements are never enforced on a non-campaign package, e.g. a future package drafted with touchpoints whose
  // templates don't exist yet.
  const templateErrors = isCampaignEnabled(operationalParsed.data)
    ? await validateOutreachScheduleForPackage(operationalParsed.data.outreach_schedule)
    : [];
  if (templateErrors.length > 0) {
    const fieldErrors: Record<string, string[]> = {};
    for (const { index, message } of templateErrors) {
      (fieldErrors[`outreach_schedule.${index}.message_key`] ??= []).push(message);
    }
    refuse(fieldErrors);
  }

  return { base: parsed.data, operational: operationalParsed.data };
}

// Each action checks the caller's right to it FIRST, in a middleware that runs before any input is validated (the form
// and the bound id alike): a Server Action is reachable by direct POST, and the access-denied redirect propagates as it
// does from the DAL (pilot-casl-package-permissions, task 3.3).

export const createPackageAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformAction('create', 'Package');
    return next();
  })
  .inputSchema(packageForm, packageFormErrors)
  .outputSchema(packageFormOutput)
  .stateAction<z.infer<typeof packageFormOutput>>(async ({ parsedInput: formData }) => {
    const { base, operational } = await parsePackageForm(formData);

    try {
      await createPackage(base, operational);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('יצירת החבילה נכשלה. נסו שוב.');
    }

    revalidatePath('/admin/packages');
    redirect('/admin/packages');
  });

export const updatePackageAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformAction('update', 'Package');
    return next();
  })
  .inputSchema(packageForm, packageFormErrors)
  .outputSchema(packageFormOutput)
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ parsedInput: formData, bindArgsParsedInputs: [id] }) => {
    // Same campaign-enabled gate as createPackageAction.
    const { base, operational } = await parsePackageForm(formData);

    try {
      await updatePackage(id, base, operational);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('עדכון החבילה נכשל. נסו שוב.');
    }

    revalidatePath('/admin/packages');
    revalidatePath(`/admin/packages/${id}`);
    return { notice: 'החבילה נשמרה' };
  });

// Bound with the id; useActionState always supplies (state, formData), neither of which this destructive action reads.
export const deletePackageAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformAction('delete', 'Package');
    return next();
  })
  .inputSchema(z.unknown())
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ bindArgsParsedInputs: [id] }) => {
    await deletePackage(id);

    revalidatePath('/admin/packages');
    redirect('/admin/packages');
  });
