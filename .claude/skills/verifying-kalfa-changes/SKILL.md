---
name: verifying-kalfa-changes
description: >
  Use before declaring ANY KALFA code change complete — the mandatory
  verification gate ("סיימתי", "מוכן", before commit/deploy/PR), or when the
  user asks to verify/בדוק שהכול עובד. Covers static gates, tests, build, and
  the runtime browser check that static gates cannot catch.
---

# Verification gate — kalfa.me

A change is NOT done when the code compiles. Run the gates in this order and
report actual outputs — never summarize a failure as success.

## 1. Static gates (all three, always)

```bash
npm run lint
npx tsc --noEmit
npm run build
```

- The build script is `next build --webpack` — Turbopack breaks `/_not-found`
  here (VERIFIED). Don't "fix" the script back to turbopack.
- Never suppress failures with @ts-ignore/@ts-nocheck, broad eslint-disables,
  skipped tests, or `any` casts. A gate that fails = the task is open.
- Don't run a second concurrent `next build` — a Codex/other session may hold
  the shared lock; wait instead of competing.

## 2. Tests

```bash
npm test -- --run          # full suite when practical
npx vitest run <focused>   # relevant focused tests first
```

Fixtures: real v4 UUIDs (z.uuid enforces variant bits), real-shaped Hebrew
names/phones. New behavior needs a new/updated test, not just green old ones.

## 3. Runtime gate (static gates MISS these — VERIFIED failure class)

Client/server-boundary and Base UI errors surface only at runtime:
- Load the touched pages in the browser (dev or built) and check the console
  for errors — an authenticated pass for owner/admin surfaces.
- RTL + both themes for UI changes; forms actually submit; empty/forbidden/
  not-found states render.

## 4. Report

Changed files · gate outputs (verbatim pass/fail) · security notes
(authz/ownership on any new surface) · known limitations. If ANY gate was
skipped, say so explicitly — a skipped gate is a limitation, not a detail.
