# מפת תלויות מלאה של 23 סוגי הצמתים, לקראת תיקייה לכל צומת

תאריך: 24.9.2026. מסמך מיפוי בלבד. לא הוזז קוד.

סימון:
- **[נמדד]** נקרא בקובץ ובשורה שמצוינים, או נמדד בפקודה.
- **[מוסק]** מסקנה שלא הורצה.

## מקורות

המפה מאחדת שלושה מיפויים מלאים. כל אחד נכתב אחרי קריאה מלאה של השכבה שלו, והמסמכים המלאים (באנגלית, עם כל מספרי השורות) שמורים בתיקיית העבודה של הסשן:
1. `depmap-catalogue.md`: שכבת הקטלוג, כלומר `types.ts`, `nodes.ts`, `schemas.ts`, `templates.ts`, `arm-check.ts`, `ui-formats.ts`, `sumit-sample-output.ts` ו־`voice-node-arm-check.ts`.
2. `depmap-server.md`: שכבת השרת והמנוע, כלומר `steps/index.ts`, `engine/*`, `adapter/*`, `enqueue`, `inbound`, `trigger`, `schedule`, `webhook-trigger`, `portability`, `voice-outcome`, `store`, כל המימושים החיים ו־`worker/main.ts` סביב נקודות הייבוא.
3. `depmap-editor-tests.md`: העורך, כלומר כל הקבצים תחת `src/app/(admin)/admin/workflows/**` ו־`data/admin/workflows.ts`, וכל קובצי הבדיקה שנוגעים בסוגי צמתים.

המפה נגזרת מהם. את הטענות המרכזיות אימתתי בעצמי:
- `KalfaNodeConfig` בלי `start_voice_call` (`types.ts:1158-1184`: 22 חברים).
- מטען של טריגר לפי שעון בלי `eventId` (`schedule.ts:153-161`).
- תקציב צומת הבינה המלאכותית (`node-budgets.ts:43,93,116-118`).
- כשל הגבול בין השרת לעורך. נמדד בבנייה החיה ובשחזור, ותוקן ב־24.9 (ראו §6).

## 1. דפוס היעד

**[נמדד]** בדוגמת הספק (`examples/workflow-builder-starter/src/nodes/<סוג>/`) יש ארבעה קבצים לכל צומת:
- `schema.ts`
- `uischema.ts`
- `default-properties-data.ts`
- `<סוג>.ts`, שמגדיר את ה־`PaletteItem`

שלושה מהם מייבאים ערכים מספריית העורך בזמן ריצה. לכן תיקייה בדפוס של הספק היא **צד עורך בלבד**.

**[מוסק]** אצלנו לכל צומת יש שני חצאים נוספים שאין להם מקבילה בדוגמה, ושניהם חייבים להיות נקיים מספריית העורך:
- **חצי משותף:** טיפוס ההגדרות, שדות חובה, כללים מותנים, טווחי מספרים, סיווג ניידות וידיות ענפים. כל אלה נמצאים היום ב־`types.ts`, שלא מייבא דבר.
- **חצי שרת:** המטפל שרץ ב־pg-boss, והתאמת הטריגר.

## 2. הצמתים, אחד אחד

לכל צומת מצוין איפה כל חלק יושב היום. הקיצורים: T = `catalogue/types.ts`, S = `catalogue/schemas.ts`, TM = `catalogue/templates.ts`, A = `catalogue/arm-check.ts`, ST = `steps/index.ts`, NB = `engine/node-budgets.ts`.

כל 23 הסוגים מופיעים גם ב־`NODE_TYPES` (T:22-46), ב־`CATALOGUE` (`nodes.ts:11-35`), ב־`NODE_REQUIRED_FIELDS` (T:1350-1381) וב־`STEP_HANDLERS` (ST:1914-1938). **[נמדד]**

### סוג העורך בלוח

