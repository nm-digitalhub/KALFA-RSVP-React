# סקר: מה קיים ומה נדרש כדי למכור חבילה בחיוב מיידי

תאריך: 4.10.2026. סקר עובדות בלבד, בלי החלטות. התוכנית שנגזרת ממנו: `2026-10-04-package-payment-plan.md`.

**סימון המקורות.** `[קוד]` נקרא בקוד בקובץ ובשורה שצוינו. `[DB]` נמדד בבסיס הנתונים החי ב-4.10 (קריאה בלבד). `[מפרט]` נקרא ב-`openapi/sumit.openapi.json`. `[נבדק חי]` רץ מול SUMIT האמיתי ונשמר ב-`sumit_test_transactions`. `[הערה]` נטען בהערה, במסמך או בזיכרון ולא אומת. אין בסקר טענה בלי אחד מהסימונים.

## 1. מה הבעלים החליט (שיחות 30.9 עד 4.10)

1. חבילה לאירוע אחד, מחיר קבוע שידוע לפני החתימה, והלקוח בוחר אותה מקטלוג (הטבלה `packages`) בהקמה.
2. הגודל והמחיר נקבעים רק לפי מספר אנשי הקשר. ערוצי הפנייה (הודעות ושיחות) כלולים במחיר.
3. המכסה סופרת אנשי קשר שפונים אליהם, בין אם ענו ובין אם לא. הודעת תודה, "חזרו אליי" ותזכורות למי שכבר בפנים לא נספרים.
4. הלקוח יכול להוסיף אורחים מעבר למכסה. הם ממתינים בגלוי, ולא פונים אליהם עד שדרוג. השליחה נעצרת בהגעה למכסה.
5. מי בפנים: לפי סדר ההוספה. הלקוח יכול להחליף אורח ממתין באורח שבפנים כל עוד עוד לא פנינו לאורח שמוצא.
6. שדרוג מגדיל את המכסה ושומר את ההתקדמות.
7. התשלום על החבילה הוא **חיוב**, לא תפיסת מסגרת.
8. הרשימה המורשית (המקומות) מתמלאת בהפעלה, דרך פונקציה אחת. (ההמלצה שלי; הבעלים שאל "מה הכוונה" וקיבל הסבר, ועוד לא אישר במפורש.)

## 2. הזרימה היום, כפי שהיא רצה בקוד

| שלב | פונקציה | מה נכתב |
|---|---|---|
| אישור פרטי האירוע | `setupCampaignAction` → `publishEvent`, `createCampaign` `[קוד: campaign-actions.ts:67, campaigns.ts:192]` | האירוע הופך `active`. נוצר קמפיין `pending_approval` ו**ננעלים בו המחיר והתנאים**, מהחבילה הראשונה בקטלוג (`resolveCanonicalTemplate`, "הבעלים לא בוחר") |
| חתימה | `signAgreementAction` → `approveCampaign` `[קוד: campaigns.ts:394]` | `approved`, `tos_version` |
| אמצעי תשלום | דף `/payment` → `CampaignHoldForm` (payments.js) → `POST /api/campaigns/[id]/authorize` `[קוד: authorize/route.ts]` | `lockCampaignForHold`, `prepareCampaignHold` (**כאן הרשימה המורשית נוצרת בפעם הראשונה**, `snapshotAuthorizedSet`), תפיסת מסגרת J5, `recordCampaignHold`, ואז `activateCampaign` |
| הפעלה | `activateCampaign` `[קוד: campaigns.ts:990]` | דורש `capture_status='authorized'`. הפונקציה היחידה שמפעילה קמפיין (שלוש קריאות לפונקציית המעבר, ורק `cancel_campaign` ב-SQL משנה סטטוס) |
| פניות | worker: `handleArm` מזריע מהרשימה, `dispatchOutreachCall`, `sendCampaignWhatsApp` | `outreach_state`, `contact_interactions`, `billed_results` |
| גמר חשבון | `settleCampaignAction` → `closeCampaignAndCharge` `[קוד: close-charge.ts:130]` | **ידני**, בהרשאת `manage_billing`. `base + max(0, reached − included) × overage − credits`, חיוב חדש על הטוקן השמור, קבלה, סגירת האירוע (`closeEventAfterSettlement`), ושליחת אירוע GA `purchase` מהדפדפן |

