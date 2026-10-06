בצע ביקורת ממוקדת ושיפור זהיר של השימוש ב-React Hooks בפרויקט KALFA-RSVP-React.
מטרת העבודה
לבחון את השימוש הקיים ב-Hooks מול React 19.2.8, Next.js 16.3.6, App Router והארכיטקטורה הקיימת של הפרויקט.
אין להוסיף Hooks רק מפני שהם נחשבים נפוצים. יש לבצע שינוי רק כאשר הוא:
1. מתקן בעיה ממשית.
2. משפר נגישות.
3. מפחית רינדורים מיותרים באופן מוצדק.
4. מונע closure מיושן או התקנה חוזרת של event listener.
5. משפר תגובתיות של רכיב כבד.
6. נדרש כדי לשמור על זהות יציבה לפי חוזה של ספרייה חיצונית.
כללי יסוד
1. קרא תחילה את כל קובצי ההנחיות של הפרויקט, לרבות CLAUDE.md, AGENTS.md והנחיות מקומיות בתיקיות הרלוונטיות.
2. עבוד מול הקוד הנוכחי בענף הפעיל ולא לפי snapshot ישן.
3. אל תבצע החלפה גורפת של Hooks.
4. אל תוסיף ספרייה חדשה לפני שהוכח שאין פתרון מתאים ב-React, Next.js או בחבילות שכבר מותקנות.
5. אל תשנה התנהגות מוצרית, מבנה נתונים, חוזי API או חוזי WorkflowBuilder SDK.
6. אל תחליף Zustand ב-useReducer.
7. אל תעביר מידע רגיש או הרשאות לצד הלקוח.
8. אל תבצע אופטימיזציה ללא הסבר מדיד או דרישת יציבות ברורה.
9. לפני כל שינוי, כתוב מה הבעיה בקוד הקיים ומה השינוי אמור לפתור.
10. אם המימוש הקיים כבר נכון, השאר אותו ללא שינוי.
הקשר טכני
הפרויקט משתמש בין היתר ב:
- Next.js App Router.
- React 19.
- Server Components.
- Server Actions.
- Zustand.
- Supabase.
- react-hook-form.
- Mantine Hooks.
- WorkflowBuilder SDK.
- JsonForms.
- Tiptap.
- רכיבי לקוח מורכבים בעורך התהליכים.
יש להתייחס להבדל בין:
- Hook שנדרש לנכונות.
- Hook שנדרש לזהות הפניה יציבה.
- Hook שנועד רק לאופטימיזציה.
- Effect שמסנכרן מערכת חיצונית.
- Effect מיותר שמחשב state נגזר.
שלב ראשון: מיפוי מלא
מפה את כל השימושים הבאים בקוד:
- useState
- useEffect
- useLayoutEffect
- useEffectEvent
- useMemo
- useCallback
- useRef
- useContext
- useReducer
- useTransition
- useActionState
- useFormStatus
- useDeferredValue
- useId
- useImperativeHandle
- useSyncExternalStore
- useOptimistic
- useRouter
- usePathname
- useSearchParams
- useParams
- useForm
- useMediaQuery
- Hooks מותאמים של הפרויקט
- Hooks שמגיעים מ-WorkflowBuilder SDK
- Hooks שמגיעים מ-Mantine
- Hooks שמגיעים מ-Tiptap או מספריות נוספות
לכל שימוש חשוד יש לציין:
- נתיב הקובץ.
- שם הרכיב או ה-Hook.
- מה הוא עושה כיום.
- האם השימוש נכון.
- האם קיימת בעיית dependencies.
- האם קיימת סכנת stale closure.
- האם יש רינדור מיותר.
- האם ניתן להסיר Effect.
- האם נדרש שינוי.
- רמת הסיכון של השינוי.
אין להסתפק בחיפוש טקסטואלי. קרא את ההקשר המלא של כל שימוש שנראה רלוונטי.
שלב שני: בדיקת useRouter וניווט
הפרויקט משתמש ב-App Router.
ודא שכל שימוש ב-useRouter מגיע מ:
import { useRouter } from 'next/navigation';
אסור להכניס שימוש ב:
import { useRouter } from 'next/router';
בדוק גם:
1. האם נעשה שימוש ב-useRouter לצורך ניווט רגיל שניתן לבצע עם Link.
2. האם router.push או router.replace מקבלים ערך שמקורו בקלט לא מהימן.
3. האם router.refresh משמש רק כאשר באמת נדרש לרענן Server Components.
4. האם ניתן להשתמש ב-revalidatePath או revalidateTag בצד השרת במקום refresh רחב.
5. האם usePathname, useSearchParams או useParams נוספו במקום שבו ניתן לקבל params או searchParams ב-Page Server Component.
אל תשנה ניווט עובד ללא הצדקה קונקרטית.
שלב שלישי: ביקורת useEffect
עבור כל useEffect, סווג אותו לאחת הקטגוריות הבאות:
1. סנכרון עם מערכת חיצונית.
2. התקנת event listener.
3. טיימר או interval.
4. כתיבה ל-DOM.
5. סנכרון עם store חיצוני.
6. בקשת רשת.
7. העתקת props ל-state.
8. חישוב state נגזר.
9. איפוס state בעקבות שינוי מזהה.
10. lifecycle הנדרש בגלל חוזה של SDK.
השאר Effects שמסנכרנים מערכת חיצונית, DOM, store, timer או listener.
חפש Effects מיותרים מהצורות הבאות:
useEffect(() => {
  setFilteredItems(filterItems(items, query));
}, [items, query]);
או:
useEffect(() => {
  setFullName(firstName + ' ' + lastName);
}, [firstName, lastName]);
במקרים כאלה יש להעדיף חישוב בזמן הרינדור, ואם החישוב כבד ומדיד, useMemo.
אל תסיר Effect שנועד לעקוף או לקיים חוזה מתועד של WorkflowBuilder SDK.
שים לב במיוחד ל-workflow-editor.tsx:
- רענון snapshot של הקטלוג באמצעות fetchData.
- סנכרון globalVariables.
- איפוס מצב הרצה ומצב פאנלים לפי workflowId.
- פרסום secret names ל-store חיצוני.
אל תשנה Effects אלה לפני שתבדוק את קוד ה-SDK ואת ההערות הקיימות. בחלק מהמקרים ה-Effect נדרש בגלל סדר הרינדור או התנהגות פנימית של SDK 2.3.0.
שלב רביעי: useMemo ו-useCallback
אין להוסיף useMemo או useCallback לכל חישוב או handler באופן אוטומטי.
useMemo מוצדק כאשר לפחות אחד מהתנאים מתקיים:
1. החישוב כבד ונמדד.
2. התוצאה עוברת לרכיב ממוטב ותלות בזהות ההפניה גורמת לרינדורים.
3. ספרייה חיצונית דורשת הפניה יציבה.
4. האובייקט משמש כתלות ב-Effect ועלול להפעילו שלא לצורך.
5. בנייה מחדש של registry, schema, palette או node types גורמת לעבודה ממשית.
useCallback מוצדק כאשר לפחות אחד מהתנאים מתקיים:
1. הפונקציה עוברת לרכיב ממוטב.
2. הפונקציה משמשת כתלות ב-Hook אחר.
3. ספרייה חיצונית דורשת callback יציב.
4. זהות חדשה גורמת לרישום או להתקנה חוזרים.
בדוק במיוחד את workflow-editor.tsx.
השימוש הקיים ב-useMemo עבור paletteItems נראה מוצדק משום ש-WorkflowBuilder SDK דורש nodeTypes או palette בעלי הפניה יציבה.
השימוש עבור normalizedInitialNodes עשוי להיות מוצדק עקב התלות ב-paletteItems ובשל העובדה שה-SDK קורא initialNodes בזמן האתחול.
אל תסיר memoization כזה רק משום ש-React Compiler מסוגל בעתיד לבצע memoization אוטומטי.
בדוק את next.config.ts. אם reactCompiler אינו מופעל, אין להניח שהמהדר מבצע אופטימיזציה אוטומטית.
גם אם React Compiler יופעל בעתיד, יש לשמור memoization שנדרש כחלק מחוזה של ספרייה חיצונית ולא רק כאופטימיזציית ביצועים.
שלב חמישי: ייצוב OAuth Context
בדוק את:
src/app/(admin)/admin/workflows/[id]/integration-connection-control.tsx
ב-OAuthConnectionProvider נבנה כיום ערך Context כאובייקט.
בדוק האם הוא עדיין נכתב ישירות כך:
<OAuthConnectionContext.Provider
  value={{
    workflowId,
    canConnectMicrosoft,
    unavailableReason,
    hasConnections,
  }}
