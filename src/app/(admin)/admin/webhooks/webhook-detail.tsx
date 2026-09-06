import type { AdminWebhookDetailView } from '@/lib/data/admin/webhook-inbox';
import {
  extractWebhookIdentity,
  summarizeWebhookContent,
} from '@/lib/data/admin/webhook-identity';
import {
  WEBHOOK_PROCESS_LABELS,
  WEBHOOK_PROCESS_VARIANTS,
  WEBHOOK_KIND_VARIANTS,
  billingOutcomeLabel,
  billingOutcomeVariant,
  deliveryStatusLabel,
  deliveryStatusVariant,
  webhookKindLabel,
  webhookProcessState,
} from '@/lib/data/admin/labels';
import { Badge } from '../_components';
import {
  CopyButton,
  JsonTree,
  PhoneReveal,
  ReprocessButton,
} from './webhook-inspector-client';

// Definitive WhatsApp error code for an invalid/non-existent number. Anything
// else is a generic delivery failure (conservative — see the webhook spec §8).
const WRONG_NUMBER_CODE = 131026;

// Seconds matter here: two deliveries in the same minute are routinely told
// apart only by their seconds (the list shows minutes).
const DATE_TIME_SECONDS = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatDateTimeSeconds(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_TIME_SECONDS.format(d);
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-start">{children}</span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1 rounded-lg border border-border p-3">
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Technical({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span dir="ltr" className="break-all">
        {value}
      </span>
      <CopyButton value={value} />
    </span>
  );
}

export function WebhookDetail({ detail }: { detail: AdminWebhookDetailView }) {
  const { item, delivery, outcome, businessNumber } = detail;
  const state = webhookProcessState(item);
  const payload = (item.payload ?? {}) as Record<string, unknown>;
  const identity = extractWebhookIdentity(item.event_kind, item.payload);
  const content = summarizeWebhookContent(item.payload);
  const isImportMessage =
    item.event_kind === 'message' &&
    (content.type === 'document' || content.type === 'contacts');

  const status = typeof payload.status === 'string' ? payload.status : null;
  const errorsRaw = Array.isArray(payload.errors)
    ? payload.errors
    : payload.error
      ? [payload.error]
      : [];
  const firstError =
    errorsRaw[0] && typeof errorsRaw[0] === 'object'
      ? (errorsRaw[0] as Record<string, unknown>)
      : null;
  const errorCode =
    firstError && typeof firstError.code === 'number' ? firstError.code : null;
  const errorText =
    firstError && typeof firstError.title === 'string'
      ? firstError.title
      : firstError && typeof firstError.message === 'string'
        ? firstError.message
        : null;
  const pricing =
    payload.pricing && typeof payload.pricing === 'object'
      ? (payload.pricing as Record<string, unknown>)
      : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={WEBHOOK_KIND_VARIANTS[item.event_kind] ?? 'neutral'}>
          {webhookKindLabel(item.event_kind)}
        </Badge>
        <Badge variant={WEBHOOK_PROCESS_VARIANTS[state]}>
          {WEBHOOK_PROCESS_LABELS[state]}
        </Badge>
        {identity?.phoneMissing ? (
          <Badge variant="warning">הגיע ללא מספר טלפון (BSUID בלבד)</Badge>
        ) : null}
      </div>

      <Section title="סיכום">
        {item.event_at ? (
          <Field label="זמן האירוע (Meta)">{formatDateTimeSeconds(item.event_at)}</Field>
        ) : null}
        <Field label="התקבל אצלנו">{formatDateTimeSeconds(item.received_at)}</Field>
        {content.type ? <Field label="סוג הודעה">{content.type}</Field> : null}
        {content.text ? (
          <Field label="טקסט (PII)">
            <span className="break-words">{content.text}</span>
          </Field>
        ) : null}
        {content.replyId ? (
          <Field label="כפתור / בחירה">
            <span className="inline-flex items-center gap-1.5">
              {content.replyTitle ? <span>{content.replyTitle}</span> : null}
              <span dir="ltr" className="text-xs text-muted-foreground">
                {content.replyId}
              </span>
            </span>
          </Field>
        ) : null}
        {content.fileName ? (
          <Field label="קובץ">
            <span dir="ltr">{content.fileName}</span>
          </Field>
        ) : null}
        {content.contactCount != null ? (
          <Field label="כרטיסי קשר">{content.contactCount}</Field>
        ) : null}
        {content.systemBody ? (
          <Field label="הודעת מערכת">
            <span dir="ltr">{content.systemBody}</span>
          </Field>
        ) : null}
        {item.phone_number_id ? (
          <Field label="המספר העסקי שקיבל">
            <span className="flex flex-col items-start gap-0.5">
              {businessNumber ? (
                <span>{businessNumber.label}</span>
              ) : (
                <span className="text-warning-foreground">לא מוגדר ב-/admin/channels</span>
              )}
              <Technical value={item.phone_number_id} />
            </span>
          </Field>
        ) : null}
        <Field label="dedupe_key">
          <Technical value={item.dedupe_key} />
        </Field>
      </Section>

      {identity ? (
        <Section title={identity.role === 'sender' ? 'זהות השולח' : 'זהות הנמען'}>
          <Field label="טלפון (PII)">
            {identity.phone ? (
              <PhoneReveal value={identity.phone} />
            ) : (
              <span className="text-warning-foreground">לא נמסר על ידי Meta</span>
            )}
          </Field>
          <Field label="BSUID">
            {identity.bsuid ? (
              <Technical value={identity.bsuid} />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
          {identity.parentBsuid ? (
            <Field label="Parent BSUID">
              <Technical value={identity.parentBsuid} />
            </Field>
          ) : null}
          <Field label="שם פרופיל (PII)">
            {identity.profileName ?? <span className="text-muted-foreground">—</span>}
          </Field>
          <Field label="שם משתמש">
            {identity.username ? (
              <span dir="ltr">{identity.username}</span>
            ) : (
              <span className="text-muted-foreground">אין (המשתמש לא אימץ username)</span>
            )}
          </Field>
        </Section>
      ) : null}

      {item.event_kind === 'status' ? (
        <Section title="מסירה">
          {status ? (
            <Field label="סטטוס">
              <Badge variant={deliveryStatusVariant(status)}>
                {deliveryStatusLabel(status)}
              </Badge>
            </Field>
          ) : null}
          {errorCode != null ? (
            <>
              <Field label="קוד Meta">
                <Technical value={String(errorCode)} />
              </Field>
              <Field label="סיווג">
                {errorCode === WRONG_NUMBER_CODE ? 'מספר שגוי' : 'כשל מסירה'}
              </Field>
              {errorText ? (
                <Field label="תיאור Meta">
                  <span dir="ltr" className="break-words text-xs">
                    {errorText}
                  </span>
                </Field>
              ) : null}
            </>
          ) : null}
          {pricing ? (
            <Field label="תמחור Meta">
              <span dir="ltr" className="text-xs">
                {[
                  typeof pricing.billable === 'boolean'
                    ? pricing.billable
                      ? 'billable'
                      : 'free'
                    : null,
                  typeof pricing.category === 'string' ? pricing.category : null,
                  typeof pricing.type === 'string' ? pricing.type : null,
                  typeof pricing.pricing_model === 'string' ? pricing.pricing_model : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </Field>
          ) : null}
          {outcome.outbound ? (
            <>
              <Field label="ההודעה היוצאת שייכת ל">
                {outcome.outbound.eventName ?? <span className="text-muted-foreground">—</span>}
              </Field>
              {outcome.outbound.deliveryStatus ? (
                <Field label="סטטוס שנרשם אצלנו">
                  <Badge variant={deliveryStatusVariant(outcome.outbound.deliveryStatus)}>
                    {deliveryStatusLabel(outcome.outbound.deliveryStatus)}
                  </Badge>
                </Field>
              ) : null}
            </>
          ) : (
            <Field label="ההודעה היוצאת">
              <span className="text-muted-foreground">
                לא נמצאה אינטראקציה יוצאת עם ה-wamid הזה (נשלח מחוץ לקמפיין)
              </span>
            </Field>
          )}
        </Section>
      ) : null}

      {item.event_kind === 'message' ? (
        <Section title="תוצאה — מה המערכת עשתה">
          {outcome.inbound ? (
            <>
              <Field label="שויך לאירוע">
                <span className="inline-flex items-center gap-1.5">
                  <span>{outcome.inbound.eventName ?? '—'}</span>
                  {outcome.inbound.eventStatus ? (
                    <span className="text-xs text-muted-foreground">
                      ({outcome.inbound.eventStatus})
                    </span>
                  ) : null}
                </span>
              </Field>
              {outcome.inbound.campaignStatus ? (
                <Field label="סטטוס הקמפיין">{outcome.inbound.campaignStatus}</Field>
              ) : null}
              <Field label="סיווג">
                {outcome.inbound.billable ? 'אינטראקציה חייבת (billable)' : 'לא חייב'}
              </Field>
              <Field label="חיוב בפועל">
                {outcome.inbound.billed ? (
                  <Badge variant="success">חויב</Badge>
                ) : outcome.inbound.billingOutcome ? (
                  <Badge variant={billingOutcomeVariant(outcome.inbound.billingOutcome)}>
                    {billingOutcomeLabel(outcome.inbound.billingOutcome)}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">
                    לא חויב (תוצאת ה-RPC לא נרשמה — עובד לפני 4.9.2026)
                  </span>
                )}
              </Field>
              {outcome.inbound.removalRequested ? (
                <Field label="הסרה">
                  <Badge variant="warning">איש הקשר מסומן כמבקש הסרה</Badge>
                </Field>
              ) : null}
            </>
          ) : outcome.staging ? null : (
            <Field label="שיוך">
              <span className="text-muted-foreground">
                לא שויך לאף איש קשר/קמפיין (השולח לא זוהה, או שההודעה אינה חייבת)
              </span>
            </Field>
          )}
          {outcome.staging ? (
            <Field label="ייבוא מוזמנים">
              <span className="flex flex-col items-start gap-0.5">
                <span>
                  נקלטה רשימה של {outcome.staging.rowCount} שורות
                  {outcome.staging.eventName ? ` לאירוע "${outcome.staging.eventName}"` : ''}
                </span>
                <span className="text-xs text-muted-foreground">
                  סטטוס: {outcome.staging.status}
                </span>
              </span>
            </Field>
          ) : isImportMessage ? (
            <Field label="ייבוא מוזמנים">
              <span className="text-muted-foreground">
                לא נקלטה רשימה מההודעה הזו (שולח לא מזוהה כבעל אירוע, או שגיאת קריאה)
              </span>
            </Field>
          ) : null}
        </Section>
      ) : null}

      <Section title="עיבוד">
        <Field label="ניסיונות">{item.attempts}</Field>
        <Field label="עובד ב">
          {item.processed_at ? formatDateTimeSeconds(item.processed_at) : '—'}
        </Field>
        {item.last_error ? (
          <Field label="שגיאה אחרונה">
            <span dir="ltr" className="break-all text-destructive">
              {item.last_error}
            </span>
          </Field>
        ) : null}
        {item.message_id ? (
          <Field label="message_id">
            <Technical value={item.message_id} />
          </Field>
        ) : null}
        {item.context_message_id ? (
          <Field label="context_message_id">
            <Technical value={item.context_message_id} />
          </Field>
        ) : null}
      </Section>

      <Section title="האירוע כפי שנשמר (מנורמל)">
        <p className="text-xs text-muted-foreground">
          אובייקט ההודעה/הסטטוס בלבד; <code dir="ltr">sender_contact</code> /{' '}
          <code dir="ltr">recipient_contact</code> הם בלוק ה-contacts של Meta שצורף.
        </p>
        <JsonTree
          data={item.payload}
          revealLabel="הצגת האירוע (PII)"
          copyLabel="העתקת האירוע"
        />
      </Section>

      <Section title="מה ש-Meta שלחה בפועל (המעטפה המלאה)">
        {delivery ? (
          <>
            <Field label="התקבל">{formatDateTimeSeconds(delivery.receivedAt)}</Field>
            <Field label="גודל">
              <span dir="ltr">{delivery.byteLength} bytes</span>
            </Field>
            <JsonTree
              data={delivery.body}
              revealLabel="הצגת המעטפה המלאה (PII)"
              copyLabel="העתקת המעטפה"
            />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            לא נשמרה — האירוע נקלט לפני שהמעטפות נשמרות (4.9.2026), או שהשמירה נכשלה.
          </p>
        )}
      </Section>

      <div className="flex justify-end pt-1">
        <ReprocessButton id={item.id} isImportMessage={isImportMessage} />
      </div>
    </div>
  );
}
