# Customer vocabulary: draft for the owner's review (task 5.1)

Drafted 29.10.2026 with the `hebrew-content-writer` skill (UX register: short, direct, plural imperative as the app already uses, e.g. "נסו שוב"). The replacement vocabulary is design D8's: "אישורי הגעה" for the service as the customer knows it, "השירות" where a noun for the purchased service reads better, and "החבילה" where the sentence is about what was bought. Task 5.2 applies this list after the owner's review; nothing below is applied yet.

Second pass, 30.10.2026, with the same skill. One rule now runs through the list. "אישורי הגעה" names the service in titles, headings and buttons. In a sentence about the service's state or an error, the subject is "השירות", because "אישורי ההגעה" also means the guests' answers: "אישורי ההגעה לא נמצאו" reads as missing answers, not a missing service. The step label and the guests-page badge keep D8's "אישורי ההגעה פעילים". The lines changed by this pass are marked (pass 2). The rest checked clean: construct forms, agreement, full spelling, and gender-neutral plural imperatives as elsewhere in the app.

Third pass, 30.10.2026, with the same skill: four lines broke the pass-2 rule and are now marked (pass 3). Three are sentences about the service's state, so their subject is "השירות": the paused hint under the step label "אישורי ההגעה פעילים" (which would otherwise echo the label it qualifies), the empty-state heading of the results page, and the small "מצב …" label next to the stage badge, where "מצב אישורי ההגעה: פעיל" reads as the status of the guests' answers. The fourth is word order: the adverb "תחילה" moves before the object. The line numbers of the touched lines were checked against the code on 30.10; the rest date from 29.10, and 5.2 matches by text, not by line.

The inventory comes from a scan of `src/app/(customer)/**` (comments stripped) and of the shared label maps and server errors that reach the owner. Each line reads: where, current text → proposed text.

## 1. Step and stage labels (shared maps)

- `setup-steps.ts:53` `SETUP_STEP_LABELS.live`: "הקמפיין פעיל" → "אישורי ההגעה פעילים" (D8).
- `setup-steps.ts:170` paused hint, shown under the step label: "הקמפיין מושהה" → "השירות מושהה" (pass 3).
- `event-labels.ts` `CAMPAIGN_STAGE_LABELS`: none of its values contains the word. One value contradicts D4: `awaiting_activation` "ממתין להפעלה" (the customer never sees an activation). Proposed: a customer map, `CUSTOMER_STAGE_LABELS`, identical except `awaiting_activation` → "השירות מופעל". That matches `SERVICE_STARTING` ("השירות מופעל. הפניות לאורחים יישלחו לפי לוח הזמנים."). It is what the event page shows after a paid purchase whose start is still pending (task 3.7). The staff map stays.

## 2. Page titles, headings and buttons

- `events/[id]/page.tsx:439` management card heading: "הקמפיין" → "אישורי הגעה".
- `events/[id]/page.tsx:446` button: "ניהול הקמפיין" → "אישורי הגעה ותוצאות" (D8).
- `campaign/[campaignId]/page.tsx:42` `metadata.title` and `:177` `h1`: "ניהול קמפיין" → "אישורי הגעה ותוצאות".
- `stats/page.tsx:200` section title: "קמפיין יצירת הקשר" → "אישורי הגעה".
- `guests/add-guests-onboarding.tsx:112` badge: "הקמפיין פעיל" → "אישורי ההגעה פעילים".
- `approve/agreement-sheet.tsx:28` sheet title: "הסכם אישור קמפיין ושירות" → "תנאי החבילה המלאים". The sheet's title only; the agreement text inside it is a non-goal.
- `manage-client.tsx:283` status card label, next to the stage badge: "מצב הקמפיין" → "מצב השירות" (pass 3).
- `manage-client.tsx:310`, `:947`, `:954` "ביצועי הקמפיין" → "תוצאות אישורי ההגעה".

## 3. Notices on customer screens

