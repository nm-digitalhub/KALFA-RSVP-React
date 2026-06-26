'use client';

import { useActionState, useState } from 'react';

import { createCampaignAction } from '../campaign-actions';
import type { CampaignTemplate } from '@/lib/data/campaigns';
import { FieldError, FormError, SubmitButton } from '@/components/forms';

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2';
const labelClass = 'mb-1 block text-sm font-medium';

function RequiredMark() {
  return (
    <span aria-hidden="true" className="ms-0.5 text-red-500">
      *
    </span>
  );
}

function ils(n: number): string {
  return `₪${n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'וואטסאפ',
  call: 'שיחה טלפונית (AI)',
};

function whenLabel(daysBefore: number): string {
  return daysBefore === 1 ? 'יום לפני' : `${daysBefore} ימים לפני`;
}

// Full details of the chosen service track (shown for the single track, and
// below the selector when there is more than one).
function TrackDetails({ t }: { t: CampaignTemplate }) {
  return (
    <div className="mt-2 space-y-1 rounded-md border border-border p-3 text-sm">
      <div className="font-medium">{t.name}</div>
      {t.description ? (
        <p className="text-xs text-muted-foreground">{t.description}</p>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1">
        <dt className="text-muted-foreground">מחיר לאיש קשר שהושג</dt>
        <dd>{ils(t.price_per_reached)}</dd>
        <dt className="text-muted-foreground">ערוצים</dt>
        <dd>{t.channels.map((c) => CHANNEL_LABELS[c] ?? c).join(' + ')}</dd>
        <dt className="text-muted-foreground">לוח פנייה</dt>
        <dd>
          {t.outreach_schedule.length === 0 ? (
            '—'
          ) : (
            <ul className="space-y-0.5">
              {t.outreach_schedule.map((tp, i) => (
                <li key={i}>
                  {whenLabel(tp.days_before)} · {CHANNEL_LABELS[tp.channel] ?? tp.channel}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
    </div>
  );
}

export function NewCampaignForm({
  eventId,
  templates,
  uniqueContacts,
}: {
  eventId: string;
  templates: CampaignTemplate[];
  uniqueContacts: number;
}) {
  const action = createCampaignAction.bind(null, eventId);
  const [state, formAction] = useActionState(action, null);

  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');

  const selected = templates.find((t) => t.id === templateId) ?? null;
  const price = selected?.price_per_reached ?? 0;
  // Ceiling is derived: price × the event's unique-contact count (§7).
  const ceiling = price > 0 && uniqueContacts > 0 ? price * uniqueContacts : 0;

  if (templates.length === 0) {
    return (
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
        אין כרגע מסלולי שירות זמינים. פנו לצוות KALFA.
      </p>
    );
  }

  if (uniqueContacts === 0) {
    return (
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
        אין אנשי קשר תקינים ברשימת המוזמנים. הוסיפו מוזמנים עם מספר טלפון תקין
        כדי ליצור קמפיין.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state?.error} />

      <p className="text-xs text-muted-foreground">
        שדות המסומנים ב-<span className="text-red-500">*</span> הם חובה
      </p>

      <div>
        <label htmlFor="template_id" className={labelClass}>
          מסלול שירות
          {templates.length > 1 ? <RequiredMark /> : null}
        </label>
        {/* Single track → hidden value (no choice needed). Multiple → selector. */}
        {templates.length > 1 ? (
          <select
            id="template_id"
            name="template_id"
            required
            className={inputClass}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {ils(t.price_per_reached)} לאיש קשר
              </option>
            ))}
          </select>
        ) : (
          <input type="hidden" name="template_id" value={templateId} />
        )}
        {selected ? <TrackDetails t={selected} /> : null}
        <FieldError errors={state?.fieldErrors?.template_id} />
      </div>

      <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
        אנשי קשר ייחודיים: <strong>{uniqueContacts.toLocaleString('he-IL')}</strong>
        <span className="mt-1 block text-xs text-muted-foreground">
          מספר הטלפונים השונים ברשימת המוזמנים שלכם. שני מוזמנים עם אותו מספר
          נספרים כאיש קשר אחד, ומספרים לא תקינים אינם נכללים. זהו המספר המרבי שניתן
          להשיג — ולכן הבסיס לתקרת החיוב.
        </span>
      </div>

      <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
        תקרת חיוב מרבית: <strong>{ceiling > 0 ? ils(ceiling) : '—'}</strong>
        <span className="mt-1 block text-xs text-muted-foreground">
          הסכום המרבי שתחויבו בו (מחיר × {uniqueContacts.toLocaleString('he-IL')}{' '}
          אנשי קשר). החיוב בפועל הוא לפי אנשי הקשר שהושגו.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="start_at" className={labelClass}>
            תחילת פעילות
          </label>
          <input id="start_at" name="start_at" type="date" className={inputClass} />
          <FieldError errors={state?.fieldErrors?.start_at} />
        </div>
        <div>
          <label htmlFor="close_at" className={labelClass}>
            סגירה
          </label>
          <input id="close_at" name="close_at" type="date" className={inputClass} />
          <FieldError errors={state?.fieldErrors?.close_at} />
        </div>
      </div>

      <SubmitButton>המשך לאישור וחתימה</SubmitButton>
    </form>
  );
}