| # | סוג | תבנית בעורך | עדכון בזמן טעינה |
|---|---|---|---|
| 1 | `trigger.whatsapp_inbound` | StartNode | מספרי וואטסאפ |
| 2 | `trigger.webhook` | StartNode | — |
| 3 | `trigger.schedule` | StartNode | — |
| 4 | `trigger.sumit_card` | StartNode | שדות מהקריאה האחרונה |
| 5 | `logic.condition` | DecisionNode | — |
| 6 | `logic.switch` | DecisionNode | — |
| 7 | `action.update_guest_status` | DecisionNode | — |
| 8 | `action.send_whatsapp` | DecisionNode | — |
| 9 | `action.microsoft_send_email` | DecisionNode | חיבורי Microsoft |
| 10 | `action.start_rsvp_ai_callback` | DecisionNode | — |
| 11 | `action.notify_team` | DecisionNode | — |
| 12 | `action.webhook` | DecisionNode | — |
| 13 | `action.set_guest_field` | DecisionNode | — |
| 14 | `action.create_callback_request` | DecisionNode | — |
| 15 | `action.import_guest_list` | DecisionNode | — |
| 16 | `logic.wait` | ברירת מחדל | — |
| 17 | `action.send_template` | ברירת מחדל | — |
| 18 | `action.start_for_each_guest` | DecisionNode | — |
| 19 | `action.start_voice_call` | DecisionNode | ייעודים ורשימות חיוג |
| 20 | `logic.set_value` | ברירת מחדל | — |
| 21 | `action.sumit_create_document` | DecisionNode | — |
| 22 | `action.sumit_create_customer` | DecisionNode | — |
| 23 | `action.ai_agent` | AiNode | — |

### מיקום החלקים בקוד

| # | סוג | טיפוס הגדרות (T) | מבנה + טופס + פלט + לוח (S) | מטפל (ST) | תקציב (NB) | תבניות (TM) |
|---|---|---|---|---|---|---|
| 1 | `trigger.whatsapp_inbound` | 102-151 | 411-538, 2997-3037 | 367-372 | ברירת מחדל | 7 תבניות |
| 2 | `trigger.webhook` | 426-447 | 544-654, 3038-3102 | 270-282 | ברירת מחדל | 1387, 1834, 1947 |
| 3 | `trigger.schedule` | 328-333 | 1739-1805, 3103-3126 | 350-352 | ברירת מחדל | 933, 1567 |
| 4 | `trigger.sumit_card` | 465-468 | 664-801, 3127-3166 | 309-337 | ברירת מחדל | 2070-2112 |
| 5 | `logic.condition` | 528-543 | 807-882, 3167-3254 | 457-479 | 5 שנ׳ | 72, 195 |
| 6 | `logic.switch` | 646-651 | 1149-1204, 3255-3306 | 587-610 | 5 שנ׳ | 449, 1148, 1617 |
| 7 | `action.update_guest_status` | 741-745 | 1210-1264, 3307-3333 | 619-677 | 20 שנ׳ | 93, 216, 523, 557 |
| 8 | `action.send_whatsapp` | 752-754 | 1270-1313, 3334-3359 | 962-980 | 30 שנ׳ | 248, 539, 573 |
| 9 | `action.microsoft_send_email` | 795-810 | 1319-1494, 3360-3397 | 1673-1739 | ברירת מחדל | — |
| 10 | `action.start_rsvp_ai_callback` | 814 | 1603-1633, 3398-3423 | 897-931 | 60 שנ׳ | 356 |
| 11 | `action.notify_team` | 829-833 | 1500-1562, 3424-3451 | 1000-1025 | 20 שנ׳ | 7 תבניות |
| 12 | `action.webhook` | 902-917 | 988-1131, 3510-3553 | 1049-1093 | 20 שנ׳ | — |
| 13 | `action.set_guest_field` | 1034-1038 | 888-936, 3452-3477 | 1145-1174 | 20 שנ׳ | — |
| 14 | `action.create_callback_request` | 1057-1062 | 942-982, 3478-3509 | 1191-1244 | 30 שנ׳ | — |
| 15 | `action.import_guest_list` | 292 | 1647-1679, 3554-3603 | 1291-1334 | 300 שנ׳ | 762 |
| 16 | `logic.wait` | 273-276 | 1686-1731, 3604-3624 | 1458-1491 | 5 שנ׳ | 1482 |
| 17 | `action.send_template` | 246-248 | 1820-1869, 3625-3645 | 1648-1671 | 30 שנ׳ | 1256, 1405, 1498 |
| 18 | `action.start_for_each_guest` | 253-262 | 1871-1973, 3646-3682 | 1516-1626 | 300 שנ׳ | 949 |
| 19 | `action.start_voice_call` | **חסר** | 2001-2366, 2934-2996 | 761-895 | 60 שנ׳ | 1109, 1584 |
| 20 | `logic.set_value` | 1076-1078 | 1568-1597, 3683-3702 | 1259-1261 | 5 שנ׳ | — |
| 21 | `action.sumit_create_document` | 1092-1118 | 2583-2742, 2817-2864 | 1758-1814 | ברירת מחדל | 1851, 1985 |
| 22 | `action.sumit_create_customer` | 1121-1131 | 2619-2814, 2865-2895 | 1817-1843 | ברירת מחדל | 1964 |
| 23 | `action.ai_agent` | 980-996 | 2430-2516, 2896-2933 | 1866-1912 | ברירת מחדל (ראו §7) | — |

