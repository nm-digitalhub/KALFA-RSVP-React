'use client';

import { useActionState } from 'react';

import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import type { AdminChannel } from '@/lib/data/admin/channel-catalog';
import { updateChannelCatalogAction } from './actions';

// Admin editor for the channel catalog's DISPLAY metadata (label / show-hide /
// order / built-flag). Each row is its own form + independent save so a notice
// or error stays scoped to the channel it edited. The `key` is shown read-only
// (immutable, mirrors the campaign_channel enum) — there is intentionally no
// "add channel" / "delete" here: a new channel is a schema + code change, not a
// metadata edit (see channel-catalog.ts).

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'mb-1 block text-sm font-medium';

function ChannelRow({ channel }: { channel: AdminChannel }) {
  const [state, formAction] = useActionState(updateChannelCatalogAction, null);
  return (
    <form
      action={formAction}
      className="space-y-3 rounded-md border border-border p-4"
    >
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <input type="hidden" name="key" value={channel.key} />

      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{channel.display_name}</span>
        <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
          {channel.key}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <div>
          <label htmlFor={`display_name_${channel.key}`} className={labelClass}>
            שם תצוגה
          </label>
          <input
            id={`display_name_${channel.key}`}
            name="display_name"
            defaultValue={channel.display_name}
            className={inputClass}
            autoComplete="off"
          />
          <FieldError errors={state?.fieldErrors?.display_name} />
        </div>
        <div>
          <label htmlFor={`sort_order_${channel.key}`} className={labelClass}>
            סדר תצוגה
          </label>
          <input
            id={`sort_order_${channel.key}`}
            name="sort_order"
            type="number"
            min="0"
            step="1"
            dir="ltr"
            defaultValue={channel.sort_order}
            className={inputClass}
          />
          <FieldError errors={state?.fieldErrors?.sort_order} />
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="active"
            defaultChecked={channel.active}
            className="size-4 rounded border-border"
          />
          פעיל (מוצג בטופס החבילה)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_built"
            defaultChecked={channel.is_built}
            className="size-4 rounded border-border"
          />
          ערוץ בנוי (מידע בלבד)
        </label>
      </div>

      <SubmitButton>שמירה</SubmitButton>
    </form>
  );
}

export function ChannelCatalogEditor({
  channels,
}: {
  channels: AdminChannel[];
}) {
  if (channels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">אין ערוצים בקטלוג.</p>
    );
  }
  return (
    <div className="space-y-4">
      {channels.map((channel) => (
        <ChannelRow key={channel.key} channel={channel} />
      ))}
    </div>
  );
}
