'use client';

import { useState, useTransition } from 'react';

import { FormError } from '@/components/forms';
import type { AdminUserDetail } from '@/lib/data/admin/users';

import { viewUserDetailAction } from '../actions';
import { UserDetailView } from './user-detail-view';
import type { StaffRoleOption } from './user-actions';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

// Break-glass reason gate for viewing ANOTHER user's detail. Until a reason
// (≥10 chars) is supplied and viewUserDetailAction succeeds, no PII is fetched
// or shown — the action calls getUserDetail(id, reason), which writes the audit
// row BEFORE returning. On success the detail replaces the gate in place. Self
// views never mount this (the page renders the detail directly).
export function UserDetailGate({
  id,
  actorId,
  platformStaff,
}: {
  id: string;
  actorId: string;
  platformStaff: { roles: StaffRoleOption[]; currentRoleId: string | null } | null;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [pending, start] = useTransition();

  const reasonTooShort = reason.trim().length < 10;

  const onView = (): void => {
    setError(undefined);
    start(async () => {
      const result = await viewUserDetailAction({ user_id: id, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDetail(result.data);
    });
  };

  if (detail) {
    return (
      <UserDetailView user={detail} actorId={actorId} platformStaff={platformStaff} />
    );
  }

  return (
    <section className={sectionClass}>
      <h2 className="text-lg font-semibold">סיבת הגישה (מחייב)</h2>
      <p className="text-sm text-muted-foreground">
        צפייה בפרטי משתמש אחר חושפת נתונים אישיים (טלפון, אימייל, אירועים, הטבות)
        ומתועדת ביומן גישת הצוות. יש לציין סיבה (לפחות 10 תווים) לפני הצפייה.
      </p>
      <FormError message={error} />
      <div>
        <label htmlFor="user-view-reason" className="mb-1 block text-sm font-medium">
          סיבה
        </label>
        <textarea
          id="user-view-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={inputClass}
          rows={2}
          placeholder="לדוגמה: בירור פנייה בנושא חיוב עבור החשבון"
        />
      </div>
      <button
        type="button"
        onClick={onView}
        disabled={pending || reasonTooShort}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'טוען…' : 'צפייה בפרטי המשתמש'}
      </button>
      {reasonTooShort ? (
        <p className="text-sm text-muted-foreground">יש להזין סיבה לפני הצפייה.</p>
      ) : null}
    </section>
  );
}
