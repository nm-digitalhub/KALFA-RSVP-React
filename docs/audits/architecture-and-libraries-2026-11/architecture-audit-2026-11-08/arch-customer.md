I've sent the read-only audit of the customer slice to team-lead. Nothing was changed. The slice is 97 files, about 14.9k lines, and I read the main files in full through Serena; the rest I only scanned by symbols and imports, so claims about them are marked INFERRED.

**Main findings:**
- **Server actions that do the whole job themselves:**
  - `import-actions.ts:56-348` is one action doing file decoding, CSV parsing, row validation, duplicate checks, a direct service-role query, group creation, bulk insert and the contacts rebuild.
  - `auth/actions.ts:124-151` runs signup referral attribution with two service-role queries inside the action.
  - `whatsapp/actions.ts` and `whatsapp/page.tsx:33-39` query the database directly.
  - `settings/actions.ts:66` writes `profiles.phone` directly.
  - `agreement/route.ts` does three service-role reads plus its own inline owner check.
- **Staff and customer code in the same files:** `campaign-actions.ts` holds the staff-only pause, close, cancel and reschedule actions. The customer campaign page switches between admin and owner data reads four times (page.tsx:60-120). `manage-client.tsx:767-804` renders the staff actions section.
- **Large files (over 400 lines):**

| File | Lines |
|---|---|
| `manage-client.tsx` | 1003 |
| `settings-client.tsx` | 696 |
| `cardcom-open-fields-form.tsx` | 614 |
| `guests/page.tsx` | 488 |
| `events/[id]/page.tsx` | 484 (two pages in one file) |
| `org-roles-client.tsx` | 461 |
| `campaign-actions.ts` | 442 |
| `edit-event-form.tsx` | 405 |

- **Duplication (11 groups, checked on both sides), for example:**
  - The create and edit event actions and forms repeat the same helpers, field markup and image checks.
  - `formatDate` in the event page is identical to `formatEventDate` in `event-summary.tsx`.
  - The post-import contacts loop is identical in the CSV and WhatsApp imports.
  - The three campaign send actions have the same body.
  - `org-roles-client.tsx` copies the admin `roles-client.tsx` (a code comment says so).
  - The "funded" check at `manage-client.tsx:854` duplicates `isFunded` in `event-labels.ts:166-168`.
  - The settings password reset leaves out `redirectTo`, which the auth version sets.

**Security notes:**
- `campaign-actions.ts:173-174` records the terms-approval IP from the first `x-forwarded-for` entry. The project's own `client-ip.ts` says evidence IPs must come from `x-real-ip`, because the client controls `x-forwarded-for`.
- `auth/callback/route.ts:12-13` checks the redirect target with its own inline test instead of the shared `resolveAppRedirectPath`. A `/\host` value passes that test; whether a browser then treats it as another site is my inference.

Several actions have no permission check in the action file itself: pause, close and cancel, the thank-you schedule, the guest mutations, and the cancellation request. Their comments say the check happens in `src/lib`, which I did not read, so I couldn't verify it.

The report has no code, no fix suggestions and no folder proposals, as the brief required.