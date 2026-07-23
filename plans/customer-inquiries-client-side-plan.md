# Customer Inquiries — Client-Side Entry Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the three existing admin inboxes (`/admin/contacts`, `/admin/callbacks`, `/admin/support`) their missing client-side counterparts: a public, session-aware `/contact` page (contact form + call-me-back form) for prospects AND signed-in customers, wired footer/nav entry points, and an inquiry-workflow extension of `contact_messages` that also unblocks the fleet `support-drafter`.

**Architecture:** Extend the existing entities — no new tables, no new inbox pages, no new status vocabulary. `contact_messages` becomes the single free-text inquiry entity (additive nullable columns: status/topic/user_id/handled_at/internal_note/draft_reply/draft_created_at/replied_at). `callback_requests` is untouched. Anonymous submissions go through Server Actions using the service-role client (RLS deliberately stays closed to `anon`), gated by IP rate-limit + honeypot + Zod. `/admin/contacts` gains the same status workflow `/admin/callbacks` already has, reusing `CALLBACK_STATUSES`.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase (service-role server-only), Zod 4, vitest, existing `src/lib/security/rate-limit.ts`, existing `src/components/forms.tsx`.

## Global Constraints

- **Verified baseline (2026-07-23, live DB):** `contact_messages` = `id, name, email, phone, message, created_at`, 0 rows, RLS on, single policy `cm_insert_authenticated` (INSERT to authenticated), no triggers. `callback_requests` = `id, full_name, phone, topic, note, status, created_at, updated_at`, 0 rows, policy `cb_insert_authenticated`, trigger `cb_set_updated_at`. No DB function references either table.
- **RLS unchanged.** Never add an `anon` INSERT policy. Anonymous writes go service-role via Server Action only.
- **No new status system.** Contact status reuses `CALLBACK_STATUSES` (`new/in_progress/done/cancelled`) from `src/lib/validation/admin.ts:18` + labels from `src/lib/data/admin/labels.ts`.
- **`logActivity` requires a session** (`requireUser()` at `src/lib/data/activity.ts:36`) — call it ONLY for signed-in submitters; anonymous submissions are audited by the inserted row itself.
- **`types.ts` is generated only**: `npx supabase gen types typescript --linked > src/lib/supabase/types.ts` — never hand-edit.
- **No PII in logs/activity meta/Slack.** IDs and counts only.
- **Hebrew-first, RTL**, `dir="ltr"` on phone/email inputs, semantic labels, visible focus.
- **Branch:** `feat/customer-inquiries`. Commits per task; **no push, no live-DB apply, no deploy without explicit user approval at those steps** (marked ⛔GATE).
- **Build uses `--webpack`** (`npm run build`), never Turbopack. Never run two builds concurrently.
- **Definition of Done:** `npm run lint`, `npx tsc --noEmit`, `vitest run`, `npm run build` pass + runtime browser check (verifying-kalfa-changes skill).

## Out of Scope (deliberate)

- Slack alert on new inquiry — no fitting `AlertCategory` (`errors|campaign_billing|send_health|security`); a new category is a fleet-TODO item. The admin dashboard already counts both tables.
- `support-drafter` role files / scheduling (fleet workstream) — this plan only lands its data source (`status='new'` rows) and its output field (`draft_reply`, never auto-sent, no break-glass involvement).
- Sending replies to customers (`replied_at` is set by a human process later; no email/WhatsApp send here).
- `callback_requests` schema — already sufficient (status workflow + updated_at trigger).
- Shared-store rate limiting (documented per-process limitation of `rate-limit.ts` stands).

---

### Task 1: Schema extension migration + regenerated types

**Files:**
- Create: `supabase/migrations/20260723180000_contact_messages_inquiry_workflow.sql`
- Regenerate: `src/lib/supabase/types.ts`

**Interfaces:**
- Produces: `contact_messages` new nullable/default columns `status text not null default 'new'`, `topic text`, `user_id uuid`, `handled_at timestamptz`, `internal_note text`, `draft_reply text`, `draft_created_at timestamptz`, `replied_at timestamptz`; regenerated `Database` types used by Tasks 3 & 6.

- [ ] **Step 1: Create branch**

```bash
git checkout -b feat/customer-inquiries
```

- [ ] **Step 2: Write the migration file**

```sql
-- Extend contact_messages into the single customer-inquiry entity:
-- status workflow (same app-level vocabulary as callback_requests),
-- optional link to the signed-in submitter, and support-drafter fields.
-- Additive + nullable/default only; table has 0 rows in production —
-- zero behavior change for existing readers (they select explicit columns).

alter table public.contact_messages
  add column if not exists status text not null default 'new',
  add column if not exists topic text,
  add column if not exists user_id uuid references auth.users (id) on delete set null,
  add column if not exists handled_at timestamptz,
  add column if not exists internal_note text,
  add column if not exists draft_reply text,
  add column if not exists draft_created_at timestamptz,
  add column if not exists replied_at timestamptz,
  add column if not exists sent_reply text;

comment on column public.contact_messages.sent_reply is
  'The reply actually sent to the customer (by a human action); replied_at is its timestamp.';

comment on column public.contact_messages.status is
  'App-level vocabulary (validation/admin.ts CALLBACK_STATUSES): new / in_progress / done / cancelled. Free text by design, like callback_requests.status.';
comment on column public.contact_messages.user_id is
  'Signed-in submitter, attached server-side from the session — never client-supplied. NULL = anonymous public form.';
comment on column public.contact_messages.draft_reply is
  'support-drafter proposed reply. Draft only — never auto-sent to the customer.';

-- FK lookups + admin status filtering.
create index if not exists contact_messages_user_id_idx on public.contact_messages (user_id);
create index if not exists contact_messages_status_idx on public.contact_messages (status);

-- RLS: deliberately UNCHANGED. INSERT stays authenticated-only
-- (cm_insert_authenticated); anonymous submissions go through the
-- service-role Server Action, never straight to PostgREST.
```

