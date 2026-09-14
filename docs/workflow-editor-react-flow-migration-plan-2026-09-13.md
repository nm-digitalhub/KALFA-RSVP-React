# החלפת שכבת העורך: מ-@workflowbuilder/sdk ל-React Flow

**תאריך:** 2026-09-13 · **סטטוס:** תוכנית, לא אושרה לביצוע · **ענף:** `feat/admin-integrations-consolidation`

> **תיוג ראיות.** כל טענה מסומנת **MEASURED** (נמדד בקוד או ב-DB החי, עם מיקום) או
> **INFERRED** (הסקה סבירה שלא נמדדה). אין בין השתיים ערבוב.

---

## 0. תקציר בשורה אחת

התפר שההצעה דורשת **כבר קיים בקוד**. ה-runner, ה-adapter וה-steps אינם מכירים את
ה-SDK כלל. מה שמוחלף הוא 3,362 שורות של UI; מה שנשאר הוא 2,336 שורות של הלוגיקה
שעלתה הכי הרבה לבנות.

**אבל הדחיפות אינה ב-React Flow.** הפריט היחיד שנסגר חלון ההזדמנות שלו הוא צורת
חוזה ההפניות (§3), והוא אינו דורש React Flow בכלל.

---

## 1. מה נמדד

### 1.1 טביעת הרגל של ה-SDK

**MEASURED** (`grep -rln "from '@workflowbuilder/sdk'" src/`): **שבעה** קבצים שאינם
בדיקות, כולם שכבת עורך. (`workflow-editor.tsx` תורם שתי שורות `import` — המודול
וגיליון הסגנון — ולכן ספירה לפי שורות מראה שמונה.)

| קובץ | שכבה |
|---|---|
| `app/(admin)/admin/workflows/[id]/workflow-editor.tsx` | UI |
| `…/app-bar.tsx` · `…/highlighting.tsx` · `…/log-panel.tsx` · `…/node-markers.tsx` | UI |
| `lib/workflow/catalogue/schemas.ts` | פלטה (client-only) |
| `lib/workflow/catalogue/templates.ts` | תבניות (client-only) |
| `catalogue/branch-handles.test.ts` · `i18n-he.test.ts` | בדיקות |

**MEASURED:** `adapter/to-definition.ts`, `catalogue/types.ts` ו-`catalogue/nodes.ts`
מזכירים את ה-SDK **בהערות בלבד**. אין בהם שורת `import`.

זה לא מקרי. `catalogue/types.ts:5-9` מתעד למה: ה-worker חייב לא לטעון את ה-SDK,
שכן הייבוא שלו מריץ `immer.setAutoFreeze(false)` ו-`i18next.init` ברמת מודול.

### 1.2 החשבון בשורות

**MEASURED** (`wc -l`):

| | שורות | מה |
|---|---|---|
| **נכתב מחדש** | **3,362** | `schemas.ts` 1,017 · `templates.ts` 677 · תשעה קובצי UI 1,668 |
| **נשאר** | **2,336** | `steps/index.ts` 588 · `types.ts` 435 · `to-definition.ts` 384 · `trigger.ts` 266 · `activity-runner.ts` 241 · `run-workflow.ts` 218 · `inbound.ts` 157 · `nodes.ts` 47 |

הניסוח "מחליפים בעיקר את שכבת העורך" מדויק במהות ולא בנפח: מדובר ב-59% מהשורות,
אבל בחלק הקל — JSON Schema, uischema ו-React, לא לוגיקת ריצה.

### 1.3 התשתית כבר מותקנת

**MEASURED** (`package.json`): `@xyflow/react@^12.11.6` ו-`zustand@^5.0.15` כבר
ב-`dependencies` — הותקנו כ-peer deps של ה-SDK. אין צעד התקנה.

### 1.4 מה שנייבא מה-SDK, לפי תדירות

**MEASURED** (ספירת מופעים): `getHandleId` 16 · `NodeType` 14 · `sharedProperties` 13 ·
`getScope` 13 · `Icon` 12 · `useStore` 11 · `statusOptions` 11 · `WorkflowBuilder` 9 ·
`registerComponentDecorator` 7 · `useSingleSelectedElement` 6.

מאחורי השמות האלה שלוש מערכות שלמות, ו-React Flow אינו נותן אף אחת מהן:

1. **JsonForms** — `sharedProperties` + `getScope` הם מנוע פאנל המאפיינים. 1,017
   השורות ב-`schemas.ts` נשענות עליו.
2. **`VariableText`** — פקד בחירת המשתנה. **MEASURED:** בשימוש ב-13 מקומות
   ב-`schemas.ts`. זה בדיוק ה-picker שההצעה מבקשת לבנות — והוא קיים ועובד היום.
