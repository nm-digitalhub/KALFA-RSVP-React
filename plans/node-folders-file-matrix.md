# מטריצת מעבר לתיקייה לכל צומת

תאריך: 24.9.2026. בסיס: `feat/admin-integrations-consolidation` ב-HEAD `72ab238`.

המסמך הזה משלים ומתקן את `plans/node-folders-dependency-map.md`. הוא מסמך מיפוי בלבד; אין בו שינוי קוד.

> **סטטוס מימוש (24.9.2026, 08:41):** ההעברה הושלמה. כל 23 הצמתים נמצאים ב-`nodes/<folder>/`, והכול נשמר בגרסה (`f99836d`..`fd03b07`). היישום סטה מסעיפים 1–7 בכמה מקומות, וכל סטייה מנומקת. פירוט בסעיף 8 בסוף המסמך. הבנייה החיה האחרונה היא מ-02:53, לפני שהועבר הצומת השני, ולכן 22 ההעברות האחרונות **לא נפרסו**.

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

## 8. סטטוס מימוש

עודכן: 24.9.2026, 08:41. **ההעברה הושלמה: 23 מתוך 23 צמתים** נמצאים ב-`src/lib/workflow/nodes/<folder>/`. הכול **נשמר בגרסה** בענף `feat/admin-integrations-consolidation`, בטווח `f99836d`..`fd03b07`. בטווח הזה יש גם קומיט אחד שאינו חלק מההעברה, `6404eee` (`chore(deps): add @mastra/core`).

**פריסה:** הבנייה החיה ב-`.next/` וקובץ `dist/worker.cjs` הם מ-02:53. זה אחרי `a379a17` ולפני `20e6382`, כלומר תשתית וצומת 1 בלבד. 22 ההעברות הבאות, פיצול התבניות והתיקונים **לא נפרסו**. זה נמדד לפי זמני הקבצים; מה שרץ בפועל ב-pm2 לא נבדק.

### ההעברה לפי שלבים

השלבים הם השלבים של `plans/node-folders-dependency-map.md` §8. כל צומת הועבר בקומיט משלו, ואחרי כל שלב הגיע קומיט של תיקוני סקירה.

| שלב | צמתים | קומיטים של ההעברה | תיקוני סקירה |
|---|---|---|---|
| א — תשתית | — | `f99836d` (כלל ה-SDK, `steps/shared.ts`, `engine/wait-signal.ts`, סריקות glob). `3c814eb` השלים את החצי של `steps/index.ts` ואת `StartVoiceCallConfig`. `9d83f05` הוסיף את כלל `step-layer-reaches-only-pure-modules` | `a379a17` (חיזוק התבנית) |
| ב — לוגיקה והתראה | `logic.set_value`, `logic.condition`, `logic.switch`, `action.notify_team` | `3c814eb`, `20e6382`, `40e6ba3`, `a4687e7` | `9976f60` |
| ג — פעולות עם פורט | `action.webhook`, `action.sumit_create_customer`, `action.sumit_create_document`, `action.microsoft_send_email`, `action.ai_agent` | `3e71aa2` (ו-`7b6dc77`, הערה בלבד), `428ea8d`, `9bb9dc9`, `0ecb910`, `278363b` | `970719f` |
| ד — פעולות על אורח | `action.set_guest_field`, `action.create_callback_request`, `action.update_guest_status`, `action.send_whatsapp`, `action.send_template`, `action.start_rsvp_ai_callback`, `action.import_guest_list` | `179bcfc`, `094d0c5`, `89c4b18`, `57c72a2`, `2e73aac`, `17588dc`, `11cb969` | `ec97f67` |
| ה — השהיה ופיזור | `logic.wait`, `action.start_voice_call`, `action.start_for_each_guest` | `764e621`, `cf1d1f4` (ו-`8b8c245`, הערות בלבד), `5eac12e` | `1f11982` |
| ו — טריגרים | `trigger.schedule`, `trigger.webhook`, `trigger.sumit_card`, `trigger.whatsapp_inbound` | `adae165`, `612723a`, `143eae4`, `873712e` | `8e0d3a4` |

