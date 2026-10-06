# מפת כל נקודות הקצה של SUMIT לפי נושאים

נבנתה ב-5.10.2026 מ-`openapi/sumit.openapi.json` (זהה ל-`swagger.json`; OpenAPI 3.1.1, SUMIT API - Full, v1). שימוש בקוד נקבע בסריקת מחרוזות בקבצי TypeScript/JavaScript, והערות לא נספרות.
פירוט ה-CRM: [sumit-crm-endpoints-map-2026-10-05.md](sumit-crm-endpoints-map-2026-10-05.md).

## סיכום

- **84 נקודות קצה** בחוזה, כולן `POST`.
- **בשימוש בקוד אפליקציה: 10**; רק בסקריפטים או בטסטים: 4; ללא שימוש: 70.

| נושא | נקודות | באפליקציה | סקריפט/טסט בלבד | ללא שימוש |
|---|---|---|---|---|
| הנהלת חשבונות ומסמכים | 22 | 2 | 1 | 19 |
| פריטים ומלאי | 3 | 0 | 0 | 3 |
| סליקה ותשלומים | 25 | 2 | 1 | 22 |
| CRM ואוטומציה | 17 | 5 | 2 | 10 |
| הודעות ותקשורת | 8 | 0 | 0 | 8 |
| ניהול חשבון ואתר | 9 | 1 | 0 | 8 |

## הנהלת חשבונות ומסמכים

### Accounting (Customers)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/accounting/customers/create/` | Create customer or find existing customer according to SearchMode | **אפליקציה:** `accounting.ts`; סקריפט: `sumit-customer-search-probe.ts` |
| `/accounting/customers/createremark/` | Create remark to an existing customer | — |
| `/accounting/customers/getdetailsurl/` | Gets customer details page | — |
| `/accounting/customers/update/` | Update customer or find existing customer according to SearchMode | — |

### Accounting (Documents)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/accounting/documents/addexpense/` | Add expense | — |
| `/accounting/documents/cancel/` | Cancel existing document | — |
| `/accounting/documents/create/` | Create document | **אפליקציה:** `accounting.ts` |
| `/accounting/documents/getdebt/` | Get customer debt | — |
| `/accounting/documents/getdebtreport/` | Get customers debt report | — |
| `/accounting/documents/getdetails/` | Get document details | סקריפט: `sumit-doc-getdetails.ts` |
| `/accounting/documents/getpdf/` | Get document PDF | — |
| `/accounting/documents/list/` | List documents | — |
| `/accounting/documents/movetobooks/` | Move document to books (Finalize a draft document). | — |
| `/accounting/documents/send/` | Send document by email | — |

### Accounting (General)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/accounting/general/getexchangerate/` | Get foreign currency exchange rate | — |
| `/accounting/general/getnextdocumentnumber/` | Gets the next document number of a document type. | — |
| `/accounting/general/getvatrate/` | Get VAT rate by date | — |
| `/accounting/general/setnextdocumentnumber/` | Sets the next document number for a document type. | — |
| `/accounting/general/updatesettings/` | Update accounting application settings | — |
| `/accounting/general/verifybankaccount/` | Verify bank account details | — |

### הנהלת חשבונות (Transactions)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/books/transactions/createbatch/` | Creates a batch with transactions | — |

### Scheduled documents (Documents)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/scheduleddocuments/documents/createfromdocument/` | ScheduledDocumentsDocumentsCreateFromDocument | — |

## פריטים ומלאי

### Accounting (IncomeItems)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/accounting/incomeitems/create/` | Create income item | — |
| `/accounting/incomeitems/list/` | List income items | — |

### Stock management (Stock)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/stock/stock/list/` | StockStockList | — |

## סליקה ותשלומים

### Credit card terminal (Billing)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/creditguy/billing/getstatus/` | Get billing process status | — |
| `/creditguy/billing/load/` | Load billing transactions | — |
| `/creditguy/billing/process/` | Process loaded billing transactions. | — |

### Credit card terminal (Gateway)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/creditguy/gateway/beginredirect/` | Begin redirect for transaction | — |
| `/creditguy/gateway/getreferencenumbers/` | Get reference numbers for existing transactions | — |
| `/creditguy/gateway/gettransaction/` | Get existing transaction details | — |
| `/creditguy/gateway/transaction/` | Credit card transaction | — |