הערות לטבלאות:
- עמודת S כוללת את המבנה, הטופס, `outputSchema` והרשומה בלוח. כל החלקים האלה הם **צד עורך בלבד** בכל 23 הסוגים. **[נמדד]**
- ארבעה סוגים מקבלים עדכון בזמן טעינה דרך `buildPaletteItems` (S:2546-2566): מספר 1, 4, 9 ו־19. **[נמדד]**
- "ברירת מחדל" בתקציב פירושו 120 שניות (NB:43). **[נמדד]**
- הפירוט המלא לכל צומת נמצא בשלושת המסמכים:
  - הקטלוג: שדות חובה, כללים מותנים, ניידות, כללי חימוש ותוויות (`depmap-catalogue.md` §2.1–2.23).
  - השרת: פורטים, מימוש חי, התאמת טריגר וריצת ניסיון (`depmap-server.md` §1).
  - העורך והבדיקות: רכיבים בעורך ובדיקות לפי בלוק (`depmap-editor-tests.md` §1).

## 3. מה רץ בדפדפן ומה בשרת

**צד עורך, דפדפן בלבד.** מבנה, טופס, ברירות מחדל ורשומה בלוח, בכל 23 הסוגים. כולם משתמשים ב־`identityProperties` (`sharedProperties`), `statusProperty` (`statusOptions`), `getScope` ו־`NodeType`, ואלה ערכים של ספריית העורך בזמן ריצה. **[נמדד]**

**צד משותף, נקי.** `types.ts` (ייבוא אחד, מסוג type בלבד, T:13), `nodes.ts` ו־`ui-formats.ts`, שלא מייבא דבר. **[נמדד]**

**צד שרת.** `steps/index.ts` מייבא רק את `catalogue/types`, `voice-outcome`, `vendor/errors`, `@/lib/constants`, `@/lib/integrations/errors` ו־`@/lib/sumit/hold-status`. **[נמדד]** המנוע בשרת נקי היום: אף אחד מ־238 המודולים שלו לא מגיע לספריית העורך. **[נמדד בהרצת depcruise]**

**כל המקומות שבהם ייבוא לא נכון היה מכניס את ספריית העורך לשרת:**
1. **תוקן ב־24.9:** `sumit-sample-output.ts` ו־`data/admin/workflows.ts` ייבאו מ־`schemas.ts`. ראו §6.
2. **[מוסק]** קובץ `index.ts` לכל צומת שמייצא גם את חצי העורך וגם את החצי המשותף או של השרת. כל ייבוא של התיקייה יכניס את ספריית העורך.
3. **[נמדד]** `STEP_HANDLERS` שייבנה מייבוא של שורש כל תיקייה.
4. **[נמדד]** התאמת טריגר (`trigger.ts`, `schedule.ts`) רצה במנוע. היא חייבת לייבא רק קובץ התאמה טהור, לעולם לא את שורש התיקייה (T:62-66).
5. **[נמדד]** `export-diagram.tsx:5` מייבא את `TEMPLATE_KEYS` מ־`schemas.ts`. זה בצד העורך ולכן תקין, אבל הרשימה עצמה היא נתונים טהורים.
6. **[נמדד]** כלל השמירה בודק רק את הנתיב `catalogue/schemas.ts` (`.dependency-cruiser.cjs:25-26`). הוא לא יראה קובצי מבנה חדשים בתיקיות. אין כלל שאוסר את ספריית העורך עצמה בשרת, ו־`worker/` לא כלול ב־`from`.
7. **[נמדד]** `server-only` מוחלף בקובץ ריק בבנייה של המנוע (`package.json:17`). לכן הוא לא מגן שם.
8. **[נמדד]** `tsPreCompilationDeps: true` גורם לייבוא מסוג type בלבד להיחשב כקשר. צריך להחליט אם זה רצוי.

