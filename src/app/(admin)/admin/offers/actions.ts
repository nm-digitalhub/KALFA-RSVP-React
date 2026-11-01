'use server';

import { returnValidationErrors } from 'next-safe-action';
import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createOffer, updateOffer, deleteOffer, OfferFloorError } from '@/lib/data/admin/offers';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { offerSchema } from '@/lib/validation/admin';

// Read the offer fields from the form into the shape offerSchema parses. Checkboxes and numbers
// are validated and coerced server-side; nothing is trusted from the browser. `packages` is edited
// as checkbox rows with an optional per-package override and synced into one hidden JSON field
// (the packages module's outreach_schedule_json precedent); malformed/missing JSON becomes `[]`,
// which the schema then refuses (an offer needs at least one package).
function readOfferForm(formData: FormData) {
  const packagesRaw = formData.get('packages_json');
  let packages: unknown = [];
  if (typeof packagesRaw === 'string' && packagesRaw.trim() !== '') {
    try {
      packages = JSON.parse(packagesRaw);
    } catch {
      packages = [];
    }
  }
  return {
    title: formData.get('title'),
    kind: formData.get('kind'),
    value: formData.get('value'),
    validity_days: formData.get('validity_days'),
    allow_agent: formData.get('allow_agent'),
    allow_staff: formData.get('allow_staff'),
    agent_objections: formData.get('agent_objections'),
    may_replace: formData.get('may_replace'),
    is_active: formData.get('is_active'),
    packages,
  };
}

// The form, read by readOfferForm, then held to the shared schema.
const offerInput = z.instanceof(FormData).pipe(z.preprocess(readOfferForm, offerSchema));

// D14's refusal surfaces as a field error on the discount value — the field whose change fixes it.
function floorFieldError(err: OfferFloorError): never {
  return returnValidationErrors(offerSchema, { value: { _errors: [err.message] } });
}

export const createOfferAction = actionClient
  .inputSchema(offerInput)
  .stateAction(async ({ parsedInput }) => {
    try {
      await createOffer(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      if (err instanceof OfferFloorError) floorFieldError(err);
      returnUserError('יצירת ההצעה נכשלה. נסו שוב.');
    }

    revalidatePath('/admin/offers');
    redirect('/admin/offers');
  });

export const updateOfferAction = actionClient
  .inputSchema(offerInput)
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ parsedInput, bindArgsParsedInputs: [id] }) => {
    try {
      await updateOffer(id, parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      if (err instanceof OfferFloorError) floorFieldError(err);
      returnUserError('עדכון ההצעה נכשל. נסו שוב.');
    }

    revalidatePath('/admin/offers');
    revalidatePath(`/admin/offers/${id}`);
    return { notice: 'ההצעה נשמרה' };
  });

// Bound with the id; useActionState supplies the previous result and the form data, neither of which this destructive
// action reads.
export const deleteOfferAction = actionClient
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ bindArgsParsedInputs: [id] }) => {
    await deleteOffer(id);

    revalidatePath('/admin/offers');
    redirect('/admin/offers');
  });
