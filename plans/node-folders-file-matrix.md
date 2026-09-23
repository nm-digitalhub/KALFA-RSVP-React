# מטריצת מעבר לתיקייה לכל צומת

תאריך: 24.9.2026. בסיס: `feat/admin-integrations-consolidation` ב-HEAD `72ab238`.

המסמך הזה משלים ומתקן את `plans/node-folders-dependency-map.md`. הוא מסמך מיפוי בלבד; אין בו שינוי קוד.

## 1. תיקון מבני

לפי הדרישות המעודכנות יש בפועל **שישה קבצי בסיס פיזיים לכל צומת**, לא חמישה:

```
src/lib/workflow/nodes/<category-name>/
├── definition.ts
├── schema.ts
├── uischema.ts
├── default-properties-data.ts
├── <category-name>.ts
└── runtime.ts
```

הסיבה לספירה: ארבעת קבצי הספק נשארים, `runtime.ts` נוסף לצד השרת, ו-`definition.ts` נוסף כחוזה טהור שמשותף לעורך ולשרת.

שמות התיקיות הם category-prefixed kebab-case, למשל `trigger-webhook` ו-`action-webhook`. אין תיקיית `webhook` עמומה.

אין `index.ts` בתיקיית צומת. כל ייבוא הוא לקובץ מפורש.

### תפקיד כל קובץ

| קובץ | מותר לייבא SDK של העורך | אחריות |
|---|---:|---|
| `definition.ts` | לא | טיפוס config, סוג הצומת, isTrigger, required fields, conditional requirements, numeric ranges, deployment bindings, guest-scope, activity profile, output field metadata וכל נתון טהור ייחודי לצומת |
| `schema.ts` | כן | JSON schema, options ו-schema factories של הצומת |
| `uischema.ts` | כן | UI schema וה-controls של הצומת |
| `default-properties-data.ts` | כן, אך עדיף שלא אם אין צורך | ברירות המחדל בלבד |
| `<category-name>.ts` | כן | PaletteItem: label, description, icon, templateType וחיבור schema/ui/default/output |
| `runtime.ts` | לא | StepHandler ועזרים שרק המטפל הזה משתמש בהם |

`outputSchema.properties` לא יהיה מקור האמת. רשימת שדות הפלט עוברת ל-`definition.ts` כנתונים טהורים, וה-PaletteItem משתמש באותה רשימה. כך גם השרת וגם העורך קוראים אותו חוזה.

## 2. כללי שמירה

1. `definition.ts`, `runtime.ts`, `match.ts` וכל קוד תחת `engine/` ו-`steps/` אינם רשאים לייבא `@workflowbuilder/sdk` או קובץ שמייבא אותו.
2. אין `index.ts` בתוך `nodes/*`.
3. `runtime.ts` רשאי לייבא רק `definition.ts`, מודולי runtime משותפים, ports ומודולי domain/server.
4. `schema.ts`, `uischema.ts`, `default-properties-data.ts` וקובץ ה-PaletteItem הם צד עורך.
5. registries מרכזיים ייבנו מייבואים מפורשים של הקבצים המתאימים, לא מייבוא שורש תיקייה.
6. בדיקת dependency-cruiser תיאכף על שם החבילה `@workflowbuilder/sdk`, לא רק על הנתיב הישן `catalogue/schemas.ts`.
7. בדיקות source-scan יסרקו glob של כל `nodes/*/runtime.ts` ו-`nodes/*/definition.ts`, וייכשלו אם לא נמצאו קבצים.

## 3. מטריצת 23 הצמתים

קיצורים למקורות הישנים:
- T = `src/lib/workflow/catalogue/types.ts`
- S = `src/lib/workflow/catalogue/schemas.ts`
- N = `src/lib/workflow/catalogue/nodes.ts`
- ST = `src/lib/workflow/steps/index.ts`
- NB = `src/lib/workflow/engine/node-budgets.ts`

עמודת `definition.ts` כוללת גם את שורת ה-`CATALOGUE`, שורת `NODE_REQUIRED_FIELDS`, שורת התקציב אם יש, שורת הניידות אם יש, חברות ב-`GUEST_SCOPED_NODE_TYPES`, כללים מותנים/טווחים אם יש, ואת שדות הפלט שמוצאים כיום מתוך ה-PaletteItem.