## 4. עזרים משותפים, וטבלאות שחייבות לכלול את כל הצמתים

### עזרים משותפים לכמה צמתים

**בצד העורך** (S): **[נמדד]**
- `identityProperties` (205-233) ו־`statusProperty` (135-137): כל 23 הסוגים.
- `identityControls` (277-309) ו־`statusControl` (239-241): כל 23 הסוגים.
- `nodeStatusOptions` (98-106): כל ברירות המחדל.
- `actionBranches` (116-119): 13 סוגי פעולה.
- `actionBranchesProperty` (121-133): 11 סוגים. `set_guest_field` ו־`create_callback_request` מחזיקים העתק משלהם.
- `errorPolicyOptions` (340-344): 13 סוגים. `ai_agent` משתמש בגרסה האנגלית של הספרייה.
- `requiredText` (174).
- `triggerSwitchElement` (476-480): 4 הטריגרים.
- `rsvpStatusOptions` (385-389): `update_guest_status` ו־`start_for_each_guest`.
- `withNodeRunControl` ו־`buildPaletteItems` (2402-2567).

**ב־`ui-formats.ts`, נקי:** שש קבועי תצוגה, ושישה רכיבים בעורך שמשויכים אליהם. **[נמדד]**

**בשרת, ב־ST:**
- מנגנון ההמתנה: `WORKFLOW_WAIT_CODE`, `WorkflowWaitSignal` ו־`readWaitSignal` (1362-1437). משמש את `logic.wait`, את `start_voice_call`, את `activity-runner` ואת `run-workflow`.
- `requireGuestContext` (242-254): 7 סוגים.
- קוראי הגדרות (212-231, 1119-1128).
- `StepHandler` ו־`StepContext` (170-201).
- `WorkflowTriggerPayload` (88-168).

כל אלה **[נמדד]**, ואף אחד מהם לא יכול לשבת בתיקייה של צומת אחד.

**במשותף, ב־T:**
- `ACTION_BRANCH_HANDLES` (736-739)
- `CONDITION_BRANCH_HANDLES` (520-526)
- ידיות ה־switch (627-644)
- `RUNNER_ERROR_PORT` (717)
- `GUEST_SCOPED_NODE_TYPES` (1419-1427)
- `INBOUND_HTTP_TRIGGER_TYPES` ו־`authModeFor` (478-498)

כל אלה **[נמדד]**.

### טבלאות שחייבות לכלול את כל הצמתים

| מבנה | מיקום | איך הוא נבדק | מה נשבר כשצומת חסר |
|---|---|---|---|
| `NODE_REQUIRED_FIELDS` | T:1350 | קומפילציה | שגיאת tsc |
| `STEP_HANDLERS` | ST:1914 | קומפילציה | שגיאת tsc |
| `CATALOGUE` | `nodes.ts:11` | בדיקה אחת (`to-definition.test.ts:86`) | בזמן ריצה הצומת נדחה |
| `PALETTE_ITEMS` | S:2816 | מספר קבוע 23 (`required-fields-editable.test.ts:109`) | בדיקה נכשלת |
| `KalfaNodeConfig` | T:1160 | **אין בדיקה** | כבר חסר בו `start_voice_call` |
| `NODE_ACTIVITY_PROFILES` | NB:56 | חלקי | בשקט, מקבל 120 שניות |
| `GUEST_SCOPED_NODE_TYPES` | T:1419 | סריקת טקסט של `steps/index.ts` | נכשל כשהמטפלים זזים |

כל השורות **[נמדד]**.

### בדיקות שקוראות קבצים לפי נתיב

