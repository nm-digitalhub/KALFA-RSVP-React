# Test Scenarios

Use these scenarios for manual review, regression testing, and expansion planning. Each scenario includes an expected area, risk, and verification focus.

| Number | Scenario | Input | Expected area | Expected risk | Verification focus |
| --- | --- | --- | --- | --- | --- |
| 1 | Supplier sends VAT invoice | `חשבונית מס` | tax | medium | VAT Law and invoice fields. |
| 2 | Supplier sends receipt only | `קבלה` | tax | medium | Payment proof versus VAT deduction. |
| 3 | Combined invoice and receipt | `חשבונית מס קבלה` | tax | medium | Payment and VAT documentation. |
| 4 | Freelancer claims exempt status | `עוסק פטור` | tax | high | VAT status, turnover, sector exclusions. |
| 5 | VAT-registered supplier | `עוסק מורשה` | tax | high | VAT reporting and input tax. |
| 6 | Customer deducts tax | `ניכוי מס במקור` | tax | high | Certificate rate and expiry. |
| 7 | Business pays tax advances | `מקדמות מס הכנסה` | tax | medium | Annual reconciliation. |
| 8 | New service agreement | `הסכם התקשרות` | contracts | high | Scope, price, liability, termination. |
| 9 | Serious breach clause | `הפרה יסודית` | contracts | high | Cure period, notice, cancellation. |
| 10 | Agreed penalty clause | `פיצוי מוסכם` | contracts | high | Proportionality and trigger. |
| 11 | One-sided template term | `תנאי מקפח` | contracts | high | Standard Contracts Law review. |
| 12 | Consumer cancels order | `ביטול עסקה` | consumer | medium | Dates, product type, cancellation fee. |
| 13 | Online purchase | `עסקת מכר מרחוק` | consumer | medium | Disclosure and cancellation rules. |
| 14 | Off-premises sale | `עסקה ברוכלות` | consumer | medium | Initiation, location, vulnerable consumer. |
| 15 | Termination notice | `הודעה מוקדמת` | employment | high | Employment dates and salary basis. |
| 16 | Severance dispute | `פיצויי פיטורים` | employment | high | Termination reason and pension releases. |
| 17 | Minimum wage check | `שכר מינימום` | employment | high | Current amount from official source. |
| 18 | Overtime claim | `שעות נוספות` | employment | high | Attendance records and pay calculation. |
| 19 | Annual leave balance | `חופשה שנתית` | employment | medium | Accrual, use, redemption. |
| 20 | Customer spreadsheet | `מאגר מידע` | privacy | high | Data categories, access, security. |
| 21 | Marketing checkbox | `הסכמה` | privacy | high | Notice, purpose, voluntariness. |
| 22 | Negative online review | `לשון הרע` | civil | high | Exact publication and defenses. |
| 23 | Enforcement warning | `הוצאה לפועל` | debt | critical | Case number, warning date, deadlines. |
| 24 | Demand letter | `התראה לפני נקיטת הליכים` | debt | high | Debt basis and response deadline. |
| 25 | Small claim | `תביעה קטנה` | procedure | medium | Current monetary limit and evidence. |
| 26 | Statement of defense | `כתב הגנה` | procedure | critical | Service date and filing deadline. |
| 27 | Limited company | `חברה בע״מ` | companies | high | Registry, signatory authority, guarantees. |
| 28 | Personal guarantee | `ערבות אישית` | finance | critical | Amount cap, expiry, notice, release. |
| 29 | Security interest | `שעבוד` | finance | high | Registration, priority, release letter. |
| 30 | Mixed text detection | `חשבונית מס קבלה וניכוי מס במקור` | tax | high | Multiple detected terms. |

## Regression commands

```bash
pytest
python -m compileall scripts/ -q
hebrew-legal-term-translator lookup "חשבונית מס" --json
hebrew-legal-term-translator explain-text "החוזה כולל פיצוי מוסכם והפרה יסודית" --json
python scripts/examples/privacy_terms.py --env sandbox
```

## Manual acceptance criteria

- Return a structured result for each exact Hebrew term.
- Preserve Hebrew characters in JSON with `ensure_ascii=False`.
- Include at least one official Israeli source for each matched term.
- Flag `critical` for enforcement, defense filing, and personal guarantee scenarios.
- Reject empty queries and unsupported languages.
- Avoid legal advice phrasing.
- Use DD/MM/YYYY for review dates and ₪ for amounts in examples.
