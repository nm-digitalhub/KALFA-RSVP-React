---
name: israeli-osek-patur-tax
description: CPA-grade tax guidance for an Israeli VAT-exempt dealer (עוסק פטור) running a small business. Use when the user asks about "osek patur ceiling", "תקרת עוסק פטור", "VAT exempt dealer Israel", "annual tax return Israel", "דוח שנתי", "טופס 1301", "הצהרת עוסק פטור", "receipts vs tax invoices", "קבלה או חשבונית", "ביטוח לאומי עצמאי", "מקדמות", "הוצאות מוכרות", "עסק זעיר", "פנסיה לעצמאים", "קרן השתלמות", crossing the exempt-dealer ceiling, or becoming an עוסק מורשה. Verifies every figure against current-year live sources before answering — never from memory. Do NOT use for consumer-protection/e-commerce compliance (use israeli-ecommerce-compliance), privacy (use israeli-privacy-shield), or SUMIT payment-API mechanics (use the sumit-billing-expert agent).
license: MIT
allowed-tools: Bash(python:*) WebFetch
compatibility: Works with Claude Code, OpenClaw, Cursor. In this repo, pairs with the israeli-tax-advisor agent and shared/tax-catalog-israel.md.
---

# Israeli Osek-Patur Tax

## Instructions

> **Note:** This skill provides tax information, not tax advice. It does not
> replace a licensed accountant (רואה חשבון) or tax advisor (יועץ מס). Route
> filing, audit, and optimization decisions to the human CPA. Answer in Hebrew
> when the user writes Hebrew.

### Step 1: Verify current-year figures (BLOCKING)

Nearly every number in this domain is indexed or amended annually. Before
answering with ANY shekel amount, rate, or deadline:
1. Read `evidence.json` — if a needed claim's `fetched_at` is from a previous
   tax year (or >~6 months old), re-verify it live before use.
2. Live-verification hierarchy: (a) Nevo statute pages fetch live and carry
   the current indexed amounts inside the text (e.g. the עוסק-פטור ceiling in
   VAT-Law §1); (b) btl.gov.il fetches live; (c) cross-check ≥2 current-year
   sources via search; (d) Wayback snapshots only as last resort, stating the
   snapshot date. kolzchut/gov.il may be WAF-blocked from servers.
3. State the verification date next to every figure you give.

### Step 2: Status obligations and document types

Confirm the business is (still) an עוסק פטור, then apply:
- Turnover ceiling 2026: 122,833 ₪ (statutory definition; מחזור not profit).
- Documents: קבלה mandatory on every payment; חשבונית עסקה statutorily
  mandatory per §45 for every transaction (receipt-only is common practice —
  the gap is a CPA-question; a combined חשבונית עסקה/קבלה satisfies both);
  **חשבונית מס prohibited** (§47(א); criminal offense §117(א)(5)); no VAT
  line anywhere; allocation numbers (חשבוניות ישראל) not applicable.
- Details: `references/vat-osek-patur.md`.

### Step 3: Annual compliance calendar

Walk the year's obligations, with current-year deadlines verified per Step 1:
- 31 January: הצהרת עוסק פטור on last year's turnover (VAT).
- April–June (published annually): דוח שנתי 1301 online (+ מייצגים
  extensions); reconcile מקדמות.
- During the year: income-tax and BTL advances; BTL file open and updated.
- By 31 December: mandatory pension + hishtalmut deposits for the year.
- Details: `references/income-tax-annual.md`,
  `references/bituach-leumi-self-employed.md`,
  `references/pension-hishtalmut.md`.

### Step 4: Expense review — עסק זעיר vs actual expenses

An עוסק פטור is auto-registered as בעל עסק זעיר (30% automatic deduction from
turnover, replacing actual expenses and the BTL §47א deduction; hishtalmut
§17(5א) survives). Each year compare: 30%×turnover vs (real expenses + 52% BTL
deduction + other deductions). Present the comparison; route the final choice
to the CPA when the margin is small.

### Step 5: Ceiling-proximity check

Run the bundled script with year-to-date turnover (from the billing records):

```bash
python3 scripts/ceiling_check.py <ytd_turnover_nis> [--as-of YYYY-MM-DD]
```

It reads the ceiling from `evidence.json` (refuses stale evidence), reports %
of ceiling and a run-rate projection, and flags WATCH / ON-TRACK-TO-CROSS /
CROSSED states.

### Step 6: Transition playbook (crossing the ceiling)