| # | תיקייה / סוג | `definition.ts` - מה עובר | `schema.ts` | `uischema.ts` | `default-properties-data.ts` | `<name>.ts` | `runtime.ts` |
|---|---|---|---|---|---|---|---|
| 1 | `trigger-whatsapp-inbound` / `trigger.whatsapp_inbound` | T:102-198; N:12; T:1312; T:1351; output S:2960-2966; תקציב ברירת מחדל. `WHATSAPP_MESSAGE_KINDS`, defaults של message kinds וה-config עוברים יחד. | S:411-475; `triggerSchemaFor` נשאר כאן | S:482-543; `triggerSwitchElement` נשאר shared editor כי משמש 4 טריגרים | S:2967-2975 | S:2937-2977 פחות output/default | ST:367-372 |
| 2 | `trigger-webhook` / `trigger.webhook` | T:347-447; N:13; T:1316; T:1357; conditional T:1609-1618; output S:2989-3008; תקציב ברירת מחדל | S:544-588 | S:589-663 | S:3009-3040 | S:2978-3042 פחות output/default | ST:270-282 |
| 3 | `trigger-schedule` / `trigger.schedule` | T:328-333; N:14; T:1359; output S:3052-3057; תקציב ברירת מחדל | S:1678-1705 | S:1706-1758 | S:3058-3064 | S:3043-3066 פחות output/default | ST:350-352 |
| 4 | `trigger-sumit-card` / `trigger.sumit_card` | T:465-468; N:15; T:1318; T:1360; output S:3094-3097; `catalogue/sumit-card-output.ts` נטמע/מיוצא דרך ההגדרה; תקציב ברירת מחדל | S:664-686 | S:687-745 | S:3098-3104 | S:3067-3106 פחות output/default | ST:309-337 |
| 5 | `logic-condition` / `logic.condition` | T:74-100 ו-T:520-543; N:16; T:1361; NB:58; output S:3167-3176 | S:746-783 | S:784-826 | S:3177-3192 | S:3107-3194 פחות output/default | ST:388-479, כולל `compareValues` ו-`evaluateCondition` |
| 6 | `logic-switch` / `logic.switch` | T:563-651; N:17; T:1362; NB:59; output S:3205-3213 | S:1088-1122 | S:1123-1148 | S:3214-3244 | S:3195-3246 פחות output/default | ST:503-610, כולל `readBranches` ו-evaluators |
| 7 | `action-update-guest-status` / `action.update_guest_status` | T:741-745; N:18; T:1365; guest T:1420; NB:66; output S:3257-3263 | S:1149-1178 | S:1179-1208 | S:3264-3271 | S:3247-3273 פחות output/default | ST:619-677 |
| 8 | `action-send-whatsapp` / `action.send_whatsapp` | T:752-754; N:19; T:1366; guest T:1421; NB:63; output S:3284-3289 | S:1209-1222 | S:1223-1257 | S:3290-3297 | S:3274-3299 פחות output/default | ST:962-980 |
| 9 | `action-microsoft-send-email` / `action.microsoft_send_email` | T:761-810; N:20; T:1319; T:1367; output S:3307-3316; תקציב ברירת מחדל | S:1258-1344, כולל `microsoftSendEmailSchemaFor` | S:1345-1438 | S:3317-3335 | S:3300-3337 פחות output/default | ST:1673-1739 |
| 10 | `action-start-rsvp-ai-callback` / `action.start_rsvp_ai_callback` | T:814; N:21; T:1369; guest T:1426; NB:70; output S:3345-3354 | S:1542-1552 | S:1553-1585 | S:3355-3361 | S:3338-3363 פחות output/default | ST:897-931 |
| 11 | `action-notify-team` / `action.notify_team` | T:826-833; N:22; T:1370; NB:65; output S:3374-3379 | S:1439-1460 | S:1461-1506 | S:3380-3389 | S:3364-3391 פחות output/default | ST:1000-1025 |
| 12 | `action-webhook` / `action.webhook` | T:867-955; N:23; T:1323; T:1371; conditional T:1595-1604; NB:62; output S:3459-3474 | S:927-961 | S:962-1087 | S:3475-3491 | S:3450-3493 פחות output/default | ST:1049-1128, כולל `readHeaderRows` ו-`readOptionalEnum` |
| 13 | `action-set-guest-field` / `action.set_guest_field` | T:1024-1038; N:24; T:1372; guest T:1423; NB:67; output S:3399-3406 | S:827-856 | S:857-880 | S:3407-3415 | S:3392-3417 פחות output/default | ST:1145-1174 |
| 14 | `action-create-callback-request` / `action.create_callback_request` | T:1057-1062 ו-T:1699-1713; N:25; T:1321; T:1373; guest T:1424; NB:68; output S:3425-3431 | S:881-901 | S:902-926 | S:3432-3447 | S:3418-3449 פחות output/default | ST:1191-1244 |
| 15 | `action-import-guest-list` / `action.import_guest_list` | T:292; N:26; T:1374; NB:71; output S:3503-3534 | S:1586-1598 | S:1599-1624 | S:3535-3541 | S:3494-3543 פחות output/default | ST:1291-1334 |
| 16 | `logic-wait` / `logic.wait` | T:212-213 ו-T:273-276; N:27; T:1363; range T:1654; NB:61; output S:3550-3555 | S:1625-1646 | S:1647-1677 | S:3556-3562 | S:3544-3564 פחות output/default | ST:1447-1491. מנגנון signal ב-ST:1362-1437 לא עובר לצומת; הוא shared engine |
| 17 | `action-send-template` / `action.send_template` | T:246-248; N:28; T:1320; T:1368; guest T:1422; NB:64; output S:3571-3577. `TEMPLATE_KEYS` S:1759-1776 הופך לנתון טהור כאן | S:1778-1789 | S:1790-1809 | S:3578-3583 | S:3565-3585 פחות output/default | ST:1648-1671 |
| 18 | `action-start-for-each-guest` / `action.start_for_each_guest` | T:250-271; N:29; T:1322; T:1375; range T:1655; NB:72; output S:3595-3607. `MAX_FANOUT_DEPTH` T:1678 שייך לחוזה הצומת | S:1810-1836 | S:1837-1939 | S:3608-3620 | S:3586-3622 פחות output/default | ST:1516-1626 |
| 19 | `action-start-voice-call` / `action.start_voice_call` | **אין כיום Config type ב-T**; יש ליצור `StartVoiceCallConfig` מתוך שדות S:1984-2042 והקריאות ST:761-895. N:30; T:1341-1347; T:1376; guest T:1425; NB:69; output S:2881-2919 | S:1940-2042, כולל `voiceCallSchemaFor` | S:2043-2316 | S:2920-2934 | S:2874-2936 פחות output/default | ST:720-895, כולל `PURPOSE_SETTLED` ו-`voiceOutcomeOutput` |
| 20 | `logic-set-value` / `logic.set_value` | T:1076-1078; N:31; T:1364; NB:60; output S:3629-3634 | S:1507-1518 | S:1519-1541 | S:3635-3640 | S:3623-3643 פחות output/default | ST:1259-1261 |
| 21 | `action-sumit-create-document` / `action.sumit_create_document` | T:1092-1118 ו-T:1147-1156; N:32; T:1339; T:1379; output S:2791-2802; תקציב ברירת מחדל | S:2522-2557 ו-S:2577 | S:2583-2682 | S:2768-2790 | S:2757-2804 פחות output/default | ST:1758-1814 |
| 22 | `action-sumit-create-customer` / `action.sumit_create_customer` | T:1121-1131; N:33; T:1340; T:1380; output S:2827-2833; תקציב ברירת מחדל | S:2558-2576 ו-S:2578 | S:2683-2754 | S:2812-2826 | S:2805-2835 פחות output/default | ST:1817-1843 |
| 23 | `action-ai-agent` / `action.ai_agent` | T:970-996; N:34; T:1335; T:1358; output S:2848-2861; תקציב ברירת מחדל | S:2369-2403 | S:2404-2456 | S:2862-2871 | S:2836-2873 פחות output/default | ST:1866-1912 |