אלה יישברו, או יפסיקו לשמור, כשקבצים יזוזו. **[נמדד]**
- `palette-defaults.test.ts:280-298` סורק את `schemas.ts` בביטוי שתלוי בהזחה של 4 רווחים. **ייכשל בוודאות.**
- `guest-context.test.ts:64-74` **ייכשל.**
- `ai-agent.test.ts:129-138` ו־`sumit-accounting.test.ts:187-215` **ימשיכו לעבור בלי לשמור על כלום.** הבדיקה היחידה שלהם היא שהקובץ ארוך מ־1000 תווים.
- `required-fields-editable.test.ts:89-97` תלוי בנתיב של רכיב הטוקן.
- ארבע בדיקות עורך ו־`sdk-integration-invariants` קוראות את `workflow-editor.tsx`.

### בדיקות זהות, ספירה ורשימות ידניות

**[נמדד]**
- `arm-check.test.ts:402-418`: `schema.required` חייב להיות **אותו אובייקט** כמו `NODE_REQUIRED_FIELDS[type]`.
- `microsoft-connection.test.ts:85-117`: המבנה וברירות המחדל חייבים להיות זהים לאלה שבלוח.
- בכל הלוח חייבת להיות קבוצת `Group` אחת בדיוק.
- רשימות ידניות של סוגים בבדיקות: `templates`, `guest-context`, `microsoft-connection`, `portability-coverage` ו־`palette-defaults`.

## 5. תלויות בין הצמתים, ומעגלי ייבוא

**מעגלי ייבוא: אין.** בדקתי בקטלוג, בשרת, במנוע ובעורך. **[נמדד]**

**צמדים וקבוצות שקשורים זה לזה:**
- `trigger.webhook` ו־`trigger.sumit_card` חולקים כתובת אחת, את `authModeFor`, את רכיב הטוקן ואת `blankMessage`.
- כלל החימוש של אורח (A:161-178, 287-295) מחבר כל טריגר לכל צומת שפועל על אורח.
- `logic.wait` ו־`start_voice_call` חולקים את מנגנון ההמתנה. `start_voice_call` מזין את `logic.switch` דרך `outcome`.
- ארבע פעולות מחזירות את ענף השגיאה, והממיר מתרגם אותו (`to-definition.ts:300-307`).
- `start_for_each_guest` תלוי בתזמון של כל דקה, ומעביר את התרשים של תהליך היעד.
- משפחת האורח: `update_guest_status`, `set_guest_field` ו־`create_callback_request` חולקים את `getGuestsForContact`.
- `sumit_create_document` מקבל את `customerId` של `sumit_create_customer` דרך תבנית.

כל אלה **[נמדד]**.

**התבניות מחברות סוגים לפי מחרוזות** של שמות פלט (TM:798, 815, 990, 1012, 1183-1219, 2001, 2098-2106). **[נמדד]** לכן `templates.ts` צריך להישאר מחוץ לתיקיות הצמתים. **[מוסק]**

## 6. הבעיה שנמצאה ותוקנה במהלך המיפוי

שלב אחרי שלב:
1. **[נמדד]** `npm run worker:deps` נכשל עם 2 שגיאות. בגלל זה `pretest` עצר את `npm test`.
2. **[נמדד]** בבנייה החיה, השרת קיבל את `SUMIT_CARD_BASE_OUTPUT` ואת `SUMIT_HOLD_FIELDS_OUTPUT` כמצביעים של `registerClientReference`.
3. **[נמדד]** שחזור עם `react-server` הראה שפריסה של מצביע כזה מחזירה `{}`, וקריאה ממנו מחזירה `undefined`. המשמעות: בעורך החי, שדות הבסיס והתוויות של תפיסות המסגרת נעלמו בשקט.
4. **התיקון (24.9):**
   - הנתונים עברו לקובץ חדש, `catalogue/sumit-card-output.ts`, שלא מייבא דבר.
   - `schemas.ts`, `sumit-sample-output.ts` ו־`data/admin/workflows.ts` קוראים ממנו עכשיו.
5. **האימות:**
   - `worker:deps` נקי.
   - הזרקת תקלה: החזרת הייבוא הישן גרמה ל־2 שגיאות, והשחזור החזיר את המצב הנקי.
   - `tsc` עובר.
   - `npm test`: 6,909 בדיקות עברו.
   - `lint` נקי.

## 7. תקלות שנמצאו בדרך

