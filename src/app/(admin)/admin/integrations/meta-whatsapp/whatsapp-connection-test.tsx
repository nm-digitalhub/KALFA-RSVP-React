'use client';

import { useActionState } from 'react';

import { FormError, FormNotice } from '@/components/forms';
import { testWhatsAppConnectionAction } from '@/app/(admin)/admin/channels/actions';

// One live GET against Graph, on demand. Distinct from the SCHEDULED health check
// (whatsapp-health-check, hourly) that feeds "last checked" on the integrations card:
// this one answers "did the value I just typed work", which is a different question
// from "is the channel healthy right now".

export function WhatsAppConnectionTest() {
  const [testState, testAction] = useActionState(testWhatsAppConnectionAction, null);

  return (
      <form action={testAction} className="mt-4 space-y-2">
            <FormError message={testState?.error} />
            <FormNotice message={testState?.notice} />
            <button
              type="submit"
              className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent/40"
            >
              בדיקת חיבור
            </button>
          </form>
  );
}
