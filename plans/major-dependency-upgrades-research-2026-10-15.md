# ארבע קפיצות גרסה ראשית — מחקר לפני עדכון (15.10.2026)

מחקר בלבד. **שום דבר מהארבעה לא עודכן.** כל טענה מסומנת **[נמדד]** (נבדק על המכונה או במקור ראשוני ביום הזה) או **[מוסק]** (הסקה, לא נבדקה).

מצב נוכחי → גרסה אחרונה: `typescript` 6.0.3 → 7.0.2 · `eslint` 9.39.5 → 10.12.0 · `motion` 13.4.1 → 14.2.0 · `@azure/msal-node` 6.0.1 → 7.1.0.

| חבילה | מצב | מה עוצר | מה מומלץ |
|---|---|---|---|
| motion 14 | **בטוח לעדכן** | כלום | לעדכן, לבנות ולבדוק 5 קבצים |
| @azure/msal-node 7 | **חסר טעם** | אף אחד לא משתמש בו ישירות; שאר החבילות דורשות 6 | להשאיר ב-6, או למחוק את התלות הישירה |
| eslint 10 | **חסום** | שלושה תוספים שמגבילים ל-ESLint 9 | להמתין לתוספים. ‏ESLint 9 כבר מסומן "לא נתמך" |
| typescript 7 | **חסום** | `typescript-eslint` + אין JS API | להמתין, או workaround מתועד של Microsoft |

## motion 13 → 14
- **[נמדד]** המדריך הרשמי (motion.dev/docs/react-upgrade-guide): "There are no breaking changes in Motion for React in version 14. This release deprecates some internal APIs. It also introduces stricter versioning between Motion's internal dependencies."
- **[נמדד]** שימוש אצלנו: 5 קבצים ב-`src` (3 מייבאים `motion/react`, 2 מייבאים `motion/react-m`). אין `framer-motion`.
- **[נמדד]** אף חבילה מותקנת לא מצהירה תלות ב-`motion`.
- **להשלים לפני עדכון:** בנייה (`next build`) ובדיקה ויזואלית של 5 הקבצים.

## @azure/msal-node 6 → 7
- **[נמדד]** שינוי שובר יחיד בגרסה 7.0.0: הוסר `responseMode` מ-`acquireTokenInteractive`, ו-`form_post` נדרש להתחברות דפדפן (loopback). מקור: release notes ב-GitHub, `AzureAD/microsoft-authentication-library-for-js`. ב-7.1.0: ניקוי payload של authorization code בלבד.
- **[נמדד]** אצלנו אפס `import` של `@azure/msal-node` ב-`src` ו-`scripts`. הוא תלות ישירה ב-`package.json` מאז `37a431b6` (16.8.2026), אבל הקומיט עצמו מציין ש-`@azure/identity` הוא מה שנעשה בו שימוש.
- **[נמדד]** מי תלוי בו: `@azure/identity` 4.14.0 (גם האחרונה) דורש `^6.0.0`; `@microsoft/m365agentstoolkit-cli` דורש `^6.0.1`; `@pnp/cli-microsoft365` דורש `^5.4.3`.
- **המשמעות [מוסק מהמדידות]:** עדכון לשורש יוסיף עותק שני (7) לצד 6, בלי שמישהו ישתמש בו. אין תועלת.
- **שאלה פתוחה לבעלים:** האם להסיר את התלות הישירה לגמרי (היא רק מקבעת גרסה).