כולן **[נמדד]**, ואף אחת מהן לא תוקנה במסגרת המיפוי.
1. **`start_for_each_guest` נכשל תמיד כשהתהליך מתחיל לפי שעון.** המטען של טריגר השעון נבנה בלי `eventId` (`schedule.ts:153-161`), והמטפל דורש אותו (ST:1529-1535). זאת למרות שההערה של המטפל אומרת שהוא נבנה בשביל ריצה לפי שעון.
2. **`ai_agent` נעצר אחרי 120 שניות, והפורט מתיר 600.** הוספת רשומה לא תעזור: כל ערך מעל 300 שניות חוזר לברירת המחדל (NB:43, 93, 116-118).
3. **`KalfaNodeConfig` חסר את `start_voice_call`,** ואין בדיקה שתופסת את זה.
4. **שני טיפוסי המטען של הטריגר התפצלו.** `TriggerPayload` חסר את `inboxRowId` ואת `query`.
5. **ל־`trigger.webhook` אין `allOf`,** למרות ההערה. הכלל נאכף רק בזמן חימוש.
6. **`ai_agent`** משתמש במדיניות השגיאה באנגלית, ואין לו ענף שגיאה.
7. **`send_template`** לא מצהיר על `errorPolicy`, ותבנית מציבה לו אחד.
8. **בחירת הסטטוסים של `for_each` אין את `pending`,** למרות שתבנית הסריקה השבועית מסננת לפיו.
9. **ענפים לא מחוברים בתבניות:** `rsvpAiVoiceCallback`, `sumitReceiptOnWebhook` (ההערה בה אומרת שהשניים מחוברים) ו־`sumitCustomerThenDocument`.
10. **ריצה ידנית של כל טריגר בונה מטען בצורה של וואטסאפ** (`manual-run.ts:101-133`).
11. **בריצת ניסיון בעורך, 5 סוגים נכשלים תמיד:** `import_guest_list`, `send_template`, `for_each`, `start_voice_call` ו־`logic.wait`.

## 8. סדר העברה מומלץ

הסדר נגזר מהמפה.

**שלב א': תשתית לפני כל צומת.** בלעדיה, כל העברה תשבור בדיקות או תסכן את השרת.
1. **כלל שמירה חדש שאוסר את ספריית העורך עצמה** בקוד המנוע, בצעדים, בממיר ובחצי השרת של כל תיקייה. מאמתים אותו בהזרקת תקלה. *סיבה:* הכלל הקיים בודק רק את הנתיב `schemas.ts` (§3.6), והוא לא יראה קבצים חדשים.
2. **מוציאים את העזרים המשותפים מ־`steps/index.ts`:** מנגנון ההמתנה ל־`engine/`, ואת `requireGuestContext`, קוראי ההגדרות, `StepContext` וטיפוסי המטען למודול משותף. *סיבה:* הם משמשים כמה צמתים ואת המנוע (§4). אם יישארו ברשומה, תיקייה שמייבאת אותם תיצור מעגל.
3. **משכתבים את בדיקות הסריקה** כך שיסרקו את כל קובצי השרת והעורך בתיקיות, עם בדיקה שהרשימה לא ריקה ושהיא מכסה את מספר המטפלים. *סיבה:* שתיים מהן יפסיקו לשמור בשקט, ושלוש ייכשלו (§4).
4. **מחליטים על מבנה התיקייה.** המבנה המוצע, **[מוסק]**:
   - `nodes/<סוג>/editor/`: ארבעת הקבצים של הספק.
   - `nodes/<סוג>/shared.ts`: הגדרות, שדות חובה, ניידות ופלט כנתונים.
   - `nodes/<סוג>/server.ts`: המטפל.
   - **בלי `index.ts` משותף.**

   `schemas.ts` ו־`steps/index.ts` נשארים כקובצי איסוף, כי 11 קבצים מבחוץ מייבאים את `schemas.ts`.

**שלב ב': צמתים בלי תלויות**, מהפשוט לקשה.
5. `logic.set_value`. *סיבה:* אין לו ענפים, תבנית, פורט או רכיב בעורך. אימות מלא של המבנה בסיכון מינימלי.
6. `logic.condition` ו־`logic.switch`. *סיבה:* טהורים, בלי פורט. תלויים רק בידיות מ־T.
7. `action.notify_team`. *סיבה:* פורט אחד. הוא המשומש ביותר בתבניות, ולכן בודק היטב את בדיקות ההפניות.