### Credit card terminal (Vault)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/creditguy/vault/tokenize/` | Tokenize card (card number->token) | — |
| `/creditguy/vault/tokenizesingleuse/` | Tokenize payment details (Card Number, Expiration, CVV, CitizenID) for single us | — |
| `/creditguy/vault/tokenizesingleusejson/` | Tokenize payment details (Card Number, Expiration, CVV, CitizenID) for single us | — |

### Payments (GeneralBilling)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/billing/generalbilling/openupayterminal/` | Open an instant credit card terminal using Upay. | — |
| `/billing/generalbilling/setupaycredentials/` | Setup existing Upay account credentials | — |

### Payments (PaymentMethods)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/billing/paymentmethods/getforcustomer/` | Get payment details | — |
| `/billing/paymentmethods/remove/` | Remove payment details from existing customer | — |
| `/billing/paymentmethods/setforcustomer/` | Set payment details | — |

### Payments (Payments)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/billing/payments/beginredirect/` | Begin redirect for transaction | — |
| `/billing/payments/charge/` | Charge customer | **אפליקציה:** `authorize.ts`, `capture.ts`, `charge.ts`, `raw-charge.ts`; סקריפט: `sumit-probe-endpoints.ts`; טסט: `charge.test.ts` |
| `/billing/payments/get/` | Get payment details | סקריפט: `sumit-payment-get.ts`, `sumit-probe-endpoints.ts` |
| `/billing/payments/list/` | List payments | **אפליקציה:** `probe.ts`; טסט: `probe.test.ts` |
| `/billing/payments/multivendorcharge/` | Charge customer | — |

### Payments (Recurring)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/billing/recurring/cancel/` | Cancel customer item | — |
| `/billing/recurring/charge/` | Charge customer and create recurring payment | — |
| `/billing/recurring/listforcustomer/` | List customer recurring items | — |
| `/billing/recurring/update/` | Update customer recurring item | — |
| `/billing/recurring/updatesettings/` | Update recurring billing application settings | — |

## CRM ואוטומציה

### CRM (Data)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/crm/data/archiveentity/` | Archive entity | — |
| `/crm/data/countentityusage/` | Count entity usage | — |
| `/crm/data/createentity/` | Create entity | — |
| `/crm/data/deleteentity/` | Delete entity | — |
| `/crm/data/getentitieshtml/` | Get entities HTML contents for print | — |
| `/crm/data/getentity/` | Get entity | סקריפט: `sumit-crm-probe.ts` |
| `/crm/data/getentityprinthtml/` | Get entity HTML contents for print | — |
| `/crm/data/listentities/` | List entities | **אפליקציה:** `crm-holds.ts`; סקריפט: `sumit-crm-list-customers.ts`, `sumit-crm-list-holds.ts` |
| `/crm/data/updateentity/` | Update entity | — |

### CRM (Schema)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/crm/schema/getfolder/` | Get folder details | סקריפט: `sumit-crm-probe.ts` |
| `/crm/schema/listfolders/` | List folders | **אפליקציה:** `crm-triggers.ts`; סקריפט: `sumit-crm-list-folders.ts`, `sumit-probe-endpoints.ts`; טסט: `crm-triggers.test.ts` |

### CRM (Views)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/crm/views/listviews/` | List views | **אפליקציה:** `crm-triggers.ts` |

### Triggers (Triggers)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/triggers/triggers/subscribe/` | Creates a trigger. This is usually done by make.com/zapier, but can also be used | **אפליקציה:** `crm-triggers.ts` |
| `/triggers/triggers/unsubscribe/` | Removes trigger. This is usually done by make.com/zapier, but can also be used d | **אפליקציה:** `crm-triggers.ts`; טסט: `crm-triggers.test.ts` |

### Deals (Deals)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/deals/adddeal/` | Creates a new deal, and potentially a new customer | — |
| `/deals/createremark/` | Create remark to a deal | — |

### Customer service (Tickets)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/customerservice/tickets/create/` | CustomerServiceTicketsCreate | — |

## הודעות ותקשורת

### Email subscriptions (MailingLists)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/emailsubscriptions/mailinglists/add/` | EmailSubscriptionsMailingListsAdd | — |
| `/emailsubscriptions/mailinglists/list/` | EmailSubscriptionsMailingListsList | — |