סך הכול 4 + 5 + 7 + 3 + 4 = 23 צמתים. אחרי כל קומיט העברה עברו `worker:deps`, `tsc`, `lint` ו-`npm test` המלא. תמונת המצב של הרישומים הושוותה ל-`baseline-before.json`, שצולם לפני ההעברה.

**אחרי ההעברה:**
- **פיצול התבניות** (`499e191`), לפי §6: `catalogue/templates.ts` נמחק. במקומו יש `catalogue/templates/` עם 13 קובצי תבנית, `index.ts` ו-`shared.ts`. `DIAGRAM_TEMPLATES` זהה בתו.
- **ניקוי הערות** (`86c6d19`): תיקון הערות שההעברה הפכה ללא נכונות. הוחלפה גם סריקת ה-palette שלא יכלה עוד למצוא דבר. אחרי הסרת ההערות, הקוד זהה חוץ מ-`schemas.ts`, שבו הוסר re-export של ערכים שאיש מחוץ לבדיקות לא קרא.
- **תיקוני הביקורת הסופית** (`fd03b07`): פירוט בהמשך.

### ביקורת סופית ושערים

ארבע ביקורות רצו על `86c6d19` בקריאה בלבד. אחריהן בא קומיט התיקונים `fd03b07`.

**1. מונוליטים ומחרוזות סוג (עבר):**
- סריקת AST של 1,134 קובצי קוד (לא בדיקות) ב-`src/` וב-`worker/` לא מצאה אף מחרוזת של 23 הסוגים מחוץ ל-`nodes/*/definition.ts` ול-`catalogue/templates/*.ts`, לא בהתאמה מלאה ולא בחלקית.
- שם כל תיקייה שווה ל-`type.replace(/[._]/g, '-')`.
- `nodes.ts`, `steps/index.ts`, `node-budgets.ts`, `schemas.ts` ו-`types.ts` הם רישומים שקוראים מההגדרות. ב-`NODE_ACTIVITY_PROFILES` יש 15 רשומות, ו-8 הסוגים החסרים מצהירים `'default'`.
- בכל 23 התיקיות יש ששת קובצי הבסיס ואין `index.ts`. אף `definition.ts` לא מייבא דבר.
- גבולות הייבוא נקיים: אף קובץ לא מייבא מתיקייה של צומת אחר.
- **חריג:** `arm-check.ts` עדיין מחזיק כללים של צומת בודד. ראו "ידוע ולא טופל".

**2. שלמות מול התוכנית (עבר):**
- חסר דבר שהתוכנית מחייבת: לא נמצא.
- 23 גופי המטפלים, ארבע פונקציות ההתאמה של וואטסאפ ו-webhook ו-`matchesSchedule` זהים ל-`72ab238` אחרי נרמול. ההבדלים היחידים הם שינויי טיפוס מתועדים.
- מחרוזות הסוג וסדרן, ידיות הענפים, `requiredFields`, התקציבים, קבוצת האורח, טווחי המספרים ושני הכללים המותנים זהים ל-`72ab238`.

**3. סקירת `499e191` ו-`86c6d19` (נכשלה, ותוקן):**
- אין שינוי התנהגות. 49 ההצהרות העליונות של `templates.ts` הישן זהות להצהרות בקבצים החדשים, ו-13 רשומות `DIAGRAM_TEMPLATES` זהות ובאותו סדר.
- **חוסם אחד:** סריקת `palette-defaults` שנכתבה מחדש ב-`86c6d19` לא תפסה עוד רשומה שהוחלפה ב-literal, וההערה שלה טענה יותר ממה שנבדק. תוקן ב-`fd03b07`.