## 4. קבצים נוספים לצמתים החריגים

קבצי הבסיס אינם אוסרים קובץ עזר ייחודי, בדיוק כפי שבדוגמת הספק יש חריגים לצומת מורכב.

| תיקייה | קובץ נוסף | מקור נוכחי / סיבה |
|---|---|---|
| `trigger-whatsapp-inbound` | `match.ts` | פונקציות התאמת keyword/kind/number מתוך `trigger.ts` |
| `trigger-webhook` | `match.ts` | התאמת endpoint מתוך `webhook-trigger.ts` |
| `trigger-schedule` | `match.ts` | `matchesSchedule` מתוך `schedule.ts` |
| `trigger-sumit-card` | `output-fields.ts` | `catalogue/sumit-card-output.ts`; נקי, ומיוצא דרך `definition.ts` |
| `trigger-sumit-card` | `sample-output.ts` | `catalogue/sumit-sample-output.ts` |
| `action-start-voice-call` | `outcome.ts` | `voice-outcome.ts`, אם לאחר בדיקת צרכנים הוא אכן ייחודי לצומת |

## 5. מה נשאר משותף

### נקי מספריית העורך

- `catalogue/types.ts`: רק טיפוסים וקבועים שבאמת משותפים לכמה צמתים: `KalfaNodeType`, `NodeStatus`, `ErrorPolicy`, `DeploymentBinding`, `ConditionalRequirement`, branch handles משותפים, `RUNNER_ERROR_PORT` והחוזים הגנריים. פרטי צומת יוצאים ממנו.
- `catalogue/nodes.ts`: registry בלבד. הוא מייבא `definition.ts` מכל 23 התיקיות ומייצר `CATALOGUE`; אין בו literals של צומת.
- `steps/shared.ts`: `WorkflowTriggerPayload`, `StepContext`, `StepHandler`, `readString`, `readEnum`, `requireGuestContext`.
- `engine/wait-signal.ts`: `WORKFLOW_WAIT_CODE`, `WorkflowWaitSignal`, `WaitVerifier`, `readWaitSignal`.
- `engine/node-budgets.ts`: resolver/validation של התקציב; פרופיל פר-צומת מגיע מה-definitions.
- `portability.ts`: האלגוריתם; bindings פר-צומת מגיעים מה-definitions.
- `arm-check.ts`: האלגוריתם וחוקים חוצי-גרף; required/conditional/range/guest-scope מגיעים מה-definitions.