>
אם כן, בדוק האם ה-Provider מתרנדר לעיתים שבהם הערכים עצמם לא משתנים והאם צרכני ה-Context מרונדרים בעקבות יצירת אובייקט חדש.
אם הדבר רלוונטי, ייצב את הערך:
const contextValue = useMemo(
  () => ({
    workflowId,
    canConnectMicrosoft,
    unavailableReason,
    hasConnections,
  }),
  [
    workflowId,
    canConnectMicrosoft,
    unavailableReason,
    hasConnections,
  ],
);
והעבר:
<OAuthConnectionContext.Provider value={contextValue}>
אין לבצע את השינוי אם המבנה כבר השתנה, אם אין צרכנים רגישים, או אם הדבר אינו מוסיף ערך ממשי.
הוסף או עדכן בדיקה רק אם יש התנהגות שניתן לבדוק באופן יציב.
שלב שישי: בחינת useEffectEvent
React 19 כולל useEffectEvent.
בדוק את כל ה-Effects שמתקינים:
- window.addEventListener
- document.addEventListener
- BroadcastChannel
- WebSocket
- EventSource
- setInterval
- setTimeout
- subscriptions
- callbacks של API חיצוני
המועמד המרכזי הוא מנגנון OAuth popup בתוך integration-connection-control.tsx, הכולל:
- message event.
- BroadcastChannel.
- timeout.
- פונקציית finish.
- מצב isConnecting.
- router.refresh.
- עדכון error ו-pending connection.
בדוק האם פונקציות שמופעלות מתוך ה-Effect צריכות לקרוא props או state עדכניים בלי לגרום להתקנה מחדש של המאזינים.
אם כן, שקול useEffectEvent.
מותר להשתמש ב-useEffectEvent רק כאשר:
1. הפונקציה נקראת מתוך Effect או מתוך Effect Event אחר.
2. היא צריכה לקרוא ערכים עדכניים.
3. היא אינה אמורה לשנות את dependencies שמגדירים מתי ה-Effect מתחבר ומתנתק.
אסור להשתמש ב-useEffectEvent כדי:
- לעקוף dependencies חסרים.
- לקרוא לו מתוך event handler רגיל.
- להעביר אותו לרכיב ילד.
- להסתיר בעיית ארכיטקטורה.
- למנוע Effect מלהגיב לערך שבאמת צריך להיות reactive.
אם המבנה הקיים כבר נקי וה-Effect מותקן רק כאשר isConnecting משתנה, אל תבצע רפקטור רק לשם שימוש ב-Hook החדש.
שלב שביעי: useDeferredValue בתפריט ההשלמות
מפה את קוד תפריט ההשלמות של Tiptap, לרבות:
- use-menu-navigation.ts
- רכיב תפריט ההצעות.
- סינון הרשימה.
- בניית קבוצות או עץ משתנים.
- חיפוש ב-trigger, globals, variables ו-node outputs.
- חישוב המיקום.
- רינדור הרשימה.
- ניהול selectedIndex.
- פתיחה וסגירה של התפריט.
מדוד האם הקלדה גורמת לעבודה כבדה.
בדוק:
1. כמה פריטים מסוננים בכל הקלדה.
2. האם כל הקלדה בונה מחדש עץ נתונים.
3. האם חישוב התוצאות חוסם את עדכון הטקסט בעורך.
4. האם קיימים רינדורים מיותרים של כל התפריט.
5. האם הסינון עצמו זול ואין צורך בשינוי.
אם קיימת השהיה מדידה, ניתן להשתמש בצורה דומה ל:
const [query, setQuery] = useState('');
const deferredQuery = useDeferredValue(query);
const filteredItems = useMemo(
  () => filterSuggestionItems(items, deferredQuery),
  [items, deferredQuery],
);
אין להשתמש ב-deferredQuery עבור:
- הערך המוצג בשדה.
- טקסט שהמשתמש מקליד.
- selectedIndex.
- פעולת Enter.
- קביעה האם התפריט פתוח.
- טקסט שמוכנס למסמך.
הערך המושהה מיועד רק לחישוב ולרינדור התוצאות.
ודא שאם query השתנה והתוצאות הישנות עדיין מוצגות לזמן קצר:
- Enter לא בוחר פריט שאינו תואם עוד לחיפוש הנוכחי.
- selectedIndex מתאפס או נתחם לטווח התקין.
- aria-activedescendant אינו מצביע על פריט שלא קיים.
- אין הבהוב או בחירה שגויה.
- מצב loading או stale מוצג רק אם הוא באמת נחוץ.
אם הרשימה קטנה והחישוב זול, אל תוסיף useDeferredValue.
שלב שמיני: useId ונגישות
מפה רכיבי טופס מותאמים, לרבות:
- header-rows-control.tsx
- checkbox-list-control.tsx
- integration-connection-control.tsx
- webhook-token-control.tsx
- שדות Tiptap מותאמים.
- רכיבי JsonForms מותאמים.
- רכיבים שבהם label, description ו-error נוצרים ידנית.
בדוק האם לכל שדה קיימים:
- id יציב.
- label עם htmlFor.
- aria-describedby עבור תיאור או שגיאה.
- aria-invalid כאשר קיימת שגיאה.
- מזהים ייחודיים כאשר אותו רכיב מופיע יותר מפעם אחת בעמוד.
אם חסר מזהה יציב לצורכי נגישות, השתמש ב-useId:
const generatedId = useId();
const inputId = providedId ?? generatedId;
const descriptionId = `${inputId}-description`;
const errorId = `${inputId}-error`;
אין להשתמש ב-useId עבור:
- React key.
- מזהה מסד נתונים.
- מזהה workflow.
- מזהה node.
- ערך שנשמר.
- מזהה שצריך להיות זהה בין sessions.
- selector עסקי.
כבד מזהה שמגיע מ-JsonForms או מה-SDK אם הוא כבר תקין. אין ליצור מזהה נוסף שיפרק את הקשר בין schema, label והשדה.
שלב תשיעי: useMediaQuery
הפרויקט כבר כולל @mantine/hooks.
אין להוסיף ספריית useMediaQuery נוספת.
בדוק האם קיימת לוגיקה מבוססת:
- window.innerWidth
- resize listener
- matchMedia
- בדיקת mobile בזמן רינדור
- state שמעתיק breakpoint
אם ההבדל הוא עיצובי בלבד, השתמש ב-CSS או Tailwind.
השתמש ב-useMediaQuery רק אם ההתנהגות עצמה משתנה, לדוגמה:
- מנגנון אינטראקציה שונה.
- רכיב כבד שאינו צריך להיות פעיל במסך קטן.
- בחירת תצוגה בעלת משמעות תפעולית.
התייחס ל-SSR ולהידרציה. אל תיצור הבדל בין HTML שרונדר בשרת לבין הרינדור הראשוני בדפדפן ללא fallback מתאים.
שלב עשירי: Hooks שאין לאמץ באופן גורף
SWR
אל תוסיף SWR כרגע רק לצורך data fetching כללי.
הפרויקט כבר משתמש ב:
- Server Components.
- Server Actions.
- router.refresh.
- Zustand.
- streaming.
- נתוני שרת שמועברים כ-props.
- מנגנוני cache ו-revalidation של Next.js.
אפשר להציע SWR רק עבור מקרה ממוקד שבו נדרשים:
- polling בצד הלקוח.
- stale-while-revalidate.
- deduplication של בקשות לקוח.
- cache משותף בין רכיבי לקוח.
במקרה כזה יש להסביר מדוע המנגנונים הקיימים אינם מספיקים ואיך מתבצע invalidation.
useSession
אין להוסיף next-auth או useSession. הפרויקט משתמש ב-Supabase ובמנגנוני הרשאה קיימים.
useReducer
אין להחליף Zustand, SDK stores או state משותף ב-useReducer. אפשר להשתמש בו רק במכונת מצב מקומית ומבודדת שבה הוא מפשט מספר עדכוני useState קשורים.
useLayoutEffect
אל תוסיף useLayoutEffect אלא אם קיימת מדידת layout שחייבת להתרחש לפני paint. יש להסביר מדוע useEffect, CSS או callback ref אינם מספיקים.
useImperativeHandle
אל תוסיף useImperativeHandle אלא אם רכיב חייב לחשוף API פקודתי מצומצם דרך ref, כגון focus, scroll או reset, ואין API הצהרתי פשוט יותר.
useSearchParams
אל תעביר שליפת נתוני שרת ל-useSearchParams. כאשר הפרמטר משפיע על שליפת נתונים, העדף את searchParams של Page Server Component והעבר את הנתון מטה.
כאשר משתמשים ב-useSearchParams ברכיב לקוח בתוך route שעובר prerendering, בדוק אם נדרש Suspense boundary.
שלב אחד עשר: טפסים ו-Actions
בדוק את החלוקה בין:
- useActionState.
- useFormStatus.
- useTransition.
- react-hook-form.
- Server Actions.
- state מקומי.
הנחיות:
1. useActionState מתאים לטופס פשוט שמגיש Server Action ומציג תוצאה או שגיאה.
2. useFormStatus מתאים לכפתור submit שצריך לדעת אם הטופס בהגשה.
3. react-hook-form מתאים לטופס לקוח מורכב עם validation אינטראקטיבי, שדות דינמיים או מערכי שדות.
4. useTransition מתאים לפעולת UI שאינה submit רגיל או להפעלת Server Action מתוך handler.
5. pending state בצד הלקוח אינו תחליף ל-idempotency בצד השרת.
6. אין להמיר טפסים עובדים בין המנגנונים ללא יתרון ברור.
שלב שנים עשר: בדיקות
אחרי כל שינוי הרץ את הבדיקות הממוקדות הרלוונטיות.
לאחר השלמת השינויים הרץ לפחות:
npm run typecheck
npm run lint
npm test
אם הסקריפטים בפועל שונים, השתמש בסקריפטים המוגדרים ב-package.json.
עבור תפריט Tiptap יש לבדוק לפחות:
1. פתיחה ראשונה.
2. פתיחה מחדש.
3. מעבר מרשימה ארוכה לקצרה.
4. מעבר לחיפוש ריק.
5. selectedIndex מחוץ לטווח.
6. Enter.
7. Escape.
8. לחיצה מחוץ לתפריט.
9. aria-activedescendant.
10. חיפוש ללא תוצאות.
11. שינוי query מהיר.
12. בחירה בזמן שהתוצאות המושהות עדיין מתעדכנות.
עבור OAuth יש לבדוק לפחות:
1. popup חסום.
2. הצלחה דרך postMessage.
3. הצלחה דרך BroadcastChannel.
4. קבלת הודעה בשני הערוצים.
5. הודעה ממקור שגוי.
6. timeout.
7. כשל בשמירת workflow.
8. refresh אחרי חיבור.
9. cleanup של listeners, channel ו-timeout.
10. unmount בזמן התחברות.
עבור useId ונגישות יש לבדוק:
1. label מפנה לשדה הנכון.
2. description ו-error מקושרים.
3. שני מופעים של אותו רכיב מקבלים מזהים שונים.
4. אין שינוי במבנה הנתונים הנשמר.
5. hydration עובר ללא אזהרות.
תוצר נדרש
לפני שינוי הקוד, החזר דוח קצר במבנה הבא:
א. מצב נוכחי
- גרסאות React ו-Next.js.
- האם React Compiler מופעל.
- אילו Hooks נמצאו.
- אילו Hooks מהמאמר אינם רלוונטיים לפרויקט.
ב. ממצאים
לכל ממצא:
- חומרה: תקלה, סיכון, שיפור או ללא שינוי.
- קובץ ושורות.
- ההתנהגות הנוכחית.
- הבעיה המוכחת.
- השינוי המוצע.
- הסיכון בשינוי.
- הבדיקות הנדרשות.
ג. תוכנית שינוי מינימלית
סדר את השינויים לפי:
1. תיקוני נכונות.
2. תיקוני נגישות.
3. מניעת stale closures או listener leaks.
4. ביצועים שנמדדו.
5. ניקוי קוד ללא שינוי התנהגות.
אל תתחיל משיפור קוסמטי אם קיימת בעיית נכונות.
ד. יישום
לאחר הדוח, יישם רק שינויים שאומתו מול הקוד הנוכחי.
שמור על diff קטן וממוקד.
אל:
- לבצע formatting רחב.
- לשנות שמות שאינם קשורים.
- לשכתב רכיבים שלמים ללא צורך.
- להוסיף dependency חדשה ללא אישור.
- לשנות API ציבורי.
- לשנות schema או נתונים נשמרים.
- להסיר הערות שמסבירות workaround מוכח של SDK.
- להניח שהמאמר הוא מקור סמכות.
ה. סיכום סופי
בסיום הצג:
- הקבצים ששונו.
- הסיבה לכל שינוי.
- מה נבדק.
- תוצאות typecheck, lint והבדיקות.
- ממצאים שלא שונו ומדוע.
- סיכונים או בדיקות ידניות שנותרו.
תוצאה רצויה
המטרה אינה להכניס כמה שיותר Hooks.
המטרה היא להגיע לקוד שבו:
- Effects משמשים רק לסנכרון אמיתי.
- state נגזר מחושב ישירות כאשר אפשר.
- callbacks וערכים מקבלים memoization רק כשיש לכך הצדקה.
- event listeners אינם סובלים מ-stale closures או דליפות.
- תפריט ההשלמות נשאר מהיר ונכון.
- שדות מותאמים נגישים.
- ניווט תואם App Router.
- מנגנוני Server Components, Server Actions, Zustand ו-WorkflowBuilder SDK נשארים מקורות האמת הקיימים.
