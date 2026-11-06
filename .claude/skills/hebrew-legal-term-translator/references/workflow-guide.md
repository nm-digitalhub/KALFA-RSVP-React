# Workflow Guide

## Workflow 1: Review a supplier invoice

Use when a small business receives a document titled `חשבונית`, `חשבונית מס`, `קבלה`, or `חשבונית מס קבלה`.

1. Capture the original document.
2. Run lookup for the exact title.
3. Extract supplier name, VAT number, document number, date, amount in ₪, VAT amount, and payment status.
4. Compare the output against the cited VAT source.
5. Decide whether the document supports bookkeeping, payment proof, VAT input deduction, or only a payment request.
6. Save the structured result with the document.

CLI:

```bash
hebrew-legal-term-translator explain-text "חשבונית מס קבלה על סך ₪1,180 כולל מע״מ" --json --env sandbox
```

Risk triggers:

- Missing VAT number.
- Supplier claims exempt status but charges VAT.
- Document title is `חשבונית עסקה`.
- Date is outside the reporting period.
- Amount or VAT rate appears inconsistent.

## Workflow 2: Review a freelancer service agreement

Use before a freelancer signs a new service agreement.

1. Search the agreement for `הסכם התקשרות`, `פיצוי מוסכם`, `הפרה יסודית`, `הודעה מוקדמת`, `סודיות`, and `קניין רוחני`.
2. Run `explain-text` on each clause.
3. Mark high-risk clauses that affect payment, cancellation, liability, ownership, or exclusivity.
4. Ask for missing facts: scope, milestones, late-payment rule, revision limit, termination notice, and invoice type.
5. Verify cited contract-law sources.
6. Prepare negotiation notes in plain language.

CLI:

```bash
hebrew-legal-term-translator explain-text "הסכם התקשרות כולל פיצוי מוסכם במקרה של הפרה יסודית" --json
```

## Workflow 3: Handle an online consumer cancellation

Use when a consumer wants to cancel an online order or service.

1. Identify whether the transaction is `עסקת מכר מרחוק`.
2. Record purchase date, delivery date, cancellation request date, product or service type, and price in ₪.
3. Check whether the consumer purchased personally or through a business.
4. Explain `ביטול עסקה` and cite the Consumer Protection Law.
5. Check current regulator guidance for exceptions and fees.
6. Draft a factual request after legal review if needed.

CLI:

```bash
hebrew-legal-term-translator lookup "עסקת מכר מרחוק" --json --env sandbox
```

## Workflow 4: Review payroll and termination terms

Use when a small employer or household employer sees employment terms.

1. Detect `שכר מינימום`, `שעות נוספות`, `חופשה שנתית`, `הודעה מוקדמת`, and `פיצויי פיטורים`.
2. Record start date, end date, salary basis, hours, leave balance, and payslips.
3. Verify current rates and statutory updates in official publications.
4. Treat deadlines and termination documents as high risk.
5. Escalate uncertain classification or termination disputes.

CLI:

```bash
hebrew-legal-term-translator explain-text "העובד דורש פיצויי פיטורים והודעה מוקדמת" --json
```

## Workflow 5: Respond to a debt warning

Use when a consumer, freelancer, or business receives a warning letter or enforcement notice.

1. Identify `התראה לפני נקיטת הליכים`, `הוצאה לפועל`, `תביעה קטנה`, or `כתב הגנה`.
2. Record service date in DD/MM/YYYY format and claimed amount in ₪.
3. Capture case number, creditor identity, supporting invoice, agreement, judgment, or bill.
4. Flag deadlines before evaluating the merits.
5. Use cited court or enforcement source for current forms and deadlines.
6. Escalate critical results before the deadline.

CLI:

```bash
hebrew-legal-term-translator explain-text "קיבלתי התראה לפני נקיטת הליכים על חוב בסך ₪4,200" --json
```

## Workflow 6: Review privacy wording for a customer list

Use when a small business collects names, phone numbers, emails, purchase history, or marketing preferences.

1. Identify `מאגר מידע` and `הסכמה`.
2. Map categories of personal data.
3. Record purpose, access roles, storage location, retention period, and transfer recipients.
4. Check whether marketing consent is separate and documented.
5. Verify current Privacy Protection Authority guidance.
6. Store the explanation with the privacy notice and collection form.

CLI:

```bash
hebrew-legal-term-translator explain-text "הטופס כולל הסכמה לשימוש במידע ושמירה במאגר מידע" --json
```

## Workflow 7: Check company and guarantee exposure

Use before signing with a company or signing as guarantor.

1. Identify `חברה בע״מ`, `ערבות אישית`, and `שעבוד`.
2. Request company number, signatory authority, registry extract, guarantee amount, expiry, and release terms.
3. Confirm whether the signer signs only for the company or also personally.
4. Treat unlimited personal guarantees as critical.
5. Verify company, guarantee, and pledge sources.
6. Keep all versions and signature pages.

CLI:

```bash
hebrew-legal-term-translator explain-text "הלקוח דורש ערבות אישית ושעבוד לטובת חברה בע״מ" --json
```