**4. שערים (עבר, על `86c6d19`):**
- `npx tsc --noEmit`: יציאה 0. `npm run lint`: יציאה 0, אפס בעיות.
- `npm test`: 477 קבצים עברו ו-3 דולגו; 7,165 בדיקות עברו ו-23 דולגו.
- `npm run worker:deps`: נקי (691 מודולים).
- **בנייה** ל-`.next-verify` (`.next/` לא נגע): בכל 327 המצביעים הריקים (client reference) יש 195 מקורות שונים. כולם תחת `src/app`, `src/components` או שלוש חבילות ב-`node_modules`. **אפס תחת `src/lib`.**
- **חבילת המנוע** נבנתה לתיקיית העבודה (`dist/` לא נגע): 7,445,797 בתים. אין בה אף פגיעה של `@workflowbuilder/sdk` או של `catalogue/templates`.
- **תמונת מצב של הרישומים** מול `baseline-before.json`: 11 מתוך 11 ההבדלים המותרים, אפס הבדלים לא צפויים. ההבדלים המותרים הם `.bindings.<type>`, שהיה חסר והפך ל-`{}`, ב-`logic.set_value`, `logic.condition`, `logic.switch`, `action.notify_team`, `action.set_guest_field`, `action.update_guest_status`, `action.send_whatsapp`, `action.start_rsvp_ai_callback`, `action.import_guest_list`, `logic.wait` ו-`trigger.schedule`. לייצוא אין בזה הבדל: `portability.ts` מחזיר את הצומת כמות שהוא בשני המקרים.
- **תמונת מצב של התבניות:** זהה בתו ל-`templates-before.json` (50,982 בתים). הבסיס הזה צולם ב-07:38, אחרי העברות הצמתים, ולכן הוא מוכיח רק שהפיצול לא איבד דבר. על העברות הצמתים שומרות בעקיפין תמונת הרישומים, `templates.test.ts` ו-`references.test.ts`.
- **תקלות מכוונות a–h** (כל אחת שוחזרה מ-`.bak` ואומתה ב-`cmp`, וקבצים שנוצרו נמחקו):
  - נתפסו: a (ייבוא SDK ב-`runtime.ts`), b (ייבוא type-only של SDK ב-`definition.ts`), c (`createAdminClient` ב-`runtime.ts`), e (`runtime.ts` הוזז), g (ייבוא ממערכת הסליקה ב-`runtime.ts` ובקובץ עזר שאיש לא מייבא).
  - f (`isTrigger` הפוך): נתפס רק בחבילה המלאה. הבדיקה של `node-definitions.test.ts` הייתה ריקה מתוכן, כי השוותה את הקטלוג לאותה הגדרה שממנה הוא נבנה.
  - **לא נתפסו:** d (`index.ts` זר בתיקיית צומת) ו-h (החלפת סדר ב-`DIAGRAM_TEMPLATES`).

**5. תיקוני הביקורת הסופית (`fd03b07`):**
- `triggerKeywordCanNeverMatch` עבר מ-`catalogue/types.ts` ל-`nodes/trigger-whatsapp-inbound/match.ts`. `arm-check.ts` מייבא אותו משם, כמו את `webhookAllowsMethod`.
- `WEBHOOK_AUTH_MODES` עבר ל-`nodes/trigger-webhook/definition.ts`, כפי ששורה 2 במטריצה קבעה. `WebhookAuthMode` נגזר עכשיו מההגדרה, ולכן בדיקת הקומפילציה הדו-כיוונית נעשתה טאוטולוגית והוסרה. ב-`types.ts` נשארו שתי בדיקות סחיפה.
- JSDoc של `NODE_DEPLOYMENT_BINDINGS` קוצר להפניה, כי כל הגדרה מתעדת את ה-bindings שלה (הערה בלבד).
- `voice-call-with-outcome.ts` מתאר את הענף במקום לצטט את `voice-purpose-dispatch.ts:172`, שהייתה שורה שגויה (הערה בלבד).
- `palette-defaults.test.ts`: כל רשומה ב-`PALETTE_ITEMS` חייבת להיות, לפי זהות, הפריט שקובץ ה-palette של התיקייה שלה מייצא. תקלה מכוונת (`{ ...setValuePaletteItem }`) נכשלת.
- `node-definitions.test.ts`: `isTrigger` מושווה ל-`folder.startsWith('trigger-')`, ותיקייה אסורה להכיל `index.ts` או `index.tsx`. תקלות f ו-d נכשלות עכשיו.
- **שערים על `fd03b07`:**
  - `worker:deps` נקי (691 מודולים). `tsc` ו-`lint`: יציאה 0.
  - vitest ממוקד: 114 קבצים, 2,084 בדיקות. `npm test`: 477 קבצים; 7,189 בדיקות עברו ו-23 דולגו.
  - `npm run build` ל-`.next-verify`: יציאה 0 (BUILD_ID 08:36:32). אפס מצביעים ריקים תחת `src/lib/`. בקורת החיובית נמצאו 156 מצביעים תחת `src/components/`.
  - תמונת הרישומים: רק 11 ההבדלים המותרים, וזהה בתו לתמונה של `86c6d19`. `DIAGRAM_TEMPLATES` זהה בתו.

