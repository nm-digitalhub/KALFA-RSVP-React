The full audit report for the top level of `src/lib/data/` (138 source files, 34,677 lines) has been sent to team-lead. Its main findings are below. Nothing was edited; all code was read through Serena.

- **One god module:** `console-calls.ts` (3,706 lines) holds at least 12 separate jobs in one file. Its own comment calls the widget path dead code, yet LSP shows `evaluateWidgetCallCaps` is still used by `src/app/api/widget/call-intent/route.ts:87`.
- **Functions that mix everything:**
  - `resolveCancellationRequest` (315 lines) combines the permission check, database reads and writes, fee and refund rules, email, refund and SMS in one function.
  - `recordPackageApproval` does database work, renders and stores the PDF, and calls the approval RPC.
  - `whatsapp-import.ts` combines CSV parsing, the WhatsApp media download, staging and reply text.
- **Repeated code:** the same code is copied across parallel modules:
  - the Exchange "business connection" loader;
  - the sales and callback attempt-table modules, identical except for the table name;
  - three Voximplant dispatchers;
  - two voice-tool handlers;
  - about a dozen copies of the `app_settings` flag reader;
  - direct `activity_log` inserts in 12 files;
  - five `sha256Hex` helpers;
  - CSV row parsing, duplicated in `import-actions.ts`.
- **Code in the wrong place:**
  - `isDncListed` lives in `outreach-engine.ts`, but its only callers are the call-center code and `src/lib/dnc`.
  - Provider clients sit under `data/`: `instagram-token-refresh.ts` (which also rewrites `.env.local`) and `elevenlabs-status.ts`.
  - Display code sits under `data/` too: `event-labels.ts` imports a type from `@/components/ui/badge`, and `celebrant-display.ts` holds icons.
  - 81 of the 138 files have Hebrew string literals in executable code. That is a raw count; I didn't separate user-facing text from Slack-only text.
- **One possible security issue:** in `agreements.ts:143-160`, the code reads a campaign by an id the caller supplies, using the service-role client. It returns status-specific errors before the ownership check at line 163. My inference is that a signed-in user could learn another campaign's approval state; I did not test this.

**Coverage:**
- All 138 files got a line count and an import/query profile.
- About 37 files got a symbol overview.
- I read the key functions in full, including every duplicated pair. Most of `console-calls.ts` (about 3,250 lines) I saw only through its symbol table.
- About 100 small files were classified only from their header comments and exports. Their one-line descriptions are therefore inferred, and I make no mixed-concern claims about them.

The advisor was rate-limited, so the report had no second review before sending.