3. **`registerComponentDecorator`** — מערכת ה-plugins שדרכה מוזרקים סמני ההרצה
   (`node-markers.tsx`) וכפתורי ה-app bar.

---

## 2. שלוש טענות בהצעה — מול הקוד

### 2.1 ✅ בעיית ה-UUID אמיתית

**MEASURED** (`vendor/workflowbuilder/execution-core/graph-runner.ts:134`):

```ts
nodeOutputs[result.node.id] = result.output;
```

ה-`id` הוא UUID שהעורך מייצר. כלומר היום, כדי להפנות לפלט של צומת, בעל האירוע חייב
להקליד:

```
{{nodes.550e8400-e29b-41d4-a716-446655440000.status}}
```

הצעת ה-`key` הנפרד (`id` למסד ול-React Flow, `key` לבני אדם) פותרת בדיוק את זה.

### 2.2 ✅ מערכת המשתנים כבר בנויה

**MEASURED** (`execution-core/templates/resolve-template.ts:94-103`): ארבעת
ה-namespaces שההצעה מתארת — `nodes`, `trigger`, `variables`, `global` — כבר
ממומשים ב-resolver המועתק, ו-`ExecutionContext` נושא את כל ארבעתם.

מה שחסר הוא ה-**picker UI** וה-**key הקריא**, לא המנוע.

### 2.3 ⚠️ ה-validation כבר קיים — אין לבנות אותו מחדש

**MEASURED:** ה-adapter (`to-definition.ts`) אוכף **שמונה כללים** שמתועדים
ב-`docs/workflow-editor-plan-2026-09-09.md §3`, ו-`arm-toggle.tsx:28` מציג את
השגיאות בעברית לפני ההפעלה.

הרשימה בהצעה מול מה שקיים:

| בהצעה | מצב |
|---|---|
| טריגר חסר | ✅ כלל 4 |
| קשת נכנסת לטריגר | ✅ כלל 6 |
| צומת יתום | ✅ כלל 7 |
| סוג צומת לא מוכר | ✅ כלל 5 |
| הפניה לצומת שלא קיים | ✅ (`'קיים חיבור אל צעד שאינו קיים בתהליך.'`) |
| **משתנה לא קיים** | ❌ חסר — נתפס בזמן ריצה כ-`PermanentNodeExecutionError` |
| **הפניה לצומת שאחרי הנוכחי** | ❌ חסר |
| **שדה output שלא קיים** | ❌ חסר |
| לולאה אסורה | **INFERRED** — `runGraph` טופולוגי; לא אומת |

שלושת החסרים הם **validation של הפניות**, וניתן לבנות אותם **היום, בלי React Flow**.

---

## 3. הפריט הדחוף — ואינו דורש React Flow

### הממצא

**MEASURED** (שאילתה על `workflows` ב-DB החי, 13.9):

```
uses_trigger_refs: 0    uses_node_refs: 0    with_diagram: 4    total: 20
```

**אפס תהליכים שמורים מכילים `{{trigger.` או `{{nodes.`.**

### למה זה קובע את סדר העדיפויות

`trigger.ts` מתעד את צורת ה-payload כך:

> *"`{{trigger.…}}` names exactly these keys, so the snake_case is a contract with every
> saved workflow — not a style choice — and renaming one breaks references an owner
> already typed."*

**החוזה הזה ריק כרגע.** המעבר מהצורה השטוחה:

```ts
{ eventId, contactId, message_text, button_payload, guest_name?, event_name?, event_date? }
```

לצורה המקוננת שההצעה מתארת:

```ts
{ event: { id, name, date }, contact: { id, firstName, lastName, phone }, message: { text, buttonPayload } }
```

הוא היום שינוי **בלי שום נפגע**. ברגע שייבנה תהליך אמיתי אחד עם הפניה — הוא הופך
לשינוי שובר שדורש מיגרציה של jsonb.

**המלצה:** לבצע את §3 בנפרד ולפני כל דיון ב-React Flow.

### מה שצריך להשתנות יחד

**MEASURED** — כל מי שבונה את ה-payload חייב לעבור יחד, אחרת תהליך שקורא
`{{trigger.contact.firstName}}` יקבל ריק בהפעלה ידנית:

- `trigger.ts` — `TriggerPayload` + `buildTriggerPayload`
- `steps/index.ts` — `WorkflowTriggerPayload`
- `manual-run.ts` — נתיב ההפעלה הידנית
- `engine/dry-run.ts` — התרחיש
- `catalogue/types.ts` — `CONDITION_FIELDS` (היום שבעה מפתחות שטוחים)

---

## 4. המסלול המוצע

### שלב A — חוזה ההפניות (בלי React Flow)