### סטיות מהתוכנית

כל סטייה מסעיפים 1–7, והסיבה לה מתוך הודעת הקומיט.

**קבצים מסעיף 4 שלא נוצרו:**
- **`trigger-schedule/match.ts` לא נוצר** (`adae165`). `matchesSchedule` צריך את `israelSlot` ואת `israelWeekday`, ש-`planScheduledRuns` משתמש בהם גם הוא. העברת הפונקציה לבדה הייתה יוצרת מעגל ייבוא. בנוסף, הם תלויים ב-`ISRAEL_TIME_ZONE` מ-`@/lib/date`, שאינו ברשימה הלבנה של `step-layer-reaches-only-pure-modules`. הקוד נשאר ב-`schedule.ts`.
- **`trigger-webhook/match.ts` מחזיק רק את בדיקת ה-method** (`612723a`), כלומר את `webhookAllowsMethod`, שהגיע מ-`types.ts`. התאמת ה-endpoint וה-hash נשארת ב-`findWorkflowForEndpoint` שב-`webhook-trigger.ts`. זה תיאום שמשותף ל-`trigger.sumit_card`, ו-`webhook-token.ts` אינו ברשימה הלבנה.
- **`trigger-sumit-card/output-fields.ts` לא נוצר** (`143eae4`). `catalogue/sumit-card-output.ts` **נמחק**, ותוכנו (`SUMIT_CARD_BASE_OUTPUT`, `SUMIT_HOLD_FIELDS_OUTPUT` והטיפוסים) הוטמע ישירות ב-`nodes/trigger-sumit-card/definition.ts`. הסיבה: `definition.ts` לא מייבא דבר, וקובץ נפרד היה מחייב ייבוא או העתק.
- **`trigger-sumit-card/sample-output.ts` לא נוצר** (`143eae4`). `sumit-sample-output.ts` מייבא את חבילת `flat`, שאינה ברשימה הלבנה. עותק ניסיוני בתיקייה הכשיל את `worker:deps`, ולכן הקובץ נשאר ב-`catalogue/`. הוא קורא את שדות הפלט מההגדרה.
- **`action-start-voice-call/outcome.ts` לא נוצר** (`cf1d1f4`). ל-`voice-outcome.ts` יש צרכן נוסף (`voice-outcome.test.ts`), והוא מופיע בשמו ברשימה הלבנה.
- **`trigger-whatsapp-inbound/match.ts` מכיל יותר ממה שתוכנן:** `matchesKeyword`, `matchesKind` ו-`matchesNumber` מ-`trigger.ts` (`873712e`), ו-`triggerKeywordCanNeverMatch` מ-`types.ts` (`fd03b07`). `trigger.ts` מייצא אותם מחדש, ו-`planRuns`, `findTriggerNode` ו-`buildTriggerPayload` נשארו בו.

**שורות בטבלה בסעיף 3:**
- שורה 1: `triggerSchemaFor` לא נשאר בשמו. הוא עבר ל-`nodes/trigger-whatsapp-inbound/schema.ts` בשם `whatsappInboundSchemaFor` (`873712e`).
- `NODE_DEPLOYMENT_BINDINGS`: 11 צמתים שלא היו להם רשומות מצהירים עכשיו `{}` במפורש (`a379a17` והלאה). זה ההבדל היחיד בתמונת המצב של הרישומים.

