'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

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
export async function connectEmbeddedSignupAction(input: unknown): Promise<EsConnectResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'נתוני החיבור אינם תקינים' };

  try {
    const result = await connectViaEmbeddedSignup(parsed.data);
    revalidatePath('/admin/integrations/meta-whatsapp/connect');
    return result;
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, message: 'החיבור נכשל. נסו שוב.' };
  }
}
