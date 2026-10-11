# Proposal

## Why

Customers can now consent to KALFA marketing email (change `marketing-email-consent`, live since 11.10.2026), but nothing sends one. The owner approved three designs on 11.10.2026: a welcome, a reminder to finish setting up an event, and a "how it works" email (canvas https://claude.ai/artifact/Ujm9KokC6Tyx6sfRyFDLyG). This change turns them into real templates and sends each one to the right customer at the right time. Only customers who consent receive them, and an unsubscribe takes effect in one click.

## What Changes

- **Three code templates.** They follow the approved designs, are built the same way as the existing React Email templates in `src/lib/email/templates.ts`, and include a plain-text version.
  - Each one opens its subject line and its body with "פרסומת".
  - Each footer carries the advertiser's legal name, address, phone and email, read from `app_settings`.
  - Each includes an unsubscribe link.
- **A send ledger.** Every marketing email that goes out is recorded once per customer and template, and once per event for the setup reminder, so nobody gets the same email twice. The table is server-only, like the consent ledger.
- **A scheduled sender.** A pg-boss sweep finds who is due for which email. Before every send it re-checks consent, the confirmed address and the send window. It sends only:
  - on weekdays 09:00–20:30 and Friday until 12:00, Israel time;
  - never on Shabbat or a festival, reusing `jewish-calendar.ts`;
  - never on Yom Kippur, Yom HaZikaron, Yom HaShoah or Tisha B'Av, which `@hebcal/core` already reports (checked).
- **One-click unsubscribe.** A public endpoint takes a signed per-customer token. It handles:
  - `List-Unsubscribe` with `List-Unsubscribe-Post` (RFC 8058 one-click: POST, no login);
  - the footer link, where GET shows a confirm page and POST records.
  An unsubscribe records a `withdraw` in the consent ledger and queues the existing Resend sync.
- **A separate switch.** `app_settings.marketing_emails_enabled` defaults to off, apart from `marketing_consent_enabled`, so the owner can collect consent without sending.

## Capabilities

### New Capabilities
- `marketing-email-sending`: which marketing email a consenting customer receives, when, and the checks every send passes.
- `marketing-unsubscribe`: how a recipient leaves the marketing list from an email, with one click or through a confirm page, and how that is recorded.

### Modified Capabilities
None. The consent capabilities are still in the unarchived change `marketing-email-consent`, and this change uses them without changing their requirements.

## Impact

- **Database:** one migration created with `supabase migration new`. It adds `marketing_email_sends` (server-only, unique per customer + template [+ event]) and `app_settings.marketing_emails_enabled`. It is pushed only with approval.
- **Code:**
  - a new `src/lib/email/marketing-templates.ts`;
  - a new `src/lib/data/marketing-email-sweep.ts`;
  - `src/lib/email/sender.ts`, which gains optional `headers`;
  - a new public route `src/app/api/marketing/unsubscribe/route.ts` and page `src/app/(public)/unsubscribe/`;
  - `src/lib/queue/queues.ts`, `worker/main.ts` and `src/lib/ops/queue-schedule.ts`.
- **Secrets:** one new server-only env var for signing unsubscribe tokens.
- **Depends on:** `computeSetupSteps` (`src/lib/data/setup-steps.ts`) for the reminder's next step. The in-flight change `separate-event-setup-from-management` reshapes setup, so the reminder reads the step model rather than hard-coding step names.
- **Out of scope:** broadcasts, holiday campaigns, A/B tests, and re-permission of existing accounts.