**שלב ג': פעולות עם פורט ובלי אורח.**
8. `action.webhook`. *סיבה:* יש לו רכיב בעורך ובדיקות משלו. הוא היחיד שנושא סודות.
9. `action.sumit_create_customer` ואחריו `action.sumit_create_document`, יחד. *סיבה:* מחוברים בתבנית, ויש להם בדיקת טוהר על ייבוא ממערכת הסליקה.
10. `action.microsoft_send_email`. *סיבה:* עדכון בזמן טעינה, רכיב בעורך ותיקון ישן במאפיינים.
11. `action.ai_agent`. *סיבה:* בדיקת הסריקה שלו חייבת לעבור לגלוב. מומלץ לתקן קודם את §7.2 ואת §7.6.

**שלב ד': צמתים שפועלים על אורח.** לפני השלב הזה צריך לעבור שלב 2 בתשתית, `requireGuestContext` כמודול משותף.
12. `action.set_guest_field`, `action.create_callback_request` ו־`action.update_guest_status`. *סיבה:* משפחה אחת, עם בדיקת החימוש של אורח.
13. `action.send_whatsapp` ו־`action.send_template`.
14. `action.start_rsvp_ai_callback`. *סיבה:* אין לו בדיקת צעד. כדאי לכתוב אחת לפני ההעברה.
15. `action.import_guest_list`. *סיבה:* תלוי ב־`inboxRowId` מהטריגר של וואטסאפ.

**שלב ה': צמתים שמשהים ריצה.** לפני השלב הזה מנגנון ההמתנה צריך כבר להיות ב־`engine/`.
16. `logic.wait`.
17. `action.start_voice_call`. *סיבה:* מנגנון ההמתנה, העירה מבחוץ, רשימות חיוג ובדיקת מסד בזמן חימוש. חסר לו טיפוס הגדרות (§7.3), ואותו משלימים קודם.
18. `action.start_for_each_guest`. *סיבה:* יוצר ריצות ותלוי בתזמון. מומלץ לתקן קודם את §7.1.

**שלב ו': טריגרים, אחרונים.** הם בשרשרת של המנוע (`inbound`, `trigger`, `schedule`, `webhook-trigger`), ולכן כל אחד צריך קובץ התאמה טהור.
19. `trigger.schedule`.
20. `trigger.webhook` ו־`trigger.sumit_card`, יחד. *סיבה:* כתובת אחת ורכיב אחד. אם התוכנית של הטריגר הכללי תאושר קודם, `sumit_card` יתמזג לתוכו.
21. `trigger.whatsapp_inbound`. *סיבה:* הכי הרבה תלויות: התאמה בכניסה, מספרים, סוגי הודעות, תפקיד ייבוא בזמן חימוש ו־7 תבניות.

**נשאר במקום:** `templates.ts` וכלל החימוש של אורח ב־`arm-check.ts`. *סיבה:* שניהם מחברים כמה צמתים (§5).

## 8א. מבנה התיקיות בסוף, הצעה **[מוסק]**

### מבנה כללי

```
src/lib/workflow/
├── nodes/                 ← תיקייה לכל צומת (23), פירוט למטה
├── catalogue/
│   ├── types.ts           ← NODE_TYPES וטיפוסים משותפים. לא מייבא דבר
│   ├── schemas.ts         ← אוסף את חלקי העורך ללוח. נשאר, כי 11 קבצים מייבאים אותו
│   ├── templates.ts       ← תבניות. מחברות כמה צמתים (§5)
│   ├── arm-check.ts       ← בדיקות חימוש, כולל כלל האורח
│   └── ui-formats.ts      ← קבועי הרכיבים המיוחדים
├── steps/
│   ├── index.ts           ← אוסף את חלקי השרת ל־STEP_HANDLERS
│   └── shared.ts          ← requireGuestContext, קוראי הגדרות, StepContext, טיפוסי מטען
└── engine/
    └── wait-signal.ts     ← מנגנון ההמתנה (logic.wait ו־start_voice_call)
```

### הבסיס בכל תיקיית צומת