אין שום job אוטומטי שסוגר קמפיין או אירוע אחרי תאריך האירוע `[קוד: src/lib/queue/queues.ts, רשימת התורים]`. הסגירה היום היא פעולה ידנית (בעלים או מנהל) או תוצאה של גמר חשבון.

## 3. מצב חי (4.10)

- **דגלים** `[DB: app_settings]`: `payments_enabled`, `campaign_holds_enabled`, `close_charge_enabled`, `base_overage_pricing_enabled` כולם `true`. הגדרות SUMIT (company id, מפתח פרטי, מפתח ציבורי) קיימות. המערכת **חיה על המודל הישן**.
- **קמפיינים** `[DB]`: שלושה. שניים `closed` (שניהם `nothing_to_charge`, `final_charge_amount=0`, קרדיט הופעל: 84 ו-200), אחד `pending_approval` עם שדות המודל הישן (`base 200`, `included 200`, `ppr 4`).
- **הכנסות אמיתיות דרך המוצר: ₪0.** אף חיוב סופי לא בוצע מעולם על כסף של לקוח.
- **הסכמים** `[DB]`: מסמך אחד, `2026-07-v4` מאושר, בלי גוף מותאם (גוף ברירת המחדל מהקוד). שתי חתימות (v4 ו-`draft-2026-06-v2`). גרסה v5 (תקרה פתוחה) קיימת **בקוד בלבד** `[קוד: template.ts:45]`, לא כמסמך במסד.
- **חבילות** `[DB]`: שורה אחת, `outcome_whatsapp`, `base 200`, `included 200`, `price_per_reached 4`, `price_with_vat 200`, `active`.
- **קרדיטים** `[DB: billing_credits]`: 4 שורות, 2 מבוטלות, יתרה פעילה 284.
- **בקשות ביטול** `[DB]`: אחת, טופלה.
- **לקוחות SUMIT** `[DB: sumit_customers]`: 3. **ניסויים חיים** `[DB: sumit_test_transactions]`: 3 (ראו סעיף 4).
- **יומן תשלומים (`payment_operations`) לא קיים** `[DB: רשימת טבלאות]`. התוכנית של 24.9 עדיין טיוטה.
- **תפיסות מסגרת:** שני הקמפיינים הסגורים מסומנים `release_status='released'` (תפיסות של ₪152 ו-₪200) `[DB]`. הקמפיין של ה-₪4 שנזכר בזיכרון כתקוע כבר אינו קיים בטבלה. הזיכרון על "שתי תפיסות תקועות" מיושן.
- **מספר זהות של בעל הכרטיס בטקסט גלוי** `[DB]`: ב-2 קמפיינים. `anon` ו-`authenticated` מחזיקים הרשאת SELECT ברמת העמודה על `card_citizen_id` ועל `card_token_ref`; RLS מגביל לשורות של מי שיש לו `campaigns:view` על האירוע (בעלים וחברי ארגון) `[DB: has_column_privilege]`.
- **ביטחון קיים:** `campaigns` ללא policy כתיבה ללקוח, ולכן עמודת המכסה שהוספנו אינה ניתנת לשינוי על ידי הבעלים `[DB: pg_policies]`.

## 4. SUMIT: מה אומת חי ומה לא

