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
import { Textarea } from '@/components/ui/textarea';
import type {
  OwnerAgentAllowlistEntry,
  OwnerAgentStaffOption,
} from '@/lib/data/admin/owner-agent';
import { formatIsraelDateTime } from '@/lib/date';

import {
  addAllowlistEntryAction,
  addExternalAllowlistEntryAction,
  approveUnverifiedStaffAction,
  relabelAllowlistEntryAction,
  removeAllowlistEntryAction,
  revokeManualApprovalAction,
  setAllowlistEntryEnabledAction,
} from './actions';

// The allow-list: which phones may reach the agent, and as which staff member.
// Creating a row IS the grant; `enabled` is for a temporary suspension.
//
// Each row says whether its number equals that staff member's VERIFIED phone. The
// agent's gate refuses a verified_staff row without that match (plan §3.1,
// phone_unverified), so a mismatch here is shown as the reason the agent will stay
// silent — not left for the owner to discover from a missing reply. Numbers arrive
// masked; the full number is never sent to the browser, and the match itself was
// computed on the server.
//
// Manual approval (plans/owner-agent-allowlist-override-plan.md): the owner may let
// through, with a written reason, a staff member whose phone is not verified ("אשר
// ידנית" on that row) or a person who is not staff ("אדם חיצוני" in the add form).
// Every approval and revocation is logged by the DAL.

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';

function staffName(name: string | null): string {
  return name ?? 'ללא שם';
}

function MatchBadge({ entry }: { entry: OwnerAgentAllowlistEntry }) {
  if (entry.approvalKind === 'external_override') return <Badge variant="info">חיצוני · אושר ידנית</Badge>;
  if (!entry.isStaff) return <Badge variant="destructive">אינו איש צוות</Badge>;
  if (entry.approvalKind === 'staff_unverified_override') return <Badge variant="info">אושר ידנית</Badge>;
  if (entry.verifiedMatch) return <Badge variant="success">תואם לטלפון המאומת</Badge>;
  return <Badge variant="warning">לא תואם לטלפון המאומת</Badge>;
}

// When and why the owner approved the row by hand. The reason is the owner's own
// text on an owner-only page.
function ApprovalDetails({ entry }: { entry: OwnerAgentAllowlistEntry }) {
  if (entry.approvalKind === 'verified_staff') return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {entry.approvedAt ? <p>{`אושר ב-${formatIsraelDateTime(entry.approvedAt)}`}</p> : null}
      {entry.approvalNote ? <p className="wrap-anywhere">{`סיבה: ${entry.approvalNote}`}</p> : null}
    </div>
  );
}

function personName(entry: OwnerAgentAllowlistEntry): string {
  if (entry.approvalKind === 'external_override') return entry.label ?? 'אדם חיצוני';
  return staffName(entry.staffName);
}

// "אשר ידנית" for a staff row whose phone is not the verified one. Opens an inline
// panel (no browser confirm()) that asks for the reason and says what it does.
function ApproveManuallyForm({ entry }: { entry: OwnerAgentAllowlistEntry }) {
  const [state, action] = useActionState(approveUnverifiedStaffAction, null);
  const [open, setOpen] = useState(false);
  const noteId = `approve-note-${entry.id}`;
  const hintId = `approve-hint-${entry.id}`;

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`אשר ידנית ${entry.maskedNumber}`}
        onClick={() => setOpen(true)}
      >
        אשר ידנית
      </Button>
    );
  }
  return (
    <form action={action} className="w-full space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <input type="hidden" name="id" value={entry.id} />
      <p id={hintId} className="text-xs text-muted-foreground">
        הטלפון הזה לא זהה לטלפון המאומת של איש הצוות. אישור ידני יאפשר לו לדבר עם הסוכן בכל
        זאת, עם ההרשאות שלו כאיש צוות. האישור נרשם ביומן.
      </p>
      <label htmlFor={noteId} className="block text-sm font-medium">
        סיבת האישור
      </label>
      <Textarea
        id={noteId}
        name="note"
        required
        maxLength={500}
        aria-describedby={hintId}
        aria-invalid={state?.fieldErrors?.note ? true : undefined}
      />
      <FieldError errors={state?.fieldErrors?.note} />
      <FormError message={state?.error} />
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton className="w-auto" size="sm">
          אישור ידני<span className="sr-only">{` ${entry.maskedNumber}`}</span>
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          ביטול
        </Button>
      </div>
    </form>
  );
}

