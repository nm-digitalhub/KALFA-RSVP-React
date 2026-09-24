'use client';

import { useActionState, useState } from 'react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PhoneInput } from '@/components/ui/phone-input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  OwnerAgentAllowlistEntry,
  OwnerAgentStaffOption,
} from '@/lib/data/admin/owner-agent';

import {
  addAllowlistEntryAction,
  relabelAllowlistEntryAction,
  removeAllowlistEntryAction,
  setAllowlistEntryEnabledAction,
} from './actions';

// The allow-list: which phones may reach the agent, and as which staff member.
// Creating a row IS the grant; `enabled` is for a temporary suspension.
//
// Each row says whether its number equals that staff member's VERIFIED phone. The
// agent's gate refuses a row without that match (plan §3.1, phone_unverified), so a
// mismatch here is shown as the reason the agent will stay silent — not left for the
// owner to discover from a missing reply. Numbers arrive masked; the full number is
// never sent to the browser, and the match itself was computed on the server.

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';

function staffName(name: string | null): string {
  return name ?? 'ללא שם';
}

function MatchBadge({ entry }: { entry: OwnerAgentAllowlistEntry }) {
  if (!entry.isStaff) return <Badge variant="destructive">אינו איש צוות</Badge>;
  if (entry.verifiedMatch) return <Badge variant="success">תואם לטלפון המאומת</Badge>;
  return <Badge variant="warning">לא תואם לטלפון המאומת</Badge>;
}

function RelabelForm({ entry }: { entry: OwnerAgentAllowlistEntry }) {
  const [state, action] = useActionState(relabelAllowlistEntryAction, null);
  const inputId = `allowlist-label-${entry.id}`;
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="id" value={entry.id} />
      <div className="flex items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          {`תווית עבור ${entry.maskedNumber}`}
        </label>
        <input
          id={inputId}
          name="label"
          defaultValue={entry.label ?? ''}
          maxLength={120}
          placeholder="ללא תווית"
          className={`${inputClass} min-w-32`}
        />
        <SubmitButton className="w-auto" size="sm">
          שמירה<span className="sr-only">{` תווית עבור ${entry.maskedNumber}`}</span>
        </SubmitButton>
      </div>
      <FieldError errors={state?.fieldErrors?.label} />
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

// Every row has the same buttons, so each one carries the row's masked number for a
// screen reader — "השבתה" alone, heard while tabbing through a table, names no row.
function RowActions({ entry }: { entry: OwnerAgentAllowlistEntry }) {
  const [toggleState, toggleAction] = useActionState(setAllowlistEntryEnabledAction, null);
  const [removeState, removeAction] = useActionState(removeAllowlistEntryAction, null);
  // Two steps for removal. It is recoverable (add the number again), but it cuts a
  // person off from the agent at once, and one mis-click in a table is easy.
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <form action={toggleAction}>
          <input type="hidden" name="id" value={entry.id} />
          <input type="hidden" name="enabled" value={entry.enabled ? 'false' : 'true'} />
          <SubmitButton className="w-auto" size="sm">
            {entry.enabled ? 'השבתה' : 'הפעלה'}
            <span className="sr-only">{` ${entry.maskedNumber}`}</span>
          </SubmitButton>
        </form>
        {confirming ? (
          <form action={removeAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={entry.id} />
            <SubmitButton className="w-auto" size="sm">
              אישור הסרה<span className="sr-only">{` ${entry.maskedNumber}`}</span>
            </SubmitButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`ביטול הסרה ${entry.maskedNumber}`}
              onClick={() => setConfirming(false)}
            >
              ביטול
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`הסרה ${entry.maskedNumber}`}
            onClick={() => setConfirming(true)}
          >
            הסרה
          </Button>
        )}
      </div>
      <FormError message={toggleState?.error ?? removeState?.error} />
      <FormNotice message={toggleState?.notice} />
    </div>
  );
}

function AddEntryForm({ staff }: { staff: OwnerAgentStaffOption[] }) {
  const [state, action] = useActionState(addAllowlistEntryAction, null);
  // PhoneInput is controlled; it never rewrites what was typed. Normalisation to
  // E.164 happens once, on the server, in allowlistPhoneSchema.
  const [phone, setPhone] = useState('');

  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
      <h3 className="text-sm font-semibold">הוספת טלפון לרשימה</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label htmlFor="allowlist-e164" className="mb-1 block text-sm font-medium">
            טלפון
          </label>
          <PhoneInput
            id="allowlist-e164"
            name="e164"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-describedby="allowlist-e164-hint"
            aria-invalid={state?.fieldErrors?.e164 ? true : undefined}
          />
          <p id="allowlist-e164-hint" className="mt-1 text-xs text-muted-foreground">
            עם קידומת מדינה (+972…) או מספר ישראלי שמתחיל ב-0.
          </p>
          <FieldError errors={state?.fieldErrors?.e164} />
        </div>
        <div>
          <label htmlFor="allowlist-staff" className="mb-1 block text-sm font-medium">
            איש צוות
          </label>
          <select
            id="allowlist-staff"
            name="staffUserId"
            required
            defaultValue=""
            aria-invalid={state?.fieldErrors?.staffUserId ? true : undefined}
            className={inputClass}
          >
            <option value="" disabled>
              בחירת איש צוות
            </option>
            {staff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {[
                  staffName(s.name),
                  s.roleLabel,
                  s.hasVerifiedPhone ? null : 'אין טלפון מאומת',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </option>
            ))}
          </select>
          <FieldError errors={state?.fieldErrors?.staffUserId} />
        </div>
        <div>
          <label htmlFor="allowlist-label" className="mb-1 block text-sm font-medium">
            תווית (לא חובה)
          </label>
          <input id="allowlist-label" name="label" maxLength={120} className={inputClass} />
          <FieldError errors={state?.fieldErrors?.label} />
        </div>
      </div>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <SubmitButton className="w-auto">הוספה</SubmitButton>
    </form>
  );
}

export function AllowlistPanel({
  entries,
  staff,
}: {
  entries: OwnerAgentAllowlistEntry[];
  staff: OwnerAgentStaffOption[];
}) {
  return (
    <div className="space-y-4">
      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          הרשימה ריקה. כל עוד אין בה טלפון פעיל, אף הודעה לא מגיעה לסוכן.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>טלפון</TableHead>
              <TableHead>איש צוות</TableHead>
              <TableHead>אימות</TableHead>
              <TableHead>מצב</TableHead>
              <TableHead>תווית</TableHead>
              <TableHead>פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id} className="align-top">
                <TableCell>
                  <span dir="ltr" className="tabular-nums">
                    {entry.maskedNumber}
                  </span>
                </TableCell>
                <TableCell className="wrap-anywhere">{staffName(entry.staffName)}</TableCell>
                <TableCell>
                  <MatchBadge entry={entry} />
                </TableCell>
                <TableCell>
                  {entry.enabled ? (
                    <Badge variant="success">פעיל</Badge>
                  ) : (
                    <Badge variant="neutral">מושבת</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <RelabelForm entry={entry} />
                </TableCell>
                <TableCell>
                  <RowActions entry={entry} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {staff.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          אין אנשי צוות פלטפורמה. רק איש צוות יכול להופיע ברשימת ההיתר.
        </p>
      ) : (
        <AddEntryForm staff={staff} />
      )}
    </div>
  );
}