| יכולת | מצב | מקור |
|---|---|---|
| תפיסת J5 עם טוקן חד-פעמי, החזרת טוקן קבוע, תוקף, ת"ז ו-`CustomerID` | נבדק חי | `sumit_test_transactions` (hold, 29.9) |
| חיוב J4 על ה-J5 לפי `CreditCardAuthNumber` | נבדק חי (₪1 מלא). חיוב שני על אותה תפיסה: סירוב 004 | שורות capture, 29.9 |
| חיוב חדש על טוקן שמור עם תוקף ות"ז, בלי `VATRate` | נבדק חי (חיוב ₪4 ו-₪1 חלקי, 29.6) | `[הערה]` בקוד ובזיכרון, לא ב-`sumit_test_transactions` |
| **חיוב J4 ישיר עם `SingleUseToken` ללא תפיסה, והאם התשובה מחזירה טוקן קבוע, ת"ז ו-`CustomerID`** | **לא נבדק** | אין שורה כזאת בטבלת הניסויים |
| חיוב על `Customer.ID` בלי `PaymentMethod` ("כרטיס הלקוח") | **לא נבדק** כיום. ב-26.6 נדחה, אז בלי `Customer.ID` | `[הערה]` בזיכרון |
| `CardTokenNotNeeded` | לפי המפרט החי (נשלף 4.10): "Avoids generating credit card token and saving it on the customer payment method. Defaults to False". כלומר הטוקן הקבוע נוצר ונשמר **כברירת מחדל**, ו-`true` מונע אותו. לא נבדק חי בחיוב J4 | `[מפרט]` |
| קבלה עם שורות מפורטות, ושורה שלילית אחת (קרדיט) | **לא נבדק חי** | `[הערה]` ב-`capture.ts` |
| **זיכוי (`SupportCredit` + סכום שלילי)** | **לא נבדק חי.** הפונקציה מסומנת UNTESTED, ואינה שולחת `Customer.ID` | `[קוד: capture.ts:291-305]` |
| מסמך המופק בחשבון: "חשבון/קבלה" של עוסק פטור, ללא שורת מע"מ | נבדק (₪1, מסמך 40106) | `[הערה: tax-catalog-israel.md §9]` |
| שחרור J5 בקוד | **אין API לשחרור**; רק בלוח הבקרה | `[הערה]` |
| קריאת מצב J5 | דרך CRM, תיקיית `1076735289` | `[הערה]` |

**מה קיים במפרט ולא בשימוש** `[מפרט]`: `/billing/payments/beginredirect/` (עמוד תשלום מתארח), `/billing/payments/get/`, `/billing/payments/list/`, `/billing/paymentmethods/*`, `/accounting/documents/cancel/`. אין חיפוש תשלום לפי `ExternalIdentifier` `[הערה: VERIFY-4]`.

**שדות בבקשת החיוב שרלוונטיים לחבילה** `[מפרט: PaymentsController_Payments_Charge_Request]`: `SingleUseToken`, `Customer` (`ID`, `Name`, `EmailAddress`, `ExternalIdentifier`), `Items`, `AutoCapture` (ברירת מחדל: חיוב), `CardTokenNotNeeded`, `SendDocumentByEmail`, `DocumentDescription`, `PreventDocumentCreation`, `SupportCredit`, `Payments_Count` (תשלומים), `MerchantNumber`.

**פענוח התשובה משוכפל**: שלושה עותקים כמעט זהים (`authorize.ts`, `captureHeldCardSumit`, `creditHeldCardSumit`) ופענוח רביעי וחלש ב-`charge.ts` (בודק רק `IsError`, ושולח `VATIncluded:true` עם `VATRate` שהקורא מעביר, 18 בנתיב ההזמנות הישן, בניגוד להחלטת הבעלים מ-2.9 `[קוד: charge.ts:67-87]`). אין `AbortSignal.timeout` באף אחד מהם `[הערה: VERIFY-4]`.

## 5. משפט ומס: אילוצים על התכנון (לא ייעוץ משפטי, מסומנים לפי המקור)

