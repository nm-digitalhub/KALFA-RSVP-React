import type { InquiryMessage } from '@/lib/data/admin/contacts';
import { formatDateTime } from '../_components';

// A conversation, not two text fields.
//
// The flat rendering printed `message` in one paragraph and `sent_reply` in
// another, which was fine while an inquiry was exactly one question and one
// answer. The moment a customer writes back, that shape merges their new reply,
// our earlier answer and the original question into one undifferentiated block
// with no chronology and no indication of who said what.
//
// Direction drives alignment and colour so "who wrote this" is readable at a
// glance rather than inferred from the text.
const STYLES: Record<InquiryMessage['direction'], { box: string; label: string }> = {
  inbound: {
    box: 'rounded-md border border-border bg-muted/40 p-3',
    label: 'הלקוח',
  },
  outbound: {
    // Offset with a LOGICAL property: `ms-6` follows the writing direction, so
    // it indents from the correct side in RTL without a second rule.
    box: 'rounded-md border border-success/40 bg-success/10 p-3 ms-6',
    label: 'נשלח ללקוח',
  },
  draft: {
    // Dashed, and never coloured like a sent message: a draft is a proposal the
    // customer has never seen, and confusing the two is how an unsent reply gets
    // treated as answered.
    box: 'rounded-md border border-dashed border-border p-3 ms-6',
    label: 'טיוטת סוכן — לא נשלחה',
  },
};

export function InquiryThread({ messages }: { messages: InquiryMessage[] }) {
  if (messages.length === 0) return null;

  return (
    <ol className="space-y-2">
      {messages.map((m) => {
        const style = STYLES[m.direction];
        return (
          <li key={m.id} className={style.box}>
            <p className="text-xs font-semibold text-muted-foreground">
              {style.label} · {formatDateTime(m.created_at)}
            </p>
            <p className="whitespace-pre-wrap wrap-anywhere text-sm">{m.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
