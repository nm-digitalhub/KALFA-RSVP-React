'use client';

import { useActionState } from 'react';

import { FormError, FormNotice } from '@/components/forms';
import { actionErrorMessage } from '@/lib/action-result';
import { testVoximplantConnectionAction } from '@/app/(admin)/admin/integrations/actions';

// One live GetAccountInfo against Voximplant, on demand — it proves the service
// account authenticates and returns the balance. No call is placed.
//
// Distinct from the SCHEDULED voximplant-balance-check queue that feeds "last checked"
// on the integrations card: this one answers "does the JSON I just pasted work", which
// is a different question from "is the account healthy right now".

export function VoximplantConnectionTest() {
  const [state, action] = useActionState(testVoximplantConnectionAction, {});

  return (
    <form action={action} className="mt-4 space-y-2">
      <FormError message={actionErrorMessage(state)} />
      <FormNotice message={state.data?.notice} />
      <button
        type="submit"
        className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent/40"
      >
        בדיקת חיבור (יתרה)
      </button>
    </form>
  );
}