// Take back a manual approval of a staff row (two steps, like removal).
function RevokeApprovalForm({ entry }: { entry: OwnerAgentAllowlistEntry }) {
  const [state, action] = useActionState(revokeManualApprovalAction, null);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`ביטול אישור ידני ${entry.maskedNumber}`}
        onClick={() => setConfirming(true)}
      >
        ביטול אישור ידני
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={entry.id} />
      <SubmitButton className="w-auto" size="sm">
        אישור ביטול<span className="sr-only">{` ${entry.maskedNumber}`}</span>
      </SubmitButton>
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        חזרה
      </Button>
      <FormError message={state?.error} />
    </form>
  );
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
      {entry.approvalKind === 'verified_staff' && entry.isStaff && !entry.verifiedMatch ? (
        <ApproveManuallyForm entry={entry} />
      ) : null}
      {entry.approvalKind === 'staff_unverified_override' ? <RevokeApprovalForm entry={entry} /> : null}
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

// A person who is not platform staff, approved by hand. The warning states what the
// owner's free-read decisions give them, so the approval is an informed one.
function AddExternalForm() {
  const [state, action] = useActionState(addExternalAllowlistEntryAction, null);
  const [phone, setPhone] = useState('');

  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
      <h3 className="text-sm font-semibold">הוספת אדם חיצוני (אישור ידני)</h3>
      <p id="external-warning" className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
        אדם שאינו איש צוות לא מקבל את כלי הספירה, אבל כמו כל מי שברשימה הוא יכול לשאול את
        הסוכן על כל נתון במערכת, כולל מפתחות ופרטי אורחים. האישור נרשם ביומן ונשלחת התראה.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="external-e164" className="mb-1 block text-sm font-medium">
            טלפון
          </label>
          <PhoneInput
            id="external-e164"
            name="e164"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-describedby="external-e164-hint"
            aria-invalid={state?.fieldErrors?.e164 ? true : undefined}
          />
          <p id="external-e164-hint" className="mt-1 text-xs text-muted-foreground">
            עם קידומת מדינה (+972…) או מספר ישראלי שמתחיל ב-0.
          </p>
          <FieldError errors={state?.fieldErrors?.e164} />
        </div>
        <div>
          <label htmlFor="external-name" className="mb-1 block text-sm font-medium">
            שם
          </label>
          <input
            id="external-name"
            name="name"
            required
            maxLength={120}
            aria-invalid={state?.fieldErrors?.name ? true : undefined}
            className={inputClass}
          />
          <FieldError errors={state?.fieldErrors?.name} />
        </div>
      </div>
      <div>
        <label htmlFor="external-note" className="mb-1 block text-sm font-medium">
          סיבת האישור
        </label>
        <Textarea
          id="external-note"
          name="note"
          required
          maxLength={500}
          aria-describedby="external-warning"
          aria-invalid={state?.fieldErrors?.note ? true : undefined}
        />
        <FieldError errors={state?.fieldErrors?.note} />
      </div>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <SubmitButton className="w-auto">אישור והוספה</SubmitButton>
    </form>
  );
}

type AddMode = 'staff' | 'external';

function AddModeSwitch({ mode, onChange }: { mode: AddMode; onChange: (mode: AddMode) => void }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-4">
      <legend className="mb-1 text-sm font-medium">מי מתווסף</legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="allowlist-add-mode"
          value="staff"
          checked={mode === 'staff'}
          onChange={() => onChange('staff')}
        />
        איש צוות
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="allowlist-add-mode"
          value="external"
          checked={mode === 'external'}
          onChange={() => onChange('external')}
        />
        אדם חיצוני (אישור ידני)
      </label>
    </fieldset>
  );
}

export function AllowlistPanel({
  entries,
  staff,
}: {
  entries: OwnerAgentAllowlistEntry[];
  staff: OwnerAgentStaffOption[];
}) {
  const [mode, setMode] = useState<AddMode>('staff');
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
              <TableHead>שם</TableHead>
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
                <TableCell className="wrap-anywhere">{personName(entry)}</TableCell>
                <TableCell>
                  <MatchBadge entry={entry} />
                  <ApprovalDetails entry={entry} />
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

      <AddModeSwitch mode={mode} onChange={setMode} />
      {mode === 'external' ? (
        <AddExternalForm />
      ) : staff.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          אין אנשי צוות פלטפורמה. אפשר להוסיף אדם חיצוני באישור ידני.
        </p>
      ) : (
        <AddEntryForm staff={staff} />
      )}
    </div>
  );
}