**מה שנשאר משותף (סעיף 5) בפועל:**
- **`editor-shared.ts`** מחזיק את העזרים שבסעיף 5, ובנוסף `conditionalRules` (`3e71aa2`) ו-`rsvpStatusOptions` (`89c4b18`). `withNodeRunControl` **נשאר ב-`schemas.ts`** ולא עבר למודול המשותף. רק `buildPaletteItems` משתמש בו.
- **`catalogue/types.ts`** עדיין מחזיק פרטים של צומת בודד שיש להם קוראים אחרים:
  - `FORBIDDEN_HTTP_HEADERS` ו-`MAX_CAPTURED_RESPONSE_BYTES` של `action.webhook`. רק הפורט קורא אותם (`3e71aa2`).
  - `LEGACY_PROPERTY_ALIASES`, כי `arm-check.ts` קורא אותו (`89c4b18`).
  - `readWebhookAuthMode`, `authModeFor` ו-`INBOUND_HTTP_TRIGGER_TYPES`, כי שני טריגרי ה-HTTP משתמשים בהם (`612723a`, `fd03b07`).
  - re-exports של טיפוסים וקבועים מההגדרות, בשביל קוראים קיימים (`engine/ports.ts`, `guest-actions.ts`, `outbound-webhook.ts`, התבניות והבדיקות).
- **`arm-check.ts`** עדיין מחזיק כללי חימוש של צומת בודד. הם משווים עכשיו לסוג שמגיע מההגדרה ולא ל-literal: נושא המכירות של בקשת חזרה (`094d0c5`), כללי ה-address וה-GET של ה-webhook (`612723a`), משפטי `blankMessage` (`cf1d1f4`) ופיזור עצמי ויעד ריק של `for_each` (`5eac12e`).
- **`buildPaletteItems`** ב-`schemas.ts` שומר ארבע החלפות בזמן טעינה, לוואטסאפ, SUMIT, Microsoft והשיחה הקולית, כפי שסעיף 5 מתיר. כל אחת מזהה את הצומת לפי הסוג שבהגדרה שלו.

**כללים ופרטים אחרים:**
- **`readEnum`** נשאר בלי גרסה מוקלדת. רק `readString` קיבל overload מוקלד (`a379a17`), וכל ה-runtimes שקוראים מפתח literal משתמשים בו.
- **`catalogue/templates/shared.ts`** הוא בלי `'use client'`, בכוונה (`499e191`). הוא לא מייבא דבר ומחזיק שתי מחרוזות, וההוראה הייתה הופכת אותן למצביעים ריקים אצל מייבא בשרת. שאר הקבצים בתיקייה הם `'use client'`.
- **כלל 7 בסעיף 2** מיושם רחב יותר ממה שנכתב: הסריקות קוראות כל קובץ קוד בתיקיית צומת, רקורסיבית, ולא רק `runtime.ts` ו-`definition.ts` (`a379a17`).

### תנאי המעבר מסעיף 7