### צד עורך

- `catalogue/schemas.ts`: aggregator בלבד של PaletteItems + `buildPaletteItems`; לא מחזיק schema של צומת ספציפי.
- shared editor helpers נשארים במודול משותף: `identityProperties`, `statusProperty`, `identityControls`, `statusControl`, `nodeStatusOptions`, `actionBranches`, `actionBranchesProperty`, `errorPolicyOptions`, `requiredText`, `triggerSwitchElement`, `withNodeRunControl`.
- `ui-formats.ts`: קבועי ה-format המשותפים.

### Registries

הטבלאות הבאות מפסיקות להיות רשימות ידניות של פרטי צומת והופכות ל-registries שנבנים מייבואים מפורשים:

- `CATALOGUE`
- `NODE_REQUIRED_FIELDS`
- `NODE_DEPLOYMENT_BINDINGS`
- `NODE_CONDITIONAL_REQUIRED_FIELDS`
- `NODE_NUMBER_RANGES`
- `GUEST_SCOPED_NODE_TYPES`
- `NODE_ACTIVITY_PROFILES`
- `PALETTE_ITEMS`
- `STEP_HANDLERS`

`KalfaNodeConfig` נשאר union מרכזי לצורך narrowing, אבל כל member type מיובא מ-`nodes/<name>/definition.ts`. יש להוסיף אליו את `StartVoiceCallConfig` לפני העברת הצומת.

## 6. תבניות

`templates.ts` אינו עובר לתיקיות הצמתים, משום שתבנית אחת מחברת כמה סוגי צמתים. כן מפצלים אותו לפי דפוס הספק:

```
catalogue/templates/
├── rsvp-by-keyword.ts
├── rsvp-with-reply.ts
├── ...
└── index.ts
```

כל קובץ מייצא `TemplateModel` אחד. ה-index כאן בטוח כי כל התיקייה היא צד עורך בלבד; האיסור על `index.ts` חל על תיקיות `nodes/*`, שבהן חיים יחד קוד עורך וקוד שרת.

## 7. תנאי מעבר לפני הצומת הראשון

לפני שמזיזים `logic-set-value`:

1. להוסיף guard של dependency-cruiser נגד `@workflowbuilder/sdk` ב-`definition.ts`, `runtime.ts`, `match.ts`, `steps/`, `engine/`, `adapter/` ו-worker.
2. להוציא את runtime helpers המשותפים מ-`steps/index.ts`.
3. לשכתב את source-scan tests כך שיסרקו glob ולא נתיב מונוליטי.
4. להוסיף `StartVoiceCallConfig` ולתקן את `KalfaNodeConfig` ל-23 מתוך 23.
5. לקבע בדיקה שכל definition מספק type, requiredFields, output fields ו-activity profile מפורש או default מפורש.
6. לבצע את ההעברה הראשונה בלי שינוי התנהגות, להריץ dependency guard, typecheck, tests ו-lint, ורק אז להמשיך לצומת הבא.