- [ ] **Step 3: ⛔GATE — apply to the live DB only after explicit approval**

Run: `npx supabase db push --linked`
Expected: prompt lists ONLY `20260723180000_contact_messages_inquiry_workflow.sql`. Known quirk: the CLI may exit 1 while printing "Finished" — verify by re-running `npx supabase migration list --linked` and confirming the new version appears in both columns.

- [ ] **Step 4: Regenerate types (never hand-edit)**

Run: `npx supabase gen types typescript --linked > src/lib/supabase/types.ts`
Expected: `git diff src/lib/supabase/types.ts` shows the eight new fields on `contact_messages` Row/Insert/Update and a new `contact_messages_user_id_fkey` relationship.

- [ ] **Step 5: Post-change advisors + type check**

Run: `npx supabase db advisors --linked` → no NEW findings for `contact_messages`.
Run: `npx tsc --noEmit` → PASS (existing code selects explicit columns; additive fields break nothing).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260723180000_contact_messages_inquiry_workflow.sql src/lib/supabase/types.ts
git commit -m "feat(inquiries): extend contact_messages with inquiry workflow + drafter fields"
```

---

### Task 2: Validation schemas (public forms + admin status update)

**Files:**
- Create: `src/lib/validation/inquiries.ts`
- Create: `src/lib/validation/inquiries.test.ts`
- Modify: `src/lib/validation/admin.ts` (add `updateContactStatusSchema` right after `updateCallbackStatusSchema`, line ~37)

**Interfaces:**
- Consumes: `isValidPhone` from `@/lib/phone`, `callbackStatusEnum` from `./admin`.
- Produces: `INQUIRY_TOPICS: readonly ['מכירות','תמיכה','חיוב ותשלום','אחר']`; `contactMessageSchema` (fields `name,email?,phone?,topic,message`, refine: email or phone required); `callbackRequestSchema` (fields `full_name,phone,topic,note?`); types `ContactMessageInput`, `CallbackRequestInput`; `updateContactStatusSchema` (`{id: uuid, status: callbackStatusEnum}`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/validation/inquiries.test.ts
import { describe, expect, it } from 'vitest';

import {
  INQUIRY_TOPICS,
  contactMessageSchema,
  callbackRequestSchema,
} from './inquiries';

describe('contactMessageSchema', () => {
  const valid = {
    name: 'דנה לוי',
    email: 'dana@example.com',
    topic: 'מכירות',
    message: 'אשמח לפרטים על המערכת',
  };

  it('accepts a valid submission with email only', () => {
    expect(contactMessageSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts phone instead of email', () => {
    const parsed = contactMessageSchema.safeParse({
      ...valid,
      email: undefined,
      phone: '052-111-2222',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects when both phone and email are missing', () => {
    const parsed = contactMessageSchema.safeParse({ ...valid, email: undefined });
    expect(parsed.success).toBe(false);
  });

  it('rejects an invalid phone', () => {
    const parsed = contactMessageSchema.safeParse({
      ...valid,
      email: undefined,
      phone: '123',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a topic outside the closed vocabulary', () => {
    const parsed = contactMessageSchema.safeParse({ ...valid, topic: 'אחר לגמרי' });
    expect(parsed.success).toBe(false);
  });

  it('rejects an overlong message', () => {
    const parsed = contactMessageSchema.safeParse({
      ...valid,
      message: 'א'.repeat(2001),
    });
    expect(parsed.success).toBe(false);
  });
});

describe('callbackRequestSchema', () => {
  it('accepts a valid call-me-back request', () => {
    const parsed = callbackRequestSchema.safeParse({
      full_name: 'יוסי כהן',
      phone: '0521112222',
      topic: INQUIRY_TOPICS[1],
      note: 'נוח לי אחרי 17:00',
    });
    expect(parsed.success).toBe(true);
  });

  it('requires a phone', () => {
    const parsed = callbackRequestSchema.safeParse({
      full_name: 'יוסי כהן',
      phone: '',
      topic: 'תמיכה',
    });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/validation/inquiries.test.ts`
Expected: FAIL — `Cannot find module './inquiries'`.

- [ ] **Step 3: Implement the schemas**

```ts
// src/lib/validation/inquiries.ts
import { z } from 'zod';

import { isValidPhone } from '@/lib/phone';

// Public inquiry forms (contact + call-me-back). The topic vocabulary is
// closed at the form boundary but stored as-is in free-text columns and
// rendered raw by the admin pages — exactly how callback_requests.topic is
// displayed today, so no label map is needed.
export const INQUIRY_TOPICS = ['מכירות', 'תמיכה', 'חיוב ותשלום', 'אחר'] as const;

const nameSchema = z.string().trim().min(2, 'נא למלא שם').max(120, 'השם ארוך מדי');

const phoneSchema = z
  .string()
  .trim()
  .refine((v) => isValidPhone(v), 'מספר הטלפון אינו תקין');

export const contactMessageSchema = z
  .object({
    name: nameSchema,
    email: z.email('כתובת האימייל אינה תקינה').max(254).optional(),
    phone: phoneSchema.optional(),
    topic: z.enum(INQUIRY_TOPICS, { error: 'נא לבחור נושא' }),
    message: z
      .string()
      .trim()
      .min(5, 'נא לכתוב את תוכן הפנייה')
      .max(2000, 'ההודעה ארוכה מדי'),
  })
  .refine((v) => Boolean(v.email) || Boolean(v.phone), {
    message: 'נא למלא טלפון או אימייל ליצירת קשר',
    path: ['phone'],
  });

export const callbackRequestSchema = z.object({
  full_name: nameSchema,
  phone: phoneSchema,
  topic: z.enum(INQUIRY_TOPICS, { error: 'נא לבחור נושא' }),
  note: z.string().trim().max(500, 'ההערה ארוכה מדי').optional(),
});

export type ContactMessageInput = z.infer<typeof contactMessageSchema>;
export type CallbackRequestInput = z.infer<typeof callbackRequestSchema>;
```