| # | תנאי | סטטוס | איפה |
|---|---|---|---|
| 1 | guard נגד `@workflowbuilder/sdk` בקוד שרת | ✅ בוצע | `.dependency-cruiser.cjs`, כלל `server-code-must-not-reach-the-editor-sdk`. מכסה את `worker/`, `steps/`, `engine/`, `adapter/`, `nodes/*/(definition\|runtime\|match).ts`, `catalogue/(types\|nodes\|arm-check).ts` ו-`src/lib/(data\|queue\|ops)/`. נאכף על שם החבילה, כולל ייבוא type-only. הכלל הישן על `schemas.ts` נשאר. |
| 2 | הוצאת עזרי runtime משותפים | ✅ בוצע | `steps/shared.ts`: `WorkflowTriggerPayload`, `StepContext`, `StepHandler`, `readString`, `readEnum`, `requireGuestContext`. `engine/wait-signal.ts`: `WORKFLOW_WAIT_CODE`, `WorkflowWaitSignal`, `WaitVerifier`, `readWaitSignal`. `steps/index.ts` מייצא אותם מחדש לקוראים הקיימים. |
| 3 | בדיקות source-scan על glob | ✅ בוצע | `src/lib/workflow/node-sources.ts` + `guest-context`, `ai-agent`, `sumit-accounting`, `palette-defaults`. כל סריקה נכשלת אם יש תיקיית צומת בלי `runtime.ts`. |
| 4 | `StartVoiceCallConfig`, `KalfaNodeConfig` 23/23 | ✅ בוצע | `catalogue/types.ts`, עם בדיקת קומפילציה `_KALFA_NODE_CONFIG_COVERS_ALL_TYPES`. |
| 5 | בדיקה שכל definition מספק type, requiredFields, output fields ו-activity profile | ✅ בוצע | `src/lib/workflow/node-definitions.test.ts`: עובר על כל תיקייה תחת `nodes/`, ובודק שהקובץ לא מייבא כלום, שהסוג מוכר ותואם לשם התיקייה, ש-isTrigger תואם לקטלוג (**הבדיקה הזאת הייתה ריקה מתוכן**, כי הקטלוג נבנה מאותה הגדרה. מאז `fd03b07` הערך מושווה גם ל-`folder.startsWith('trigger-')`), ש-`NODE_REQUIRED_FIELDS`, `NODE_ACTIVITY_PROFILES` ו-outputSchema של הלוח הם **אותו אובייקט** כמו בהגדרה, ושיש מטפל רשום. תקציב חייב להיות מפורש: אובייקט, או `'default'`. הוכח ב-3 תקלות מכוונות. |
| 6 | העברה ראשונה בלי שינוי התנהגות | ✅ בוצע | ראו למטה. |

### צומת 1: `logic.set_value` ✅

> היסטוריה: הסעיף הזה, "מה נמצא ותוקן בדרך", "חיזוק אחרי סקירה" ו"אירוע במהלך העבודה" מתעדים את צומת 1 כפי שנכתבו ב-01:50 וב-02:35, ולא עודכנו למצב הסופי. המצב הנוכחי של הפריטים הפתוחים מופיע ב"ידוע ולא טופל".

- **קבצים:** `src/lib/workflow/nodes/logic-set-value/`:
  - `definition.ts` (58 שורות, לא מייבא כלום)
  - `schema.ts`, `uischema.ts`, `default-properties-data.ts`, `logic-set-value.ts` (צד עורך, `'use client'`)
  - `runtime.ts` (צד שרת)
  - אין `index.ts`.
- **קובץ עזר משותף חדש לעורך:** `catalogue/editor-shared.ts`, עם `nodeStatusOptions`, `statusProperty`, `requiredText`, `identityProperties`, `statusControl` ו-`identityControls`. נדרש כדי למנוע מעגל ייבוא בין `schemas.ts` לתיקיית הצומת.
- **רישומים שקוראים עכשיו מ-`definition.ts`:** `NODE_TYPES`, `KalfaNodeConfig`, `NODE_REQUIRED_FIELDS` (אותו אובייקט בדיוק), `CATALOGUE`, `NODE_ACTIVITY_PROFILES`, `PALETTE_ITEMS` (באותו אינדקס) ו-`STEP_HANDLERS`. הטקסט `'logic.set_value'` מופיע בקוד רק ב-`definition.ts`.
- **אימות:**
  - תמונת מצב של הלוח, שדות החובה, הסוגים, הקטלוג, התקציבים והמטפלים לפני ואחרי: זהות בתו.
  - 7 תקלות מכוונות (ייבוא SDK ישיר, עקיף ו-type-only, `child_process`, ייבוא מערכת הסליקה, הסתרת `runtime.ts`, `satisfies` כפול): כולן נתפסו.
  - `npm test` (6,910 בדיקות), `tsc`, `lint`, `worker:deps` ו-`npm run build`: עוברים.
  - בבנייה אין מצביע ריק (client reference) לאף חלק מהצומת או מ-`editor-shared.ts`.
  - לא נדרש migration לתרשימים שמורים או לתבניות.