## eslint 9 → 10
- **[נמדד]** `npm` מדפיס על 9.39.5: "This version is no longer supported" — כלומר יש דחיפות.
- **[נמדד]** שינויים שוברים (eslint.org/docs/latest/use/migrate-to-10.0.0): Node ‏≥20.19/22.13/24; הוסרו `context.getFilename()`, `context.getCwd()`, `context.getSourceCode()`, `context.parserOptions` ועוד, וכן שיטות של `SourceCode` (`getJSDocComment` ועוד); `eslint-env` ו-eslintrc לא נתמכים (אצלנו כבר flat config — `eslint.config.mjs`); עוקבים אחרי הפניות JSX (עלול להוסיף דיווחי `no-unused-vars`).
- **[נמדד] החסימה:** `eslint-config-next` 16.4.1 דורש `eslint >=9.0.0` (מתאים ל-10), אבל שלושה תוספים שהוא מביא — `eslint-plugin-react` 7.37.5, `eslint-plugin-import` 2.32.0, `eslint-plugin-jsx-a11y` 6.10.2 (כולם הגרסה האחרונה ב-npm) — מצהירים תאימות עד ESLint 9. `typescript-eslint` 8.71.2 ו-`eslint-plugin-react-hooks` 7.1.1 כן מצהירים תמיכה ב-10.
- **[מוסק]** התקנה ב-npm 12 תיכשל על התנגשות peer (ERESOLVE) בלי `--force`/`overrides`, ואפילו עם כפייה התוספים הישנים עלולים לקרוס אם הם עדיין קוראים ל-API שהוסר (`context.getFilename` וכד'). לא נבדק בפועל.
- **מה להמתין לו:** גרסה של `eslint-config-next` או של שלושת התוספים שמצהירה על ESLint 10.

## typescript 6 → 7
- **[נמדד]** TypeScript 7 הוא המהדר הנייטיב (Go). הפוסט הרשמי (devblogs.microsoft.com/typescript/announcing-typescript-7-0): "does not ship with an API"; ‏7.1 צפוי להביא "a new (and different) API". חבילת ה-npm חושפת רק `bin/tsc` ו-`./unstable/*`.
- **[נמדד] החסימה:** `typescript-eslint` ‏8.71.2 (האחרונה) מצהיר `typescript >=4.8.4 <6.1.0`, וקורא ל-JS API שנעלם. מכאן `npm run lint` לא יעבוד עם TS 7.
- **[נמדד] workaround רשמי** (אותו פוסט): `"typescript": "npm:@typescript/typescript6@^6.0.2"` לכלים שצריכים API, ו-`"@typescript/native": "npm:typescript@^7.0.2"` ל-`tsc`. לא נוסה אצלנו; מתנגש עם ה-override הקיים `i18next: { typescript: "$typescript" }`.
- **[נמדד]** Next.js 16.4 תומך ב-TS 7: ‏`next build` מריץ את ה-`tsc` המקומי כברירת מחדל (`02-typescript.md` "Using TypeScript 7", `useTypeScriptCli.md`). אצלנו זה `next build --webpack`.
- **[נמדד]** ה-`tsconfig.json` שלנו לא משתמש באף אפשרות שהוסרה (target ES2017, moduleResolution bundler, אין baseUrl/downlevelIteration; ‏`esModuleInterop: true`). שינויי ברירת מחדל של 7: `strict` תמיד true (כבר אצלנו), `types` ברירת מחדל `[]` (אצלנו `["node"]` מפורש), `rootDir` ברירת מחדל `./`.
- **[נמדד]** חבילות מותקנות נוספות שמצהירות טווח TS שלא כולל 7: `react-i18next` (peer אופציונלי `^5`), `@pnp/cli-microsoft365` (`^5.9.3`), `@voximplant/voxengine-ci` (`5.5.4` מדויק), `typescript-json-schema` (`~5.9.3`) — תלויות פנימיות של כלים, לא שלנו.
- **[מוסק]** `dependency-cruiser` ו-`ts-node` לא הצהירו טווח שנכשל, אבל לא נבדק שהם עובדים בלי ה-API.
- **מה להמתין לו:** `typescript-eslint` שתומך ב-7, או TypeScript 7.1 עם ה-API החדש.

## 8 חבילות שדולגו בכוונה בעדכון הקטן (לא מהארבע)
`@chat-adapter/whatsapp`, `@modelcontextprotocol/node` + `server`, `skills` — נעוצות בכוונה (הקומיטים שהוסיפו אותן אומרים "pinned"). `@supabase/mcp-server-supabase`, `mcp-remote`, `sumit-api` — מינור ב-0.x (נחשב שובר; `sumit-api` הוא ה-SDK של הסליקה). `@uiw/react-json-view` — pre-release.