- [ ] **Step 4: Add the admin status schema**

In `src/lib/validation/admin.ts`, directly after `updateCallbackStatusSchema` (line ~37):

```ts
// Form payload for updating a single contact message's status. Reuses the
// SAME closed vocabulary as callbacks — one inquiry status system, not two.
export const updateContactStatusSchema = z.object({
  id: z.string().uuid({ error: 'מזהה לא תקין' }),
  status: callbackStatusEnum,
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/validation/inquiries.test.ts src/lib/validation`
Expected: PASS (new file green, existing admin validation tests untouched).

- [ ] **Step 6: Commit**

```bash
git add src/lib/validation/inquiries.ts src/lib/validation/inquiries.test.ts src/lib/validation/admin.ts
git commit -m "feat(inquiries): public form schemas + contact status schema (shared vocabulary)"
```

---

### Task 3: Rate-limit constant + public data-layer writers

**Files:**
- Modify: `src/lib/constants.ts` (add next to `RSVP_SUBMIT_RATE`, line ~47)
- Create: `src/lib/data/inquiries.ts`
- Create: `src/lib/data/inquiries.test.ts`

**Interfaces:**
- Consumes: `ContactMessageInput`, `CallbackRequestInput` from Task 2; `createAdminClient` from `@/lib/supabase/admin`; `logActivity` from `@/lib/data/activity`; `normalizePhone` from `@/lib/phone`.
- Produces: `INQUIRY_SUBMIT_RATE` constant; `createContactMessage(input: ContactMessageInput, userId: string | null): Promise<{ ok: boolean }>`; `createCallbackRequest(input: CallbackRequestInput, userId: string | null): Promise<{ ok: boolean }>`.

- [ ] **Step 1: Add the rate constant**

In `src/lib/constants.ts`, after `RSVP_SUBMIT_RATE` (line 47):

```ts
export const INQUIRY_SUBMIT_RATE = { limit: intEnv('INQUIRY_SUBMIT_LIMIT', 3), windowMs: 60_000 };
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/data/inquiries.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/data/activity';
import { createContactMessage, createCallbackRequest } from './inquiries';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function mockInsertReturning(id: string) {
  const { client, builder } = createMockSupabase<{ id: string }>({
    data: { id },
    error: null,
  });
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return { client, builder };
}

describe('createContactMessage', () => {
  const input = {
    name: 'דנה לוי',
    email: 'dana@example.com',
    phone: '052-111-2222',
    topic: 'מכירות',
    message: 'אשמח לפרטים',
  } as const;

  it('inserts a normalized row and logs activity for a signed-in submitter', async () => {
    const { client, builder } = mockInsertReturning('cm-1');

    const result = await createContactMessage(input, 'user-1');

    expect(result.ok).toBe(true);
    expect(client.from).toHaveBeenCalledWith('contact_messages');
    expect(builder.insert).toHaveBeenCalledWith({
      name: 'דנה לוי',
      email: 'dana@example.com',
      phone: '+972521112222',
      topic: 'מכירות',
      message: 'אשמח לפרטים',
      user_id: 'user-1',
    });
    expect(logActivity).toHaveBeenCalledWith({
      action: 'inquiry.contact_created',
      meta: { contactMessageId: 'cm-1', source: 'app' },
    });
  });

  it('does NOT call logActivity for an anonymous submitter (no session)', async () => {
    mockInsertReturning('cm-2');

    const result = await createContactMessage({ ...input, email: undefined }, null);

    expect(result.ok).toBe(true);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('returns ok:false on insert error without throwing', async () => {
    const { client } = createMockSupabase<{ id: string }>({
      data: null,
      error: { message: 'boom' },
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await createContactMessage(input, null);

    expect(result.ok).toBe(false);
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe('createCallbackRequest', () => {
  it('inserts a normalized callback row', async () => {
    const { client, builder } = mockInsertReturning('cb-1');

    const result = await createCallbackRequest(
      { full_name: 'יוסי כהן', phone: '0521112222', topic: 'תמיכה', note: undefined },
      null,
    );

    expect(result.ok).toBe(true);
    expect(client.from).toHaveBeenCalledWith('callback_requests');
    expect(builder.insert).toHaveBeenCalledWith({
      full_name: 'יוסי כהן',
      phone: '+972521112222',
      topic: 'תמיכה',
      note: null,
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/data/inquiries.test.ts`
Expected: FAIL — `Cannot find module './inquiries'`.

- [ ] **Step 4: Implement the writers**