```
<סוג>/
├── editor/                         ← דפדפן בלבד. מייבא את ספריית העורך
│   ├── schema.ts
│   ├── uischema.ts
│   ├── default-properties-data.ts
│   └── palette-item.ts             ← כולל outputSchema
├── shared.ts                       ← טיפוס הגדרות, שדות חובה, כללים מותנים, טווחים, ניידות. נקי
└── server.ts                       ← המטפל. מייבא רק shared.ts, steps/shared.ts ו־engine
```

### כל 23 התיקיות, ומה נוסף לכל אחת מעבר לבסיס

```
nodes/
├── trigger.whatsapp_inbound/
│   ├── editor/schema-for-numbers.ts     ← triggerSchemaFor (S:444-460)
│   ├── match.ts                         ← matchesKind, matchesKeyword ו־matchesNumber (trigger.ts)
│   └── *.test.ts
├── trigger.webhook/
│   ├── match.ts                         ← הצד של הצומת ב־findWorkflowForEndpoint
│   └── *.test.ts
├── trigger.schedule/
│   ├── match.ts                         ← matchesSchedule (schedule.ts:91-109)
│   └── *.test.ts
├── trigger.sumit_card/
│   ├── output-fields.ts                 ← היום catalogue/sumit-card-output.ts. נקי
│   ├── sample-output.ts                 ← היום catalogue/sumit-sample-output.ts
│   └── *.test.ts
├── logic.condition/                     (בסיס + בדיקות)
├── logic.switch/                        (בסיס + בדיקות)
├── logic.set_value/                     (בסיס + בדיקות)
├── logic.wait/                          (בסיס + בדיקות)
├── action.update_guest_status/          (בסיס + בדיקות)
├── action.send_whatsapp/                (בסיס + בדיקות)
├── action.send_template/                (בסיס + בדיקות)
├── action.set_guest_field/              (בסיס + בדיקות)
├── action.create_callback_request/      (בסיס + בדיקות)
├── action.start_rsvp_ai_callback/       (בסיס + בדיקה חדשה, היום אין לו)
├── action.start_voice_call/
│   ├── editor/schema-for-lists.ts       ← voiceCallSchemaFor (S:2045-2099)
│   ├── outcome.ts                       ← היום voice-outcome.ts
│   └── *.test.ts
├── action.notify_team/                  (בסיס + בדיקה חדשה, היום אין לו)
├── action.webhook/                      (בסיס + בדיקות)
├── action.microsoft_send_email/
│   ├── editor/schema-for-connections.ts ← microsoftSendEmailSchemaFor (S:1372-1385)
│   └── *.test.ts
├── action.sumit_create_customer/        (בסיס + בדיקות)
├── action.sumit_create_document/        (בסיס + בדיקות)
├── action.ai_agent/                     (בסיס + בדיקות)
├── action.import_guest_list/            (בסיס + בדיקות)
└── action.start_for_each_guest/         (בסיס + בדיקות)
```

### כללים

1. **אין `index.ts` בתיקיית צומת.** קובץ כזה היה מאחד את חצי העורך עם חצי השרת (§3.2).
2. **קוד השרת והמנוע לא מייבאים מ־`nodes/*/editor/`.** כלל שמירה חדש יאכוף את זה (§8, שלב 1).
3. **`match.ts` ו־`shared.ts` נקיים.** הם נטענים בשרשרת של המנוע (§3.4).
4. **מחוץ לתיקיות הצמתים נשארים:** מנגנון ההמתנה, בדיקת האורח, הכתובת והטוקן של הקריאה הנכנסת (משותפים ל־`trigger.webhook` ול־`trigger.sumit_card`) והתבניות. כל אחד מהם מחבר כמה צמתים.

## 9. ספירה חוזרת

- **קטלוג:** 23 מתוך 23 (`depmap-catalogue.md` §2.1–2.23).
- **שרת:** 23 מתוך 23 (`depmap-server.md` §1, סעיפים 1–23).
- **עורך ובדיקות:** 23 מתוך 23 (`depmap-editor-tests.md` §1, סעיפים 1–23).
- **המסמך הזה:** 23 שורות בכל אחת משתי הטבלאות ב־§2, ו־23 סוגים בסדר ההעברה ב־§8. `trigger.webhook` ו־`trigger.sumit_card` מופיעים יחד בסעיף 20, וסעיפים 6, 9, 12 ו־13 מאגדים יותר מסוג אחד. בסך הכול כל 23 הסוגים מופיעים, כל אחד פעם אחת.
