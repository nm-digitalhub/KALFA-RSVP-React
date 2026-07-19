'use client';

import { useActionState } from 'react';

import { FormError, FormNotice } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';
import { saveElevenLabsKeyAction } from '../actions';

// Write-only secret field for the ElevenLabs API key. Never pre-filled with the
// stored value (only its presence + source is shown by the parent). Blank submit
// clears the DB override (but NOT the env fallback — the label says so).
export function ElevenLabsKeyForm({
  keySource,
}: {
  keySource: 'db' | 'env' | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveElevenLabsKeyAction,
    null,
  );
  const label =
    keySource === 'db'
      ? 'מפתח ElevenLabs API (מוגדר ב־DB — הזן חדש להחלפה, ריק לניקוי)'
      : keySource === 'env'
        ? 'מפתח ElevenLabs API (מגיע מ־env ELEVENLABS_API_KEY — הזן כאן כדי לדרוס ב־DB)'
        : 'מפתח ElevenLabs API (לא מוגדר)';
  return (
    <form action={action} className="space-y-2">
      <label className="block text-sm text-muted-foreground" htmlFor="elevenlabs_api_key">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="elevenlabs_api_key"
          name="elevenlabs_api_key"
          type="password"
          dir="ltr"
          autoComplete="off"
          placeholder="xi-…"
          className="min-w-64 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          {pending ? 'שומר…' : 'שמור'}
        </button>
      </div>
      <FormNotice message={state?.notice} />
      <FormError message={state?.error} />
    </form>
  );
}
