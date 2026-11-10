// No 'use client' here on purpose: this is not an entry file. It is imported only by
// the two event forms, which are Client Components themselves, and InviteImageInput
// takes a function prop that a client entry file could not declare.
import { FieldError } from '@/components/forms';
import { INVITE_IMAGE_MAX_BYTES } from '@/lib/constants';

// Fields the create form (new/new-event-form.tsx) and the edit form
// ([id]/edit-event-form.tsx) render identically. Like CelebrantFields, they live
// once so the two forms cannot drift apart; what differs between the forms
// (prefilled values, locks, required marks) stays in each form.

export function GiftPaymentUrlField({
  defaultValue,
  errors,
}: {
  defaultValue?: string;
  errors?: string[];
}) {
  return (
    <div>
      <label htmlFor="gift_payment_url" className="mb-1 block text-sm font-medium">
        קישור למתנה (פייבוקס/ביט)
      </label>
      <input
        id="gift_payment_url"
        name="gift_payment_url"
        type="url"
        dir="ltr"
        placeholder="https://…"
        defaultValue={defaultValue}
        className="w-full rounded-md border border-border bg-background px-3 py-2"
      />
      <p className="mt-1 text-xs text-muted-foreground">
        יופיע בתזכורת המתנה בוואטסאפ — האורחים יועברו אליו בלחיצה.
      </p>
      <FieldError errors={errors} />
    </div>
  );
}

export function MealPrefField({ defaultChecked }: { defaultChecked: boolean }) {
  return (
    <div>
      <label className="flex items-start gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="show_meal_pref"
          defaultChecked={defaultChecked}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          איסוף העדפת תפריט מהאורחים
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            כשמופעל, טופס אישור ההגעה יציג לאורחים שמאשרים הגעה שדה חופשי
            להעדפת תפריט (כשר, צמחוני וכדומה). ניתן לשינוי בכל שלב.
          </span>
        </span>
      </label>
    </div>
  );
}

// The invitation-image file input. Pre-checks the size cap in the browser: a
// pick above the Server Action body limit (6mb) is rejected by the framework
// BEFORE the action runs, so the server's friendly Hebrew error would never
// show. `onSizeError` receives the message, or null once a valid file is picked.
export function InviteImageInput({
  onSizeError,
}: {
  onSizeError: (message: string | null) => void;
}) {
  return (
    <input
      id="invite_image"
      name="invite_image"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      className="block w-full text-sm"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f && f.size > INVITE_IMAGE_MAX_BYTES) {
          onSizeError('הקובץ גדול מדי (מעל 5MB) — נא לכווץ את התמונה.');
          e.target.value = '';
        } else {
          onSizeError(null);
        }
      }}
    />
  );
}
