import type { AdminWebhookDetail } from '@/lib/data/admin/webhook-inbox';
import {
  WEBHOOK_PROCESS_LABELS,
  WEBHOOK_PROCESS_VARIANTS,
  WEBHOOK_KIND_VARIANTS,
  deliveryStatusLabel,
  deliveryStatusVariant,
  webhookKindLabel,
  webhookProcessState,
} from '@/lib/data/admin/labels';
import { Badge, formatDateTime } from '../_components';
import {
  CopyButton,
  PayloadViewer,
  PhoneReveal,
} from './webhook-inspector-client';

// Definitive WhatsApp error code for an invalid/non-existent number. Anything
// else is a generic delivery failure (conservative — see the webhook spec §8).
const WRONG_NUMBER_CODE = 131026;

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

export function WebhookDetail({ item }: { item: AdminWebhookDetail }) {
  const state = webhookProcessState(item);
  const payload = (item.payload ?? {}) as Record<string, unknown>;

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

  const from = typeof payload.from === 'string' ? payload.from : null;
  const recipient =
    typeof payload.recipient_id === 'string' ? payload.recipient_id : null;
  const messageType = typeof payload.type === 'string' ? payload.type : null;
  const phone = from ?? recipient;

  const payloadJson = JSON.stringify(item.payload, null, 2);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={WEBHOOK_KIND_VARIANTS[item.event_kind] ?? 'neutral'}>
          {webhookKindLabel(item.event_kind)}
        </Badge>
        <Badge variant={WEBHOOK_PROCESS_VARIANTS[state]}>
          {WEBHOOK_PROCESS_LABELS[state]}
        </Badge>
      </div>

      <Section title="סיכום מפוענח">
        {item.event_at ? (
          <Field label="זמן האירוע">{formatDateTime(item.event_at)}</Field>
        ) : null}
        <Field label="התקבל">{formatDateTime(item.received_at)}</Field>
        {messageType ? <Field label="סוג הודעה">{messageType}</Field> : null}
        {phone ? (
          <Field label="טלפון נמען (PII)">
            <PhoneReveal value={phone} />
          </Field>
        ) : null}
        {item.phone_number_id ? (
          <Field label="phone_number_id">
            <span className="inline-flex items-center gap-1.5">
              <span dir="ltr">{item.phone_number_id}</span>
              <CopyButton value={item.phone_number_id} />
            </span>
          </Field>
        ) : null}
        <Field label="dedupe_key">
          <span className="inline-flex items-center gap-1.5">
            <span dir="ltr" className="break-all">
              {item.dedupe_key}
            </span>
            <CopyButton value={item.dedupe_key} />
          </span>
        </Field>
      </Section>

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
                <span className="inline-flex items-center gap-1.5">
                  <span dir="ltr">{errorCode}</span>
                  <CopyButton value={String(errorCode)} />
                </span>
              </Field>
              <Field label="סיווג">
                {errorCode === WRONG_NUMBER_CODE ? 'מספר שגוי' : 'כשל מסירה'}
              </Field>
            </>
          ) : null}
        </Section>
      ) : null}

      <Section title="עיבוד">
        <Field label="ניסיונות">{item.attempts}</Field>
        <Field label="עובד ב">
          {item.processed_at ? formatDateTime(item.processed_at) : '—'}
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
            <span className="inline-flex items-center gap-1.5">
              <span dir="ltr" className="break-all">
                {item.message_id}
              </span>
              <CopyButton value={item.message_id} />
            </span>
          </Field>
        ) : null}
        {item.context_message_id ? (
          <Field label="context_message_id">
            <span className="inline-flex items-center gap-1.5">
              <span dir="ltr" className="break-all">
                {item.context_message_id}
              </span>
              <CopyButton value={item.context_message_id} />
            </span>
          </Field>
        ) : null}
      </Section>

      <Section title="payload גולמי">
        <PayloadViewer json={payloadJson} />
      </Section>
    </div>
  );
}
