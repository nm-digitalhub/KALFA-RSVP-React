# Source and Interface Reference

## Local interface model

This package does not call a live external API. It provides a local typed client and CLI. Treat the following request and response shapes as the stable interface for scripts, tests, and review workflows.

### Lookup request

```json
{
  "query": "חשבונית מס",
  "language": "en",
  "context": "business",
  "environment": "sandbox"
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | yes | Hebrew term, English term, alias, or term key. |
| `language` | string | no | `en` or `he`; default is `en`. |
| `context` | string | no | `business`, `consumer`, `freelancer`, `employment`, `privacy`, `debt`, `procedure`, `tax`, or `contracts`. |
| `environment` | string | no | `sandbox` or `production`; used only as a local label. |

### Lookup response

```json
{
  "request_id": "hlt-030550",
  "query": "חשבונית מס",
  "language": "en",
  "matched_key": "cheshbonit_mas",
  "matched_hebrew": "חשבונית מס",
  "english": "VAT tax invoice",
  "plain_english": "A document issued by a VAT-registered business that records a taxable supply and supports input VAT deduction when the legal conditions are met.",
  "plain_hebrew": "מסמך שמוציא עוסק מורשה או חברה עבור עסקה חייבת במע״מ, ומשמש בסיס לניכוי מס תשומות כאשר מתקיימים התנאים בדין.",
  "area": "tax",
  "risk_level": "medium",
  "confidence": 1.0,
  "citations": [
    {
      "name_he": "חוק מס ערך מוסף, תשלו-1975",
      "name_en": "Value Added Tax Law, 1975",
      "citation": "חוק מס ערך מוסף, תשלו-1975",
      "url": "https://main.knesset.gov.il/activity/legislation/laws/pages/lawhome.aspx",
      "source_type": "official",
      "verification_note": "Verify the current consolidated Hebrew source before relying on it."
    }
  ],
  "next_questions": [
    "VAT registration status",
    "invoice number",
    "date",
    "supplier identity",
    "VAT amount"
  ],
  "warnings": [
    "This is legal information, not legal advice. Verify the current Israeli source text before relying on the result."
  ],
  "suggestions": []
}
```

### Search request

```json
{
  "query": "online refund",
  "area": "consumer",
  "limit": 5
}
```

### Search response

```json
[
  {
    "key": "iska_meker_rachok",
    "hebrew": "עסקת מכר מרחוק",
    "english": "distance sale transaction",
    "area": "consumer",
    "risk_level": "medium",
    "confidence": 0.45
  }
]
```

### Text-detection request

```json
{
  "text": "החוזה כולל פיצוי מוסכם והפרה יסודית",
  "max_terms": 10,
  "language": "en"
}
```

### Error table

| Condition | Method | Error | Correction |
| --- | --- | --- | --- |
| Empty query | `explain`, `explain_payload` | `ValueError: query must not be empty` | Provide a non-empty term or clause. |
| Unsupported language | `explain`, async variants | `ValueError: language must be en or he` | Use `en` or `he`. |
| Invalid result limit | `search` | `ValueError: limit must be at least 1` | Use a positive integer. |
| Invalid text limit | `explain_text` | `ValueError: max_terms must be at least 1` | Use a positive integer. |
| Invalid payload | `explain_payload` | `ValueError` with field details | Run `validate_payload` before execution. |
| No glossary match | `explain` | Structured response with `matched_key: null` | Provide more context or search by area. |

## Israeli source catalog

Use the catalog as a verification index. Confirm the current Hebrew text before relying on any legal position, threshold, form, deadline, or enforcement step.

| Key | Source | Use | URL |
| --- | --- | --- | --- |
| `legislation` | National Legislation Database | Consolidated Israeli statutes and amendments | `https://m.knesset.gov.il/activity/legislation/laws/pages/lawhome.aspx` |
| `reshumot` | Official Gazette | Official notices, regulations, and updates | `https://www.gov.il/he/departments/official_publications` |
| `tax` | Israel Tax Authority | VAT, income tax, withholding, forms, and guidance | `https://www.gov.il/he/departments/topics/value_added_tax/govil-landing-page` |
| `consumer_authority` | Consumer Protection and Fair Trade Authority | Consumer cancellation, disclosure, enforcement, and guidance | `https://www.gov.il/he/pages/returns` |
| `privacy_authority` | Privacy Protection Authority | Privacy, databases, security, and regulatory guidance | `https://www.gov.il/he/pages/privacy-protection-nice-to-meet-you` |
| `courts` | Israel Courts Authority | Court forms, filing guidance, small claims, and procedure | `https://www.gov.il/he/service/filing_a_small_claim` |
| `enforcement` | Enforcement and Collection Authority | Enforcement files, warnings, debt collection, and payment arrangements | `https://www.gov.il/he/pages/execution_debtors_guide` |