- **סטטיסטיקה:** 13 קבצים קיימים השתנו (194+, 622-), ועוד 11 קבצים חדשים.

### מה נמצא ותוקן בדרך

- **בדיקת מערכת הסליקה** לא זיהתה ייבוא ללא `from`, כמו `import '…sumit…'`. תוקן, והוכח בתקלה מכוונת.
- **6 הערות** שהפכו ללא נכונות בעקבות ההעברה תוקנו.

### חיזוק אחרי סקירה (24.9.2026, 02:35)

שלושה ממצאים של סקירה חיצונית אומתו מול הקוד ותוקנו:
- **סריקת המקורות** קוראת עכשיו רקורסיבית את **כל** קובצי הקוד בתיקיית צומת, חוץ מבדיקות, ולא רשימה קבועה של שלושה שמות. הוכח: קובץ עזר שמפעיל תהליך, ותת־תיקייה שמייבאת ממערכת הסליקה, נתפסים.
- **שמות שדות בטוחים:** `readString<SetValueConfig>(config, 'value')`. שם שדה שלא קיים בסוג ההגדרות, או שאינו טקסט, הוא שגיאת קומפילציה. ההגדרות עצמן נשארות `Record<string, unknown>`, כי הן לא עברו אימות. הוכח בבדיקת טיפוסים (`steps/shared.test.ts`) ובתקלה מכוונת. **ידוע:** 22 הצמתים האחרים עדיין קוראים בלי סוג, וכל צומת יעבור לזה כשיועבר לתיקייה.
- **`deploymentBindings = {}` מפורש** ב-`definition.ts`, ו-`NODE_DEPLOYMENT_BINDINGS` קורא ממנו. `node-definitions.test.ts` דורש שהמפתח יהיה קיים. זה ההבדל היחיד בתמונת המצב, ובייצוא הוא לא משנה דבר (`portability.ts:95-126`).
- **אימות:** 6,922 בדיקות, `tsc`, `lint`, `worker:deps` ובנייה מלאה עוברים.
- **נסגר גם הפער האחרון:** כלל תלויות חדש, `step-layer-reaches-only-pure-modules` ב-`.dependency-cruiser.cjs`, עובד כרשימה לבנה. `steps/` וכל קובץ בתיקיית צומת, חוץ מארבעת קובצי העורך, רשאים להגיע, ישירות או בעקיפין, רק למודולים הטהורים שנמדדו (`catalogue/types`, `engine/ports`, `engine/wait-signal`, `vendor/workflowbuilder`, `voice-outcome`, `constants`, `integrations/errors`, `sumit/hold-status`, `steps/` וקובצי צמתים שאינם עורך). זה תואם לדפוס ה-ports-and-adapters של הספק: כל I/O עובר דרך `ctx.deps`. הוכח ב-3 תקלות מכוונות: קובץ מחוץ לתיקייה שמפעיל תהליך, מודול מסד נתונים ומודול מערכת ישיר. כל השלוש נחסמו.

### ידוע ולא טופל (מחוץ לתחום ההעברה)

**נסגר מאז צומת 1:**
- ההפניה ל-`armNoticeControl` וה-"18 entries" ב-`editor-shared.ts` תוקנו ב-`86c6d19`. הכותרת של `schemas.ts` נכתבה מחדש ב-`8e0d3a4`.
- "22 הצמתים האחרים קוראים בלי סוג": כבר לא נכון. אין אף קריאה לא מוקלדת של `readString` ב-`nodes/*/runtime.ts`. 14 runtimes קוראים דרך `readString<Config>`. `readEnum` נשאר לא מוקלד.
- תקלות מכוונות d ו-f נתפסות מאז `fd03b07`.