- `manage-client.tsx:886`: "מועד האירוע חלף ולכן לא ניתן להפעיל את הקמפיין. מנהל המערכת עדיין יכול לסגור אותו." → "מועד האירוע חלף, ולכן לא יישלחו פניות לאורחים. צוות התמיכה יכול לסגור את השירות." (pass 2: "לא יופעלו" was an activation word, which D4 keeps from the customer, and "לסגור אותם" pointed at the guests' answers.)
- `manage-client.tsx:905` empty-state heading: "הקמפיין מוכן, אבל עדיין אין בו מוזמנים" → "השירות מוכן, אבל עדיין אין מוזמנים" (pass 3).
- `manage-client.tsx:925-926`: "… אנשי קשר ברשימה אינם כלולים בקמפיין משום שמכסת הקמפיין, הכוללת …" → "… אנשי קשר ברשימה אינם כלולים בפניות, משום שמכסת החבילה, הכוללת …". This area is replaced later by the per-guest status of `package-outreach-admission-safety`.
- `manage-client.tsx:959`: "נתוני המסירה והתוצאות יוצגו כאן ברגע שהקמפיין יתחיל לפעול." → "נתוני המסירה והתוצאות יוצגו כאן ברגע שהפניות לאורחים יתחילו."
- `payment/package-payment-view.tsx:70`: "הקמפיין פעיל. הפניות לאורחים יישלחו לפי לוח הזמנים." → "השירות פעיל. הפניות לאורחים יישלחו לפי לוח הזמנים." The page can no longer reach this screen (task 3.3); the text is changed anyway, since the component still renders it.
- `events/[id]/page.tsx:205` (closed event): "… עם השלמת גמר החשבון של הקמפיין …" → "… עם השלמת גמר החשבון של השירות …".
- `event-summary.tsx:194`: "… ויעודכן לאחר סגירת הקמפיין." → "… ויעודכן לאחר סגירת השירות."
- `event-summary.tsx:252`: "לא ניתן לטעון את נתוני הקמפיין כרגע." → "לא ניתן לטעון כרגע את נתוני השירות." (pass 2: a shorter construct chain, and the subject rule.)
- The phrase "כל עוד קיים קמפיין אישורי הגעה בתהליך" → "כל עוד שירות אישורי ההגעה בתהליך", in:
  - `edit-event-form.tsx:197`, `:293`;
  - `celebrant-fields.tsx:45`;
  - the three `updateEvent` errors in `events.ts:350-354`.

  "בתהליך" stays: the lock covers a service in setup as well as a running one.

## 4. Server messages that reach the owner

- `campaign-actions.ts:267`, `:304`, `:343` (owner reminder actions): "הקמפיין לא נמצא." → "השירות לא נמצא." (pass 2)
- `campaign-actions.ts:279`, `:316`, `:354`: "… שהקמפיין פעיל …" → "… שהשירות פעיל …" (pass 2). For example, `:354` becomes "לא נשלחו הודעות תודה — ודאו שהשירות פעיל ושתבנית התודה מאושרת ופעילה."
- `approve/page.tsx:40` and `agreements.ts:156`, `:193`: "הקמפיין אינו ממתין לאישור …" / "ניתן לאשר רק קמפיין הממתין לאישור" → "אין כרגע תנאים שממתינים לאישור."
- `agreements.ts:159`, `:190`, `:192` "תנאי הקמפיין חסרים" → "תנאי החבילה חסרים"; `agreements.ts:150` "טעינת הקמפיין נכשלה" → "טעינת תנאי החבילה נכשלה".
- `campaigns.ts:158` (`createCampaign`, the package choice): "יצירת הקמפיין נכשלה" → "בחירת החבילה נכשלה".
- `campaigns.ts:195`: "אין קמפיין לאירוע — יש לבחור חבילה תחילה" → "יש לבחור תחילה חבילה לאירוע." (pass 2: the first draft said "חבילה" twice; pass 3: "תחילה" before the object.)
- `campaigns.ts:263` "לקמפיין אין חבילה" → "לא נבחרה חבילה"; `campaigns.ts:534` "בדיקת הבעלות על הקמפיין נכשלה" → "בדיקת הבעלות על האירוע נכשלה".
- `campaigns.ts:254`, `:281`, `:329`, `:345`, `:369`, `:584` (owner reads) "טעינת הקמפיין נכשלה" → "טעינת נתוני השירות נכשלה" (pass 2).
- `package-purchase-errors.ts:33` `bad_state`: "לא ניתן לרכוש חבילה במצב הנוכחי של הקמפיין." → "לא ניתן לרכוש את החבילה במצב הנוכחי."
- `package-purchase-errors.ts:34` `purchase_in_progress`: "תשלום כבר מתבצע עבור הקמפיין הזה. …" → "תשלום כבר מתבצע עבור החבילה. …" (the rest unchanged).
- The activation path has no customer-facing message that contains the word:
  - `startPaidPackageNow` never throws to the customer;
  - the job's and `activate-paid-package.ts`'s errors go to logs and to staff;
  - `PACKAGE_NOT_PAID_ERROR` and `PACKAGE_PAYMENT_UNVERIFIED_ERROR` already avoid it.

## 5. Kept as they are: staff only

These go into the scan's allowlist (task 5.3), each with its reason.

- `manage-client.tsx` "פעולות מנהל" block (`showAdminSection`, rendered only with `viewerIsAdmin`): `:766`, `:770`, `:775`, `:777`, the cancel control, and the reschedule confirmation `:612` (`canReschedule = viewerIsAdmin && …`).
- `campaign-actions.ts:229`, `:232`, `:245`, `:248`, `:413`, `:417`, `:499`: results of pause, close, cancel and reschedule. Those actions are staff-only.
- `campaigns.ts:665`, `:667` (`cancelCampaign`, platform-admin only) and the Slack alert titles (`campaigns.ts:429`, `:689`, `campaign-transition.ts:229`): staff surfaces. Slack is excluded by the proposal's non-goals.
- `campaign-transition.ts` and `activate-paid-package.ts` errors: staff revival and the system start. Since D23 the customer never starts a service.
- URL paths (`/campaign/…`) and identifiers: not text (non-goal).