## Web-validated current values as of 03/06/2026

These values are included for verification discipline, not as permanent hard-coded rules. Re-check the live source before applying a rate, threshold, fee, or deadline in production.

| Topic | Current value checked | Primary official source | Cross-check source | Status |
| --- | --- | --- | --- | --- |
| Standard VAT rate | 18% from 01/01/2025; no later official change found in the second pass. | Israel Tax Authority VAT history and interpretation notice | 2026 Knesset research/current tax materials | Double-confirmed |
| VAT-exempt dealer turnover ceiling | ₪122,833 for 2026. | Tax Authority small-business FAQ | Tax Authority online exempt-dealer opening service | Double-confirmed |
| General minimum wage | ₪6,443.85 monthly and ₪34.64 hourly from 01/04/2026 for the cited National Insurance calculation. | National Insurance minimum wage table | National Insurance employer contribution page | Double-confirmed |
| Consumer cancellation fee reference | Up to 5% of the transaction or ₪100, whichever is lower, subject to statutory exceptions. | Consumer Protection Authority cancellation page | Consumer Protection Authority emergency consumer guide | Double-confirmed |
| Small-claims filing fee | 1% of the claim amount, minimum ₪50. | Israel Courts small-claim filing service | Israel Courts small-claims topic page | Double-confirmed |
| Small-claims defense timing | Statement of defense within 30 days from receipt of the claim, according to the courts service page. | Israel Courts statement-of-defense service | Israel Courts small-claims topic page | Double-confirmed |
| Privacy database notice trigger | Certain databases require notice to the Privacy Protection Authority within 30 days after the condition is met. | Privacy Protection Authority notice-obligation service | Privacy Protection Authority 2026 explanatory materials | Double-confirmed |
| Webhooks | No webhook event names apply. This package is local and does not call a live external service. | Local interface definition | Re-checked source catalog and scripts | Double-confirmed |
| External API hosts | The package does not call external APIs. Knesset OData exists as public parliamentary data but is not used by this package. | Knesset OData service listing | National Legislation Database pages mentioning OData | Double-confirmed |

## Regulations and statutes cited by the glossary

| Area | Hebrew source | Practical relevance |
| --- | --- | --- |
| Tax | חוק מס ערך מוסף, תשלו-1975 | VAT invoices, VAT status, input tax, exempt and authorized dealers. |
| Tax | פקודת מס הכנסה [נוסח חדש] | Withholding tax, advance payments, income tax obligations. |
| Consumer | חוק הגנת הצרכן, תשמא-1981 | Transaction cancellation, distance sales, disclosure duties. |
| Contracts | חוק החוזים (חלק כללי), תשלג-1973 | Formation, validity, good faith, general contract terms. |
| Contracts | חוק החוזים (תרופות בשל הפרת חוזה), תשלא-1970 | Breach, cancellation, agreed compensation, remedies. |
| Contracts | חוק החוזים האחידים, תשמג-1982 | Unfair standard terms and template contract review. |
| Employment | חוק שכר מינימום, תשמז-1987 | Minimum wage checks and outdated-rate risk. |
| Employment | חוק שעות עבודה ומנוחה, תשיא-1951 | Overtime and working-time review. |
| Employment | חוק חופשה שנתית, תשיא-1951 | Annual leave accrual and redemption. |
| Employment | חוק פיצויי פיטורים, תשכג-1963 | Severance review and termination risk. |
| Privacy | חוק הגנת הפרטיות, תשמא-1981 | Database, consent, notices, and privacy controls. |
| Civil | חוק איסור לשון הרע, תשכה-1965 | Reviews, public statements, reputation risk. |
| Companies | חוק החברות, תשנט-1999 | Limited companies, signatory authority, shareholder liability. |
| Finance | חוק הערבות, תשכז-1967 | Personal guarantee review. |
| Finance | חוק המשכון, תשכז-1967 | Security interests, pledges, and release checks. |

## CLI request examples

```bash
hebrew-legal-term-translator lookup "עוסק פטור" --json --env sandbox
hebrew-legal-term-translator search "withholding certificate" --area tax --json
hebrew-legal-term-translator explain-text "כתב ההגנה הוגש אחרי ההתראה לפני נקיטת הליכים" --json
```

## Python request examples

```python
from hebrew_legal_term_translator import HebrewLegalTermTranslator

translator = HebrewLegalTermTranslator()
payload = {"query": "ערבות אישית", "language": "en", "context": "business"}
validation = translator.validate_payload(payload)
if validation["valid"]:
    result = translator.explain_payload(payload)
    print(result.to_json())
```

## Non-API production notes

- Store response JSON with the original document and date.
- Record verification date in DD/MM/YYYY format.
- Use environment labels for internal separation only.
- Do not treat the local glossary as a substitute for current law.