- **ביטול עסקה מרחוק** `[הערה: legal-catalog-israel.md §6, נוסח 14ג/14ה נשלף 21.8]`: דמי ביטול עד 5% או ₪100, הנמוך; אסורים בביטול עקב פגם או הפרה; החזר תוך 14 יום; סיווג העסקה (מתמשכת או חד-פעמית) **אינו מוכרע** ושלוש הערכות סותרות מופיעות בקטלוג. בעסקה שאינה מתמשכת אין עוגן חוקי לחיוב חלקי, והזכות לבטל פוקעת יומיים לפני תחילת השירות. שאלת היועץ המשפטי הפתוחה, ולא החלטה.
- **היסק שלי, לא מאומת:** אם "תחילת מתן השירות" מוגדרת כשליחה הראשונה לאורחים (אותו אירוע שנועל תאריך ושעה, `contact_interactions.direction='out'`), יש לחבילה חלון ביטול טבעי: עד השליחה הראשונה. זו שאלה לעו"ד, לא החלטה.
- **מס** `[הערה: tax-catalog-israel.md]`: עוסק פטור, תקרה 122,833 ₪ ב-2026; בסיס מזומן, מועד ההכנסה הוא מועד החיוב המאושר; קבלה מיידית על כל תקבול; חשבונית מס אסורה. תשלום מראש מקדים את ההכנסה ומקרב את התקרה. הניטור `tax-ceiling.ts` מסכם `campaigns.final_charge_amount` לפי `charge_status='charged'`, ולכן **לא יראה תשלום חבילה** `[קוד: tax-ceiling.ts:30-35]`.
- **נוסח ההסכם** מציין "KALFA אינה שומרת את פרטי הכרטיס" `[קוד: template.ts:268,299,349]`, בעוד הקוד שומר טוקן, תוקף ות"ז של בעל הכרטיס.
- **הסכם v5 הבטיח** סכום מצטבר גלוי ללקוח ושרק הלקוח מזיז אותו `[קוד: template.ts:316-320]`. במודל החדש ההבטחה הזאת משתנה (מכסה במקום סכום).

## 6. מלאי: מי נוגע במה

**6.1 קוראים וכותבים של מצב התשלום.** המפה המלאה (28 עמודות, 22 קבצי בדיקה, 15 מקומות בקוד, אובייקטי DB) נמצאת ב-`2026-09-24-campaign-payment-domain-split.md` §מפת השפעה (נמדדה 24.9 ואומתה 30.9). הרלוונטיים לחבילה: `campaigns_guard_cancel()` ו-`cancel_campaign()` (קוראים `capture_status` ו-`charge_status`), `test_event_purge_blocker()`, `purge_test_event()`, `owner_agent_billing_sums()`, `tax-ceiling.ts`, `event-stats.ts`, `event-cancellation.ts`, מסך הקמפיין ומסך האדמין, `activateCampaign`.

**6.2 משטחים שמצטטים מחיר.** `buildBusinessFacts()` (`fleet/business-facts.ts`) הוא המקור היחיד לשני מודלים בלבד (`per_reached`, `base_overage`) ומזין: עמוד שאלות נפוצות וטוקני התשובות (`faq/tokens.ts`, `faq/page-model.ts`), עמודי סוגי אירוע (`event-type-page.tsx` דרך `getPublicBusinessFacts`), הסוכן המנסח (`fleet-agent-cli.ts business-facts`). קוראים ישירים מהטבלה, מחוץ ל-`buildBusinessFacts`: כלי `get_pricing` של סוכן המכירות הקולי (`api/voximplant/sls/tool/pricing`), ה-primer של סוכן הבעלים (`owner-agent/consumer/primer.ts`), `event-stats.ts`, `admin/packages/*`.

**6.3 הגדרת "חבילת קמפיין".** `price_per_reached IS NOT NULL` ב: אימות טופס הניהול (`validation/admin.ts:273`), `listCampaignTemplates`, `public-business-facts.ts`, `get_pricing`, ו-`createCampaign`. חבילה במחיר קבוע שאין לה מחיר למענה נופלת מכל המקומות האלה `[קוד]`.

**6.4 טסטים שמקודדים את המודל הישן.** `base-fee-disclosure.test.ts` (חובת גילוי של דמי הפעלה בלתי מותנים), `business-facts.test.ts`, בדיקות `close-charge`, `authorize/route`, `campaign-lifecycle-parity`, `tax-ceiling`, ועוד (רשימה ב-§ג של תוכנית 24.9).

**6.5 הסכם.** `template.ts` בוחר סעיפי מחיר לפי גרסה (`isOpenCeilingAgreementVersion`, `isBaseFeeAgreementVersion`); גוף מותאם מוגדר ב-`/admin/agreement`. מסך החתימה (`agreement-step.tsx`) מציג סיכום תנאים מהקמפיין. נדרש מזהה גרסה חדש, אסימונים חדשים (`{{packagePrice}}`, `{{contactQuota}}`) וסעיפים חדשים.