If projected or actual turnover crosses the ceiling: change classification at
the regional VAT office BEFORE receiving the crossing payment; from then on
charge 18% VAT and issue tax invoices; input VAT is not retroactive; re-check
every status-dependent obligation (accessibility exemption, pricing display,
document templates). Beware the unsupported "25% tolerance" myth — no source
confirms it. Details: `references/vat-osek-patur.md`.

### Step 7: Escalate

Anything involving filing decisions, audits, borderline expense
classification, or optimization → present the verified position, label it
(verified-source / inference / CPA-question), and add open items to the
CPA-questions list (in this repo: `.claude/agents/shared/tax-catalog-israel.md`).

## Examples

### Example 1: Ceiling anxiety
User says: "אני מתקרב לתקרת עוסק פטור, מה קורה אם אעבור אותה?"
Actions:
1. Verify the current ceiling live (Step 1).
2. Run `ceiling_check.py` with YTD turnover.
3. Explain the transition playbook (Step 6) incl. no-retroactive-input-VAT and
   the debunked 25% myth.
Result: Dated, sourced answer with % of ceiling, projection, and a concrete
before-the-crossing-payment action list.

### Example 2: Which document to issue
User says: "לקוח מבקש חשבונית מס, מותר לי?"
Actions:
1. Confirm עוסק-פטור status.
2. Answer: prohibited; offer קבלה / חשבונית עסקה instead (Step 2).
3. If the customer needs input-VAT deduction — explain why impossible and log
   repeated demand as a transition-timing consideration.
Result: Clear "no" with the statutory basis (§31(3)) and legal alternatives.

### Example 3: Annual planning
User says: "מה אני חייב לעשות עד סוף השנה מבחינת מסים?"
Actions:
1. Steps 1+3: verified calendar for the current year.
2. Step 4: עסק-זעיר vs actual-expenses comparison.
3. Pension/hishtalmut deposit check before 31 December.
Result: A dated checklist with amounts, deadlines, and CPA-questions flagged.

## Bundled Resources

### References
- `references/vat-osek-patur.md` — status, ceiling, documents, transition.
  Consult in Steps 2 and 6.
- `references/income-tax-annual.md` — 1301, brackets, credit points, עסק
  זעיר, expenses, bookkeeping. Consult in Steps 3-4.
- `references/bituach-leumi-self-employed.md` — definition, 2026 rates,
  advances, mixed employment. Consult in Step 3.
- `references/pension-hishtalmut.md` — mandatory pension + hishtalmut 2026
  ceilings and deadlines. Consult in Step 3.

### Scripts
- `scripts/ceiling_check.py` — ceiling proximity + run-rate projection;
  reads the ceiling from evidence.json and refuses stale evidence.

## Gotchas

- Training-data figures are ALWAYS suspect here: the ceiling, brackets, BTL
  thresholds, and pension caps change every January (and 2026 changed brackets
  retroactively mid-year). Verify live, date every figure.
- The ceiling measures turnover (מחזור), not profit — a common user confusion.
- The "stay exempt up to 25% overshoot" claim circulates widely but has no
  verified source — treat as myth unless the CPA confirms otherwise.
- עסק זעיר registration is AUTOMATIC for an עוסק פטור — users may be in the
  regime without knowing; the 30% deduction silently replaces their actual
  expenses and the BTL deduction unless they opt out.
- The statute prints PRE-INDEXATION base amounts for some figures — the
  credit-point base (504 ₪ in §33א vs operative 242 ₪/month) and the low
  tax brackets (74,640/107,040 in §121 vs operative 84,120/120,720) — never
  quote such figures from the statute text without cross-checking the Tax
  Authority's published table. (The עוסק-פטור ceiling in VAT-Law §1 IS
  maintained current in the text — verified; that's the exception, not the
  rule.)
- An עוסק פטור who is also salaried keeps the exemption regardless of salary
  size — only business turnover counts for the ceiling.

## Troubleshooting

### Error: "ceiling evidence is N days old"
Cause: `scripts/ceiling_check.py` found `vat-exempt-ceiling` in evidence.json
older than its staleness guard.
Solution: Re-verify the ceiling live (Nevo VAT-Law §1 carries the current
figure in the definition), update the claim's value + `fetched_at`, rerun.

### Error: kolzchut/gov.il returns 403
Cause: WAF blocks server IPs (curl and WebFetch alike).
Solution: Use the Nevo statute text (fetches live) or btl.gov.il first;
cross-check ≥2 current-year sources via search; Wayback via curl as last
resort — and state the snapshot date next to the figure.

### Error: conflicting deadline figures between sources
Cause: filing deadlines are published per-year and extended ad hoc.
Solution: Prefer the newest source naming the exact tax year; if still
ambiguous, give the range, say so, and mark the precise date as to-verify.
