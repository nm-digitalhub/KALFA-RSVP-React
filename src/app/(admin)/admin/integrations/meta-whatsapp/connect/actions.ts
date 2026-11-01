'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { actionClient, returnUserError } from '@/lib/safe-action';
import {
  connectViaEmbeddedSignup,
  type EsConnectResult,
} from '@/lib/data/admin/integrations/whatsapp-es';

const schema = z.object({
  code: z.string().min(10).max(2048),
  finishEvent: z.enum(['FINISH', 'FINISH_ONLY_WABA', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING']),
});

// The gate is requirePlatformOwner INSIDE connectViaEmbeddedSignup: a Server
// Action is reachable without rendering the page that submits to it. Called
// with a plain object rather than a form, because the launcher fires it from
// the FB.login callback within the code's 30-second life.
export const connectEmbeddedSignupAction = actionClient
  .inputSchema(schema, {
    // Whatever is wrong with the input, the admin gets one sentence.
    handleValidationErrorsShape: async () => ({ formErrors: ['נתוני החיבור אינם תקינים'], fieldErrors: {} }),
  })
  .action(async ({ parsedInput }) => {
    let result: EsConnectResult;
    try {
      result = await connectViaEmbeddedSignup(parsedInput);
      revalidatePath('/admin/integrations/meta-whatsapp/connect');
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('החיבור נכשל. נסו שוב.');
    }
    if (!result.ok) returnUserError(result.message);
    return result;
  });