1. `TriggerPayload` מקונן, בכל חמשת המקומות מ-§3.
2. `key` לצד `id` על כל צומת; ה-adapter ממפה `nodeOutputs` לפי `key`.
3. **מיפוי פלט מפורש** — הצעד מחזיר מה שהוא רוצה פנימית, וה-runner ממפה ל-`outputSchema`
   המוצהר לפני שהפלט נכנס ל-`nodeOutputs`. החוזה הציבורי הוא `outputSchema`, לא
   המבנה הפנימי.
4. שלושת ה-validations החסרים מ-§2.3.

**שער:** `lint` · `tsc` · `worker:deps` · `build` · הסוויטה המלאה · הרצה יבשה של
ארבע התבניות.

### שלב B — עורך מקביל

`/admin/workflows/[id]/editor-v2`, על **אותו** `workflow schema` ואותו runner.

**MEASURED — ולמה זה עובד דווקא כך:** `README` של ה-SDK מצהיר על **mount יחיד
לעמוד** (singletons של zustand, i18next, immer). שני עורכים באותו עמוד היו מתנגשים
בשקט — אבל **שני routes נפרדים** אינם בעיה. ההצעה לבנות במקביל היא לא רק בטוחה, היא
הדרך היחידה.

מה שנבנה בשלב הזה:
1. `nodeDefinitions` registry
2. canvas של React Flow
3. ספריית צמתים (drag → node)
4. Properties Panel — **זה החלק הכבד:** מחליף את JsonForms
5. Variable Picker — מחליף את `VariableText`

**שער יציאה:** v2 פותח תהליך קיים, עורך, שומר, מריץ בהצלחה — **על אותה שורת DB**
שה-v1 שמר.

### שלב C — הסרה

רק אחרי ששלב B עבר את השער. אז נמחקים ה-SDK, `schemas.ts`, `templates.ts` ותשעת
קובצי ה-UI.

---

## 5. סיכונים

1. **Properties Panel הוא הפריט הגדול, לא ה-canvas.** 1,017 שורות schema/uischema
   מייצגות טפסים עם כללי `HIDE` מותנים, `Select` דינמי, אזהרות ו-`errorPolicy`.
   React Flow לא נותן מזה כלום. **INFERRED:** זה הפריט שירכז את רוב העבודה.
2. **`getHandleId` — 16 מופעים.** צורת ה-handle (`source:inner:<id>`) היא חוזה
   התמדה: `isEdgeLive` משווה ב-`===`. **MEASURED:** `branch-handles.test.ts` מצמיד
   כל ליטרל מול `getHandleId` של ה-SDK. עורך v2 חייב לייצר **בדיוק** את אותן
   מחרוזות, או שכל דיאגרמה שמורה מאבדת את הניתוב שלה בשקט.
3. **ארבע התבניות ו-20 התהליכים.** `templates.ts` נכתב מחדש; 4 התהליכים עם דיאגרמה
   חייבים להיפתח ב-v2 ללא אובדן.
4. **עברית ו-RTL.** `i18n-he.ts` מתרגם את ה-SDK דרך i18next. ב-v2 כל מחרוזת היא
   שלנו — יתרון, אבל גם עבודה.
5. **`execution-core` המועתק לא זז.** **MEASURED 13.9:** upstream `main` עדיין
   ב-`2d987d3` — אותו קומיט שהועתק ב-4.9, ו-npm `latest` הוא 2.3.0. המעבר ל-React
   Flow **אינו** משחרר אותנו מהעתקת ה-runner; `@workflowbuilder/sdk` מייצא **אפס**
   סמלי הרצה (נבדק ב-`dist/index.d.ts`, 2,452 שורות).

---

## 6. מה שאינו בהיקף

- **החלפת ה-runner.** הוא נשאר כפי שהוא.
- **`logic.delay` וטריגרים מתוזמנים.** חוסמים על חלון 24 השעות של וואטסאפ —
  `ports.ts` מתעד את זה, ומטא מחזירה 131047.
- **הסרת ה-SDK לפני ששלב B עבר.**

---

## 7. ההמלצה

**שלב A שווה לעשות בקרוב ובנפרד.** הוא מתקן חוזה שנמדד כריק, פותר את בעיית ה-UUID,
ומוסיף שלוש בדיקות חסרות — הכול בלי לגעת ב-React Flow ובלי סיכון לעורך שעובד.

**שלב B הוא החלטה עסקית, לא טכנית.** התפר נקי והמעבר בר-ביצוע. השאלה היא האם
ה-Properties Panel וה-Variable Picker — שעובדים היום — שווים כתיבה מחדש כדי לקבל
שליטה מלאה. זו הכרעה של הבעלים, ואין בקוד ראיה שמכריעה אותה לכאן או לכאן.