## 7. ממצאים שמשנים את התכנון

1. **אין סדר הוספה אמין לאורחים.** ב-ייבוא קובץ כל האורחים נוצרים בהוספה אחת, וחותמת הזמן זהה: באירוע הגדול ביותר 39 מתוך 43 אורחים חולקים `created_at` `[DB]`. `buildContactsForEvent` בוחר את האורחים **בלי `ORDER BY`** ויוצר אנשי קשר לפי סדר ההחזרה `[קוד: contacts.ts:77-99]`. סדר הקבלה לרשימה בייבוא הוא לכן סדר החזרה של מסד הנתונים, לא סדר השורות בקובץ. כלל "לפי סדר ההוספה" דורש עמודת סדר מפורשת. ל-`contacts.created_at` יש חותמות שונות (40 מתוך 40) `[DB]`, אבל הן נגזרות מאותו סדר בלתי מוגדר.
2. **חיוב כפול בגמר חשבון.** `createCampaign` מצלם `base_price`, `included_reached` ו-`price_per_reached` מהחבילה, והדגל `base_overage_pricing_enabled` דולק. קמפיין חבילה שיעבור `closeCampaignAndCharge` יחויב שוב לפי הנוסחה הישנה. מחייב מגן מחויב להסכם החתום, בדפוס ה-D5.
3. **`campaigns_guard_cancel` עיוור ליומן.** הוא בודק רק `capture_status` ו-`charge_status`. קמפיין חבילה ששולם (ביומן) יוכל להתבטל בלי החזר, אלא אם המגן יקרא את היומן **לפני** החיוב הראשון.
4. **מחיקת אירוע בדיקה תיכשל** ברגע שיש שורות ביומן, כי `payment_operations` מוגדרת `on delete restrict` ו-`purge_test_event` לא מוחקת ממנה `[הערה: תוכנית 24.9, אומת בגוף הפונקציה]`.
5. **עמודות ה-`capture_status`/`charge_status` נקראות ב-20 מקומות.** שימוש חוזר בהן לחיוב מיידי יטעה את כולם (במיוחד `isPostCharge` בביטול ו-`tax-ceiling`).
6. **המחיר ננעל לפני החתימה** (סוף שלב אישור הפרטים), והבחירה בחבילה חייבת להקדים אותו. היום אין בחירה כלל.
7. **`activateCampaign` דורש תפיסה מאושרת** (`capture_status='authorized'`). קמפיין חבילה זקוק לתנאי הפעלה אחר.
8. **אין מי שסוגר קמפיין או אירוע אחרי האירוע** במודל חבילה, כי אין גמר חשבון (סעיף 2).
9. **רגישות הזיכוי.** בתשלום מראש, כל ביטול אחרי ההפעלה הוא החזר דרך `creditHeldCardSumit`, שלא נבדק חי ושמסתמך על טוקן ות"ז שמורים.
10. **קרדיטים** נצרכים היום בגמר חשבון. במודל חבילה צריך להחליט איפה הם מנוכים.

## 8. נעלם, ומה סוגר כל אחד

| נעלם | מה סוגר אותו |
|---|---|
| האם חיוב J4 ישיר עם טוקן חד-פעמי מחזיר טוקן, ת"ז ו-`CustomerID` | ניסוי חי (שלב 0 בתוכנית), באישור הבעלים |
| האם חיוב על `Customer.ID` בלי אמצעי תשלום עובד (שדרוג בלי לשמור כרטיס אצלנו) | ניסוי חי |
| האם זיכוי על אותו לקוח עובד, ועל איזה אמצעי | ניסוי חי |
| האם `CardTokenNotNeeded` מונע זיכוי | לא רלוונטי: הרכישה לא שולחת את הדגל (הטוקן הקבוע הוא ברירת המחדל) |
| סיווג העסקה והנוסח של ביטול ומחיר | עורך דין (שאלות 14-18 בקטלוג) |
| שעון חיוב עוסק פטור מול תקרה עם תשלום מראש | רואה חשבון (נענה חלקית 24.9) |
| סדר אורחים בייבוא | מדידה חיה בבדיקה מגולגלת לאחור, אחרי שיוסיפו עמודת סדר |