### SMS subscriptions (MailingLists)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/sms/mailinglists/add/` | SMSMailingListsAdd | — |
| `/sms/mailinglists/list/` | SMSMailingListsList | — |

### SMS subscriptions (SMS)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/sms/sms/listsenders/` | SMSSMSListSenders | — |
| `/sms/sms/send/` | SMSSMSSend | — |
| `/sms/sms/sendmultiple/` | SMSSMSSendMultiple | — |

### Outgoing faxes (Fax)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/fax/fax/send/` | FaxFaxSend | — |

## ניהול חשבון ואתר

### Website (Companies)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/website/companies/create/` | Create new organization | — |
| `/website/companies/getdetails/` | WebsiteCompaniesGetDetails | **אפליקציה:** `health.ts` |
| `/website/companies/installapplications/` | Install applications
Please note this method requires an active payment method. | — |
| `/website/companies/listquotas/` | WebsiteCompaniesListQuotas | — |
| `/website/companies/update/` | Update organization details | — |

### Website (Permissions)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/website/permissions/remove/` | Remove user permission | — |
| `/website/permissions/set/` | Grant user permission | — |

### Website (Users)

| נקודה | תיאור | שימוש בקוד |
|---|---|---|
| `/website/users/create/` | Create user and grant permissions to the current organization | — |
| `/website/users/loginredirect/` | Login using redirect, without exposing the user credentials.
Please note, this d | — |

## הנקודות שהאפליקציה קוראת בפועל

- `/accounting/customers/create/` (הנהלת חשבונות ומסמכים) — **אפליקציה:** `accounting.ts`; סקריפט: `sumit-customer-search-probe.ts`
- `/accounting/documents/create/` (הנהלת חשבונות ומסמכים) — **אפליקציה:** `accounting.ts`
- `/billing/payments/charge/` (סליקה ותשלומים) — **אפליקציה:** `authorize.ts`, `capture.ts`, `charge.ts`, `raw-charge.ts`; סקריפט: `sumit-probe-endpoints.ts`; טסט: `charge.test.ts`
- `/billing/payments/list/` (סליקה ותשלומים) — **אפליקציה:** `probe.ts`; טסט: `probe.test.ts`
- `/crm/data/listentities/` (CRM ואוטומציה) — **אפליקציה:** `crm-holds.ts`; סקריפט: `sumit-crm-list-customers.ts`, `sumit-crm-list-holds.ts`
- `/crm/schema/listfolders/` (CRM ואוטומציה) — **אפליקציה:** `crm-triggers.ts`; סקריפט: `sumit-crm-list-folders.ts`, `sumit-probe-endpoints.ts`; טסט: `crm-triggers.test.ts`
- `/crm/views/listviews/` (CRM ואוטומציה) — **אפליקציה:** `crm-triggers.ts`
- `/triggers/triggers/subscribe/` (CRM ואוטומציה) — **אפליקציה:** `crm-triggers.ts`
- `/triggers/triggers/unsubscribe/` (CRM ואוטומציה) — **אפליקציה:** `crm-triggers.ts`; טסט: `crm-triggers.test.ts`
- `/website/companies/getdetails/` (ניהול חשבון ואתר) — **אפליקציה:** `health.ts`

## נתיבים שנבדקו כמועמדים ואינם בחוזה

הסקריפט `scripts/sumit-probe-endpoints.ts` בדק, בין השאר, נתיבים שאינם מופיעים ב-84 נתיבי החוזה (דוחות, מלאי נרחב, עובדים, ייצוא, קבצים, הוצאות, `/triggers/triggers/list/`, `/triggers/triggers/history/`, `/webhooks/webhooks/list/`, `/billing/payments/void|update|delete|refund`). הם נבדקו כמועמדים בלבד, ולא נבנה עליהם דבר.

## איך לחדש

סריקת השימוש נעשתה בסקריפט חד-פעמי שמנתח מחרוזות עם מהדר TypeScript. חיפוש טקסט פשוט היה מתאים גם להערות ולתיעוד.

**בדיקה חיה של 8 פעולות הצפייה:** [sumit-readonly-live-check-2026-10-05.md](sumit-readonly-live-check-2026-10-05.md).