**פערים בשמירה, שהתוכנית לא הבטיחה:**
- **סדר `DIAGRAM_TEMPLATES`** (תקלה h): אין בדיקה שמורה בגרסה שמקבעת אותו. רק ה-probe הזמני תופס החלפת סדר. הצעה: snapshot של `DIAGRAM_TEMPLATES.map(t => t.name)`.
- **כלל ה-SDK** (`server-code-must-not-reach-the-editor-sdk`) לא מכסה את `webhook-trigger.ts`, `manual-run.ts`, `trigger.ts`, `schedule.ts`, `inbound.ts`, `enqueue.ts`, `portability.ts`, `outbound-webhook.ts` ואת `src/app`. §7.1 מנה בדיוק את הנתיבים שכן מכוסים. נמדד: depcruise על כל אחד משמונת המודולים לא מגיע ל-SDK או לקובצי עורך (0 התאמות לכל אחד; בקורת החיובית, קובץ ה-palette של `trigger-webhook`, יצאו 13). כלומר זה פער ולא תקלה חיה. הצעה: להרחיב את ה-`from` של הכלל, או להוסיף את `src/lib/queue` ואת `src/lib/ops` לשורשים של `worker:deps`.
- `check-worker-bundle.mjs` לא מחפש את ה-SDK בחבילת המנוע. הבדיקה נעשתה ידנית בביקורת הסופית.
- `NODE_CONDITIONAL_REQUIRED_FIELDS` לא מקובע לפי זהות ב-`node-definitions.test.ts`, בשונה מ-`NODE_NUMBER_RANGES`.

**מבנה, הצעה לשלב הבא:**
- כללי חימוש של צומת בודד עדיין יושבים ב-`arm-check.ts` (ראו "סטיות מהתוכנית"). הכיוון: predicates או נתונים פר צומת, בתיקייה של הצומת. זה לא נעשה, כי ההעברה הייתה אמורה להיות בלי שינוי התנהגות.

**כפילויות שהיו גם קודם:**
- התווית והתיאור של כל צומת כתובים פעמיים, ב-PaletteItem ובברירות המחדל.
- שמות שדות הפלט כתובים גם ב-`definition.outputFields` וגם ב-`runtime.ts` שכותב אותם. `references.test.ts` מגן על התבניות.

**הערות שגויות שנמצאו ולא תוקנו:**
- `catalogue/types.ts` (סביב שורה 88): ההערה על ה-re-exports של סוגי הודעות הוואטסאפ מונה את `arm-check.ts` בין הקוראים. `arm-check.ts` לא מייבא אף אחד מהם, וההערה הייתה שגויה עוד לפני ההעברה.
- `catalogue/templates/voice-call-with-outcome.ts:106` מצטט את `resolve-template.ts:127`. בפועל ה-`throw` של `Unresolved template reference` נמצא בשורה 131.

**לא אומת:**
- אין בדיקה בדפדפן או בזמן ריצה של העורך על העץ הסופי, כי הוא לא נפרס.
- התקלות שב-`plans/node-folders-dependency-map.md` §7, חוץ מ-§7.3, לא טופלו במסגרת ההעברה, שלא שינתה התנהגות.

### אירוע במהלך העבודה

פריסה לבטא הורצה ב-01:14, באמצע העריכות, ובטא ומנוע התהליכים רצו זמנית מגרסת ביניים. לא נמצאו שגיאות. פריסה חוזרת מהמצב הסופי ב-01:42 פתרה את זה. **לקח:** לתאם פריסות עם עבודה פעילה על העץ.

### הצעדים הבאים

**אין צמתים להעביר. ההעברה הושלמה.** מה שנשאר פתוח, וכל פריט דורש אישור של הבעלים:

1. **פריסה לבטא** של `f99836d`..`fd03b07`, ואחריה בדיקה בדפדפן של העורך: הלוח, הטפסים, רשימות הבחירה החיות (וואטסאפ, SUMIT, Microsoft, השיחה הקולית) והתבניות.
2. **מיזוג** הענף.
3. **שמירה**, לפי בחירה: snapshot לסדר `DIAGRAM_TEMPLATES`, הרחבת כלל ה-SDK לנתיבים שלא מכוסים, ובדיקת SDK ב-`check-worker-bundle.mjs`.
4. **מבנה:** העברת כללי החימוש של צומת בודד מ-`arm-check.ts` לתיקיות הצמתים.
5. **תיקון שתי ההערות השגויות** שנמנו למעלה.

