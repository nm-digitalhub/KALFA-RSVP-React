import { redirect } from 'next/navigation';

import { SubmitButton } from '@/components/forms';
import { resolveAppRedirectPath } from '@/lib/url';
import { confirmOtp } from './actions';
import { isConfirmOtpType } from './otp-types';

// Interstitial landing for Supabase auth email links (recovery / magic-link /
// invite / email-change / email confirmation). We deliberately do NOT verify the
// OTP on GET: this MITIGATES ordinary GET link prefetching (email security
// scanners such as Microsoft Defender Safe Links follow `<a href>` links and would
// consume the single-use token before the user clicks, surfacing as "Token has
// expired or is invalid"). The token is verified only when the user submits this
// form (POST via the confirmOtp Server Action). This is not an absolute guarantee
// — an agent that submits forms could still trigger it — but it defers
// verification past the common prefetch-on-GET behaviour, for every flow that
// routes through /auth/confirm at once. Uses the documented @supabase/ssr
// primitives (token_hash + verifyOtp), only moving the verify from GET to POST.
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const tokenHash = typeof sp.token_hash === 'string' ? sp.token_hash : '';
  const type = typeof sp.type === 'string' ? sp.type : '';
  const rawNext = typeof sp.next === 'string' ? sp.next : '/app';

  // Missing/invalid link params → no point showing the form; land on login.
  if (!tokenHash || !isConfirmOtpType(type)) {
    redirect('/auth/login');
  }

  // Sanitize `next` up front with the shared policy so the hidden field can never
  // carry an off-origin target (the action re-validates it too).
  let next = '/app';
  try {
    next = await resolveAppRedirectPath(rawNext);
  } catch {
    // keep /app
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 text-center">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">אישור הבקשה</h1>
        <p className="text-sm text-muted-foreground">
          כמעט סיימנו — לחצו על הכפתור כדי להמשיך.
        </p>
      </div>

      <form action={confirmOtp} className="space-y-4">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        <SubmitButton>המשך</SubmitButton>
      </form>
    </main>
  );
}