```ts
// src/lib/data/inquiries.ts
import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/data/activity';
import { normalizePhone } from '@/lib/phone';
import type {
  CallbackRequestInput,
  ContactMessageInput,
} from '@/lib/validation/inquiries';

// Public/customer inquiry writers. RLS keeps INSERT authenticated-only by
// design, so these run on the service-role client AFTER the calling Server
// Action has rate-limited, honeypot-checked and Zod-validated the input.
// `userId` is attached server-side from the session — never from the browser.
//
// logActivity requires a session (requireUser) — so it runs ONLY for
// signed-in submitters. Anonymous submissions are audited by the inserted
// row itself (created_at + content), which is the meaningful record here.

export async function createContactMessage(
  input: ContactMessageInput,
  userId: string | null,
): Promise<{ ok: boolean }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('contact_messages')
    .insert({
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ? normalizePhone(input.phone) : null,
      topic: input.topic,
      message: input.message,
      user_id: userId,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false };
  }

  if (userId) {
    await logActivity({
      action: 'inquiry.contact_created',
      meta: { contactMessageId: data.id, source: 'app' },
    });
  }
  return { ok: true };
}

export async function createCallbackRequest(
  input: CallbackRequestInput,
  userId: string | null,
): Promise<{ ok: boolean }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('callback_requests')
    .insert({
      full_name: input.full_name,
      phone: normalizePhone(input.phone) ?? input.phone,
      topic: input.topic,
      note: input.note ?? null,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false };
  }

  if (userId) {
    await logActivity({
      action: 'inquiry.callback_created',
      meta: { callbackRequestId: data.id, source: 'app' },
    });
  }
  return { ok: true };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/data/inquiries.test.ts`
Expected: PASS. If `createMockSupabase` lacks `.select().single()` chaining for inserts, extend the mock usage the same way `src/lib/data/admin/callbacks.test.ts` handles `.update().eq()` — inspect `src/test/supabase-mock.ts` first and mirror its builder pattern; do not weaken assertions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/constants.ts src/lib/data/inquiries.ts src/lib/data/inquiries.test.ts
git commit -m "feat(inquiries): service-role inquiry writers + submit rate constant"
```

---

### Task 4: Public `/contact` page + Server Actions + forms

**Files:**
- Create: `src/app/(public)/contact/actions.ts`
- Create: `src/app/(public)/contact/inquiry-forms.tsx`
- Create: `src/app/(public)/contact/page.tsx`

**Interfaces:**
- Consumes: `createContactMessage`/`createCallbackRequest` (Task 3), schemas + `INQUIRY_TOPICS` (Task 2), `INQUIRY_SUBMIT_RATE` (Task 3), `getClientIp`/`rateLimit` from `@/lib/security/rate-limit`, `getUser` from `@/lib/auth/dal`, `FormState` from `@/lib/validation/result`, `SubmitButton`/`FieldError`/`FormError`/`FormNotice` from `@/components/forms`, `Input` from `@/components/ui/input`.
- Produces: route `/contact` (`?t=support` preselects topic 'תמיכה'); actions `submitContactAction`, `submitCallbackAction` with the `useActionState` signature `(prev: FormState, formData: FormData) => Promise<FormState>`.

- [ ] **Step 1: Write the Server Actions**

```ts
// src/app/(public)/contact/actions.ts
'use server';

import { headers } from 'next/headers';

import { INQUIRY_SUBMIT_RATE } from '@/lib/constants';
import { getUser } from '@/lib/auth/dal';
import {
  createCallbackRequest,
  createContactMessage,
} from '@/lib/data/inquiries';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import {
  callbackRequestSchema,
  contactMessageSchema,
} from '@/lib/validation/inquiries';
import type { FormState } from '@/lib/validation/result';

// Public inquiry actions (contact form + call-me-back). Order per form:
// IP rate-limit → honeypot → Zod → server-side session attach → write.
// Errors are generic (no DB/provider detail); the honeypot returns the SAME
// success notice as a real submission so bots learn nothing, but writes
// nothing.

const RATE_ERROR = 'נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.';
const GENERIC_ERROR = 'שליחת הפנייה נכשלה. נסו שוב בעוד רגע.';
const CONTACT_SUCCESS = 'הפנייה נשלחה. נחזור אליכם בהקדם!';
const CALLBACK_SUCCESS = 'הבקשה נשלחה. נתקשר אליכם בהקדם!';

function trimmedOrUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function submitContactAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  if (!rateLimit(`inquiry:contact:${ip}`, INQUIRY_SUBMIT_RATE).allowed) {
    return { error: RATE_ERROR };
  }

  // Honeypot: real users never see/fill "company". Pretend success, write nothing.
  if (trimmedOrUndefined(formData.get('company'))) {
    return { notice: CONTACT_SUCCESS };
  }

  const parsed = contactMessageSchema.safeParse({
    name: formData.get('name'),
    email: trimmedOrUndefined(formData.get('email')),
    phone: trimmedOrUndefined(formData.get('phone')),
    topic: formData.get('topic'),
    message: formData.get('message'),
  });
  if (!parsed.success) {
    return {
      error: 'נא לבדוק את הפרטים שמולאו.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // Identity comes from the verified server session only (null = anonymous).
  const user = await getUser();
  const result = await createContactMessage(parsed.data, user?.id ?? null);
  if (!result.ok) {
    return { error: GENERIC_ERROR };
  }
  return { notice: CONTACT_SUCCESS };
}

export async function submitCallbackAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  if (!rateLimit(`inquiry:callback:${ip}`, INQUIRY_SUBMIT_RATE).allowed) {
    return { error: RATE_ERROR };
  }

  if (trimmedOrUndefined(formData.get('company'))) {
    return { notice: CALLBACK_SUCCESS };
  }

  const parsed = callbackRequestSchema.safeParse({
    full_name: formData.get('full_name'),
    phone: formData.get('phone'),
    topic: formData.get('topic'),
    note: trimmedOrUndefined(formData.get('note')),
  });
  if (!parsed.success) {
    return {
      error: 'נא לבדוק את הפרטים שמולאו.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const user = await getUser();
  const result = await createCallbackRequest(parsed.data, user?.id ?? null);
  if (!result.ok) {
    return { error: GENERIC_ERROR };
  }
  return { notice: CALLBACK_SUCCESS };
}
```

- [ ] **Step 2: Write the client forms component**

```tsx
// src/app/(public)/contact/inquiry-forms.tsx
'use client';

import { useActionState } from 'react';
import Link from 'next/link';

import { INQUIRY_TOPICS } from '@/lib/validation/inquiries';
import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import { Input } from '@/components/ui/input';
import { submitCallbackAction, submitContactAction } from './actions';

// Both public inquiry forms. Server-validated (Zod in the actions); the
// required/type attributes here are UX hints only. The "company" field is a
// honeypot — visually hidden, ignored by real users, checked server-side.

const FIELD_CLS =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';

function Honeypot() {
  return (
    <div aria-hidden="true" className="absolute -m-px size-px overflow-hidden p-0 [clip:rect(0,0,0,0)]">
      <label>
        חברה
        <input type="text" name="company" tabIndex={-1} autoComplete="off" />
      </label>
    </div>
  );
}

function TopicSelect({
  id,
  defaultTopic,
}: {
  id: string;
  defaultTopic?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        נושא הפנייה
      </label>
      <select id={id} name="topic" defaultValue={defaultTopic ?? INQUIRY_TOPICS[0]} className={FIELD_CLS}>
        {INQUIRY_TOPICS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}

function PrivacyNote() {
  return (
    <p className="text-xs text-muted-foreground">
      הפרטים ישמשו למענה לפנייה בלבד.{' '}
      <Link href="/privacy" className="underline hover:text-foreground">
        מדיניות פרטיות
      </Link>
    </p>
  );
}

export function ContactForm({
  defaultTopic,
  defaultEmail,
  defaultName,
}: {
  defaultTopic?: string;
  defaultEmail?: string;
  defaultName?: string;
}) {
  const [state, formAction] = useActionState(submitContactAction, null);

  return (
    <form action={formAction} className="relative space-y-4">
      <Honeypot />
      <div>
        <label htmlFor="contact-name" className="mb-1 block text-sm font-medium">
          שם מלא
        </label>
        <Input id="contact-name" name="name" required defaultValue={defaultName} autoComplete="name" />
        <FieldError errors={state?.fieldErrors?.name} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-email" className="mb-1 block text-sm font-medium">
            אימייל
          </label>
          <Input
            id="contact-email"
            name="email"
            type="email"
            dir="ltr"
            defaultValue={defaultEmail}
            autoComplete="email"
          />
          <FieldError errors={state?.fieldErrors?.email} />
        </div>
        <div>
          <label htmlFor="contact-phone" className="mb-1 block text-sm font-medium">
            טלפון
          </label>
          <Input id="contact-phone" name="phone" type="tel" dir="ltr" autoComplete="tel" />
          <FieldError errors={state?.fieldErrors?.phone} />
        </div>
      </div>
      <TopicSelect id="contact-topic" defaultTopic={defaultTopic} />
      <div>
        <label htmlFor="contact-message" className="mb-1 block text-sm font-medium">
          תוכן הפנייה
        </label>
        <textarea
          id="contact-message"
          name="message"
          required
          rows={5}
          maxLength={2000}
          className={FIELD_CLS}
        />
        <FieldError errors={state?.fieldErrors?.message} />
      </div>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <SubmitButton>שליחת פנייה</SubmitButton>
      <PrivacyNote />
    </form>
  );
}

export function CallbackForm({ defaultTopic }: { defaultTopic?: string }) {
  const [state, formAction] = useActionState(submitCallbackAction, null);

  return (
    <form action={formAction} className="relative space-y-4">
      <Honeypot />
      <div>
        <label htmlFor="cb-name" className="mb-1 block text-sm font-medium">
          שם מלא
        </label>
        <Input id="cb-name" name="full_name" required autoComplete="name" />
        <FieldError errors={state?.fieldErrors?.full_name} />
      </div>
      <div>
        <label htmlFor="cb-phone" className="mb-1 block text-sm font-medium">
          טלפון
        </label>
        <Input id="cb-phone" name="phone" type="tel" required dir="ltr" autoComplete="tel" />
        <FieldError errors={state?.fieldErrors?.phone} />
      </div>
      <TopicSelect id="cb-topic" defaultTopic={defaultTopic} />
      <div>
        <label htmlFor="cb-note" className="mb-1 block text-sm font-medium">
          הערה (לא חובה)
        </label>
        <textarea id="cb-note" name="note" rows={2} maxLength={500} className={FIELD_CLS} />
        <FieldError errors={state?.fieldErrors?.note} />
      </div>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <SubmitButton>חזרו אליי</SubmitButton>
      <PrivacyNote />
    </form>
  );
}
```

- [ ] **Step 3: Write the page**

```tsx
// src/app/(public)/contact/page.tsx
import Link from 'next/link';
import { ArrowLeft, MailOpen, PhoneCall } from 'lucide-react';

import { getUser } from '@/lib/auth/dal';
import { CallbackForm, ContactForm } from './inquiry-forms';

export const metadata = {
  title: 'יצירת קשר ותמיכה',
};

// Session-aware (prefill for signed-in customers) → render per-request.
export const dynamic = 'force-dynamic';

// Public contact-and-support page. One page serves both audiences: anonymous
// prospects (pre-sales) and signed-in customers (support) — the audience is
// derived from the verified server session, never from the URL. `?t=support`
// only preselects the support topic (used by the in-app "עזרה ותמיכה" link).
export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { t } = await searchParams;
  const defaultTopic = t === 'support' ? 'תמיכה' : undefined;
  const user = await getUser();

  return (
    <div className="bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Link href="/" className="text-2xl font-extrabold tracking-tight">
            KALFA
          </Link>
          <Link
            href={user ? '/app' : '/'}
            className="inline-flex items-center gap-2 text-sm font-semibold hover:underline"
          >
            {user ? 'לאזור האישי' : 'לעמוד הבית'}
            <ArrowLeft className="size-4" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-10 px-6 py-12">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">יצירת קשר ותמיכה</h1>
          <p className="mt-2 text-muted-foreground">
            יש לכם שאלה, בקשה או תקלה? כתבו לנו או השאירו מספר — ונחזור אליכם.
          </p>
        </div>

        <section
          id="contact"
          aria-labelledby="contact-heading"
          className="rounded-xl border border-border p-6"
        >
          <h2 id="contact-heading" className="mb-4 flex items-center gap-2 text-xl font-bold">
            <MailOpen className="size-5 text-primary" />
            שליחת פנייה
          </h2>
          <ContactForm
            defaultTopic={defaultTopic}
            defaultEmail={user?.email ?? undefined}
            defaultName={undefined}
          />
        </section>

        <section
          id="callback"
          aria-labelledby="callback-heading"
          className="rounded-xl border border-border p-6"
        >
          <h2 id="callback-heading" className="mb-4 flex items-center gap-2 text-xl font-bold">
            <PhoneCall className="size-5 text-primary" />
            בקשת חזרה טלפונית
          </h2>
          <CallbackForm defaultTopic={defaultTopic} />
        </section>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Static verification**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(public)/contact/"
git commit -m "feat(inquiries): public /contact page — contact + call-me-back forms"
```

---

### Task 5: Entry-point wiring — landing footer + app nav

**Files:**
- Modify: `src/app/(public)/page.tsx:109-113` (FOOTER_COLS) and its render at lines ~454-463
- Modify: `src/components/app-shell.tsx:58-60` (NAV_ITEMS) + its lucide import block

**Interfaces:**
- Consumes: route `/contact` (+ `?t=support`) from Task 4.
- Produces: no exports; two live entry points replacing dead footer text.

- [ ] **Step 1: Wire the footer links (only the two dead entries — no unrelated visual changes)**

In `src/app/(public)/page.tsx`, replace the `FOOTER_COLS` literal (lines 109-113) with:

```ts
const FOOTER_COLS: {
  title: string;
  links: { label: string; href?: string }[];
}[] = [
  { title: 'מוצר', links: [{ label: 'יכולות' }, { label: 'איך זה עובד' }, { label: 'אבטחה' }] },
  {
    title: 'אירועים',
    links: [{ label: 'חתונות' }, { label: 'בר/בת מצווה' }, { label: 'כנסים' }, { label: 'אירועי חברה' }],
  },
  {
    title: 'חברה',
    links: [
      { label: 'אודות' },
      { label: 'יצירת קשר', href: '/contact' },
      { label: 'תמיכה', href: '/contact?t=support' },
    ],
  },
];
```

And replace the footer column render (currently `{col.links.map((l) => (<span key={l} ...>{l}</span>))}`) with:

```tsx
{col.links.map((l) =>
  l.href ? (
    <Link key={l.label} href={l.href} className="text-sm text-white/60 hover:text-white">
      {l.label}
    </Link>
  ) : (
    <span key={l.label} className="text-sm text-white/60">
      {l.label}
    </span>
  ),
)}
```

- [ ] **Step 2: Add the in-app nav entry**

In `src/components/app-shell.tsx`, add `LifeBuoy` to the existing `lucide-react` import, and extend `NAV_ITEMS` (lines 58-60):

```ts
const NAV_ITEMS: NavItem[] = [
  { href: '/app', label: 'לוח בקרה', icon: LayoutDashboard },
  { href: '/app/events', label: 'האירועים שלי', icon: CalendarDays },
  { href: '/app/settings', label: 'הגדרות', icon: Settings },
  { href: '/contact?t=support', label: 'עזרה ותמיכה', icon: LifeBuoy },
];
```

Note: `isActive` (line 65) matches by `pathname`; `/contact` is outside `/app` so the item simply never renders as active — acceptable, no logic change.

- [ ] **Step 3: Static verification**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(public)/page.tsx" src/components/app-shell.tsx
git commit -m "feat(inquiries): wire footer contact/support links + in-app help nav"
```

---

### Task 6: Admin data layer — contact status workflow

**Files:**
- Modify: `src/lib/data/admin/contacts.ts`
- Modify: `src/lib/data/admin/contacts.test.ts` (add `updateContactStatus` tests)

**Interfaces:**
- Consumes: regenerated types (Task 1), `CallbackStatus` from `@/lib/validation/admin`, `logActivity`, `createAdminClient`, `requirePlatformPermission`.
- Produces: widened `ContactMessage` DTO + `CONTACT_COLUMNS = 'id, name, email, phone, message, created_at, status, topic, user_id, handled_at, draft_reply'`; `updateContactStatus(id: string, status: CallbackStatus): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/data/admin/contacts.test.ts` (mirror the `updateCallbackStatus` suite in `src/lib/data/admin/callbacks.test.ts`, including its mock setup; add the missing mock lines to the existing `vi.mock` block if absent — `logActivity` in particular):

```ts
describe('updateContactStatus', () => {
  it('updates status, stamps handled_at for terminal statuses, logs previous status', async () => {
    const { client, builder } = createMockSupabase<{ status: string }>({
      data: { status: 'new' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await updateContactStatus('11111111-1111-4111-8111-111111111111', 'done');

    expect(client.from).toHaveBeenCalledWith('contact_messages');
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'done', handled_at: expect.any(String) }),
    );
    expect(logActivity).toHaveBeenCalledWith({
      action: 'contact.status_updated',
      meta: expect.objectContaining({
        contactMessageId: '11111111-1111-4111-8111-111111111111',
        previousStatus: 'new',
        status: 'done',
      }),
    });
  });

  it('clears handled_at when moving back to a non-terminal status', async () => {
    const { client, builder } = createMockSupabase<{ status: string }>({
      data: { status: 'done' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await updateContactStatus('11111111-1111-4111-8111-111111111111', 'in_progress');

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress', handled_at: null }),
    );
  });
});
```

(UUIDs are real v4 fixtures — Zod 4 `z.uuid()` rejects fakes.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/data/admin/contacts.test.ts`
Expected: FAIL — `updateContactStatus` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/data/admin/contacts.ts`: widen the DTO + columns and add the updater (mirror `updateCallbackStatus` at `src/lib/data/admin/callbacks.ts:56-90`):

```ts
export type ContactMessage = Pick<
  ContactMessageRow,
  | 'id'
  | 'name'
  | 'email'
  | 'phone'
  | 'message'
  | 'created_at'
  | 'status'
  | 'topic'
  | 'user_id'
  | 'handled_at'
  | 'draft_reply'
>;

export const CONTACT_COLUMNS =
  'id, name, email, phone, message, created_at, status, topic, user_id, handled_at, draft_reply';
```

```ts
// Update a single contact message's status. Same closed vocabulary as
// callbacks (validated by the caller's Server Action). handled_at is
// deterministic from the status: terminal (done/cancelled) → stamped now,
// non-terminal → cleared.
export async function updateContactStatus(
  id: string,
  status: CallbackStatus,
): Promise<void> {
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
  const { data: current, error: currentError } = await supabase
    .from('contact_messages')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  if (currentError) {
    throw new Error('עדכון הסטטוס נכשל');
  }

  const terminal = status === 'done' || status === 'cancelled';
  const { error } = await supabase
    .from('contact_messages')
    .update({ status, handled_at: terminal ? new Date().toISOString() : null })
    .eq('id', id);

  if (error) {
    throw new Error('עדכון הסטטוס נכשל');
  }

  await logActivity({
    action: 'contact.status_updated',
    meta: {
      contactMessageId: id,
      previousStatus: current?.status ?? null,
      status,
    },
  });
}
```

Add the imports this needs at the top of the file: `import { logActivity } from '@/lib/data/activity';` and `import type { CallbackStatus } from '@/lib/validation/admin';`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/data/admin/contacts.test.ts src/lib/data/admin/callbacks.test.ts src/lib/data/admin/dashboard.test.ts`
Expected: PASS (existing list/dashboard tests import `CONTACT_COLUMNS` — they follow the widened constant automatically).

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/admin/contacts.ts src/lib/data/admin/contacts.test.ts
git commit -m "feat(inquiries): contact status workflow in admin data layer"
```

---

### Task 7: Admin `/admin/contacts` UI — status + source + drafter output

**Files:**
- Create: `src/app/(admin)/admin/contacts/actions.ts`
- Create: `src/app/(admin)/admin/contacts/contact-status-form.tsx`
- Modify: `src/app/(admin)/admin/contacts/page.tsx`

**Interfaces:**
- Consumes: `updateContactStatus` + widened `ContactMessage` (Task 6), `updateContactStatusSchema` (Task 2), `CALLBACK_STATUSES`/`CALLBACK_STATUS_LABELS`/`callbackStatusLabel` (existing), `Badge`/`formatDateTime`/`Pagination`/`EmptyState`/`PageHeading`/`parsePageParam` from `../_components`, `FormState`.
- Produces: `updateContactStatusAction` Server Action; `ContactStatusForm` client component; the enhanced page.

- [ ] **Step 1: Server Action (mirror of `admin/callbacks/actions.ts`, including the NEXT_REDIRECT re-throw)**

```ts
// src/app/(admin)/admin/contacts/actions.ts
'use server';

import { revalidatePath } from 'next/cache';

import { updateContactStatus } from '@/lib/data/admin/contacts';
import { updateContactStatusSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

// Update a single contact message's status. Validates the closed status
// vocabulary server-side; authorization is enforced inside
// updateContactStatus (requirePlatformPermission).
export async function updateContactStatusAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateContactStatusSchema.safeParse({
    id: formData.get('id'),
    status: formData.get('status'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateContactStatus(parsed.data.id, parsed.data.status);
  } catch (err) {
    // Re-throw Next.js control-flow signals (e.g. redirect from the DAL gate);
    // catching them would silently break the redirect.
    if (
      err &&
      typeof err === 'object' &&
      'digest' in err &&
      typeof (err as { digest?: unknown }).digest === 'string' &&
      (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) {
      throw err;
    }
    return { error: 'עדכון הסטטוס נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/contacts');
  return { notice: 'הסטטוס עודכן' };
}
```

- [ ] **Step 2: Status form component (mirror of `CallbackStatusForm`)**

```tsx
// src/app/(admin)/admin/contacts/contact-status-form.tsx
'use client';

import { useActionState } from 'react';

import { CALLBACK_STATUSES } from '@/lib/validation/admin';
import { CALLBACK_STATUS_LABELS } from '@/lib/data/admin/labels';
import { FieldError, FormError, FormNotice } from '@/components/forms';
import { updateContactStatusAction } from './actions';

// Per-row status control for contact messages — same closed vocabulary and
// same native-select pattern as the callbacks page (no portal/RTL pitfalls).
export function ContactStatusForm({
  id,
  currentStatus,
}: {
  id: string;
  currentStatus: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateContactStatusAction,
    null,
  );

  const isKnown = (CALLBACK_STATUSES as readonly string[]).includes(currentStatus);
  const selectId = `contact-status-${id}`;

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          סטטוס פנייה
        </label>
        <select
          id={selectId}
          name="status"
          defaultValue={currentStatus}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          {!isKnown && <option value={currentStatus}>{currentStatus}</option>}
          {CALLBACK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CALLBACK_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'שומר…' : 'עדכון'}
        </button>
      </div>
      <FieldError errors={state?.fieldErrors?.status} />
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}
```

- [ ] **Step 3: Enhance the page**

Replace `src/app/(admin)/admin/contacts/page.tsx` with:

```tsx
import { requirePlatformPermission } from '@/lib/auth/dal';
import { listContactMessages } from '@/lib/data/admin/contacts';
import { callbackStatusLabel } from '@/lib/data/admin/labels';
import {
  PageHeading,
  EmptyState,
  Pagination,
  Badge,
  formatDateTime,
  parsePageParam,
} from '../_components';
import { ContactStatusForm } from './contact-status-form';

// Admin: contact-form + in-app support submissions, paginated server-side.
// Personal data is shown to authorized staff only — the layout gate is
// optimistic; every query re-checks the permission server-side. Each row shows
// source (anonymous/registered), topic, status workflow, and the
// support-drafter reply draft when one exists (draft only — sending is human).

export default async function AdminContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  await requirePlatformPermission('view_customer_data');
  const page = parsePageParam((await searchParams).page);
  const result = await listContactMessages({ page });

  return (
    <div className="space-y-6">
      <PageHeading>פניות</PageHeading>

      {result.items.length === 0 ? (
        <EmptyState>אין פניות עדיין.</EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {result.items.map((msg) => (
            <li
              key={msg.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{msg.name}</p>
                  <Badge>{callbackStatusLabel(msg.status)}</Badge>
                  <Badge>{msg.user_id ? 'לקוח רשום' : 'פנייה ציבורית'}</Badge>
                  {msg.topic && <span className="text-sm">{msg.topic}</span>}
                </div>
                <p className="text-sm text-muted-foreground" dir="ltr">
                  {[msg.email, msg.phone].filter(Boolean).join(' · ') || '—'}
                </p>
                <p className="whitespace-pre-wrap text-sm">{msg.message}</p>
                {msg.draft_reply && (
                  <div className="rounded-md border border-border bg-muted/40 p-3">
                    <p className="text-xs font-semibold text-muted-foreground">
                      טיוטת מענה (סוכן) — לא נשלחה
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{msg.draft_reply}</p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(msg.created_at)}
                  {msg.handled_at ? ` · טופל: ${formatDateTime(msg.handled_at)}` : ''}
                </p>
              </div>
              <ContactStatusForm id={msg.id} currentStatus={msg.status} />
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/admin/contacts"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
```

- [ ] **Step 4: Static verification**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. (If `Badge` is not exported from `../_components`, import it the way `admin/callbacks/page.tsx:8` does — same source, keep imports identical to that page.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/contacts/"
git commit -m "feat(inquiries): admin contacts — status workflow, source badge, drafter output"
```

---

### Task 8: Full verification gate + runtime check + deploy

**Files:** none (verification only)

- [ ] **Step 1: Full static + test + build gates**

```bash
npm run lint && npx tsc --noEmit && npx vitest run && npm run build
```
Expected: all PASS (build uses `--webpack`; do not run concurrently with any other build).

- [ ] **Step 2: Runtime browser verification (invoke the `verifying-kalfa-changes` skill)**

Verify against the running app (authed browser session):
1. `/contact` anonymous: both forms render RTL, submit a contact inquiry → success notice; submit a callback → success notice; 4th rapid submit from same IP → rate-limit error.
2. `/contact` signed-in: email prefilled; `?t=support` preselects 'תמיכה'.
3. `/admin/contacts`: both rows appear; anonymous row shows 'פנייה ציבורית', signed-in row 'לקוח רשום'; status change → badge updates, terminal status stamps 'טופל:'; activity log shows `contact.status_updated`.
4. `/admin/callbacks`: callback row appears with topic; status workflow unchanged.
5. Landing footer: 'יצירת קשר' and 'תמיכה' navigate to `/contact`; app sidebar shows 'עזרה ותמיכה'.
6. Honeypot: POST with `company` filled → success notice shown, NO row created (verify via `/admin/contacts` count).

⚠️ These create real rows in the production DB (`no-live-test-events-in-qa`): use clearly-marked content (e.g. message `בדיקת מערכת — נא להתעלם`), then set their status to 'cancelled' — or delete them via SQL with explicit user approval.

- [ ] **Step 3: ⛔GATE — merge/push + deploy only on explicit approval**

```bash
# after approval only:
git checkout main && git merge --no-ff feat/customer-inquiries
git push
npm run deploy   # pm2 kalfa-beta per beta-deployment procedure
```

- [ ] **Step 4: Close the loop**

Update `.claude/fleet/fleet.json` support-drafter blocker note (data source now exists: `contact_messages.status='new'` → output `draft_reply`) — the role itself remains disabled pending the fleet workstream. Report changed files, verification results, security considerations, and known limitations.

---

## Self-Review (done at plan-writing time)

- **Spec coverage:** `/admin/contacts` ↔ public+in-app contact form (Tasks 2-5, 7); `/admin/callbacks` ↔ public callback form (Tasks 2-5); `/admin/support` ↔ in-app 'עזרה ותמיכה' entry + support topic routing into the same inquiry inbox (Tasks 4-5) — per the gap report, support is a channel into `contact_messages`, not a new entity. support-drafter fields land in Task 1, surface in Task 7.
- **No placeholders:** every code step is complete and mirrors read-verified files (`callbacks.ts`, `callback-status-form.tsx`, `r/[token]/actions.ts`, `rate-limit.ts`, `forms.tsx`, `labels.ts`).
- **Type consistency:** `updateContactStatus(id: string, status: CallbackStatus)` matches `updateContactStatusSchema`; `CONTACT_COLUMNS` matches the widened `Pick`; action signatures match `useActionState` usage.
- **Known open risk:** `createMockSupabase` insert-chain support (Task 3 Step 5 notes the fallback: mirror the existing builder pattern from `supabase-mock.ts` — read it before writing the tests).
