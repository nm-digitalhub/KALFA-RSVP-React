'use client';

// Hebrew for the SDK's own chrome.
//
// WHY THIS IS POSSIBLE, having first concluded it was not.
//
// The SDK initialises i18next itself with only `en` and `pl`. Its config,
// read out of the shipped bundle, is:
//
//   .init({
//     resources: { en, pl },
//     fallbackLng: 'en',
//     load: 'languageOnly',
//     detection: { order: ['localStorage','navigator'], caches: ['localStorage'] },
//   })
//
// There is NO `supportedLngs`, and the detector reads `navigator`. A Hebrew
// browser reports `he-IL`, which `load: 'languageOnly'` shortens to `he` — so
// the SDK is already asking for Hebrew and silently falling back to English
// because no `he` bundle exists. Nothing had to be unlocked; a bundle had to be
// supplied.
//
// The public API cannot supply it: `registerPluginTranslation` reads only
// `resource[lang].translation.plugins` (verified in the bundle) and the package
// `exports` map is closed to everything but `.` and `./style.css`. Upstream now
// documents the same limit in its own words — "every plugin's strings live under
// `translation.plugins.<pluginName>` to namespace away from SDK keys"
// (docs/workflowbuilder/api/plugins/plugintranslationresource.md) — so this is
// the vendor's design, not a gap we are routing around. The same page describes
// exactly the mechanism used below: "each call also issues
// `i18n.addResourceBundle(...)` so newly registered strings surface live, even
// when the plugin registers after the SDK has already initialised i18next. What makes
// this file work instead is that the SDK's bundle imports `from "i18next"` as a
// BARE EXTERNAL specifier. Declaring i18next as our own dependency at the same
// version deduped the tree — `npm ls i18next` now shows one copy with both SDK
// paths marked `deduped` — so the instance below IS the instance the SDK
// initialised. Upstream documents exactly this: "the SDK's i18n.init(...) is a
// no-op for the second init per i18next's contract — the registry is shared."
//
// KEEP THE DEDUPE. If `npm ls i18next` ever shows two copies again, this file
// silently stops having any effect: it would add Hebrew to a second, unused
// instance and the panels would quietly revert to English with no error.
//
// Keys below were extracted from the shipped `en` resource, not guessed. Any
// key omitted here falls back to English by `fallbackLng`, which is the right
// failure mode: a missing translation shows English rather than a raw key.
//
// COVERAGE IS TESTED, in i18n-he.test.ts, and it has to be tested at RUNTIME.
// The SDK exports a `TranslationKey` type documented as the "union of every valid
// translation key" — it would have been the compile-time gate for this file. It
// does not work in 2.3.0: `dist/index.d.ts:45` imports it from
// `./features/i18n/i18next`, which the package does not ship (`dist/` holds only
// `index.d.ts`, `style.css` and `.js` chunks). Under our `skipLibCheck: true`
// that resolution failure is swallowed and the type is `any`, so a garbage key
// annotated with it compiles clean. Measured, not assumed.
//
// COVERAGE, and the two families deliberately left out. Diffing this bundle
// against the shipped `en` resource leaves exactly `node.*` (12 keys) and
// `aiTools.*` (4). Neither is dead weight by guesswork: `t('node.trigger.label')`
// and `t('aiTools.title')` appear ZERO times in the shipped bundle. They
// describe the vendor demo's own node data, and our palette comes from
// `PALETTE_ITEMS`. Everything the SDK can actually render is translated here.
import i18next from 'i18next';

const HE = {
  common: {
    close: 'סגירה',
    open: 'פתיחה',
    cancel: 'ביטול',
    collapse: 'כיווץ',
    expand: 'הרחבה',
    edit: 'עריכה',
    remove: 'הסרה',
    save: 'שמירה',
    filter: 'סינון',
    sort: 'מיון',
    moveUp: 'הזזה למעלה',
    moveDown: 'הזזה למטה',
    accept: 'אישור',
    reject: 'דחייה',
    goBack: 'חזרה',
    openInNewTab: 'פתיחה בלשונית חדשה',
    settings: 'הגדרות',
    name: 'שם',
    namePlaceholder: 'הקלידו שם',
    description: 'תיאור',
    descriptionPlaceholder: 'הקלידו תיאור',
    type: 'סוג',
    notFound: 'אין תוצאות מתאימות.',
  },
  palette: {
    templates: 'תבניות',
    nodesLibrary: 'ספריית צעדים',
  },
  propertiesBar: {
    label: 'מאפיינים',
    deleteNode: 'מחיקת צעד',
    deleteEdge: 'מחיקת חיבור',
  },
  header: {
    // NOT "folder name". `ProjectSelection` renders this immediately before a
    // hardcoded " /" and then the workflow name, so it is a breadcrumb root, and
    // KALFA has no folders. An empty string is not an option — the separator is
    // a JSX literal and would be left dangling.
    folderName: 'תהליך',
    projectSelection: {
      rename: 'שינוי שם',
      duplicateToDrafts: 'שכפול לטיוטות',
    },
    controls: {
      saveAsImage: 'שמירה כתמונה',
      archive: 'ארכיון',
    },
  },
  tooltips: {
    exportDiagram: 'ייצוא לקובץ',
    readOnlyMode: 'מעבר למצב צפייה בלבד',
    layout: 'סידור אוטומטי',
    open: 'פתיחה',
    close: 'סגירה',
    palette: 'ספריית צעדים',
    propSidebar: 'סרגל מאפיינים',
    remove: 'הסרה',
    cantRemoveOnlyOption: 'אי אפשר להסיר את האפשרות היחידה',
    addOption: 'הוספת אפשרות',
    menu: 'תפריט',
    pickTheProject: 'בחירת פרויקט',
    openPalette: 'פתיחת ספריית הצעדים',
    closePalette: 'סגירת ספריית הצעדים',
    openPropertiesBar: 'פתיחת סרגל המאפיינים',
    closePropertiesBar: 'סגירת סרגל המאפיינים',
    importDiagram: 'ייבוא מקובץ',
    save: 'שמירה',
    changeLanguage: 'החלפת שפה',
    copy: 'העתקה',
  },
  snackbar: {
    saveDiagramSuccess: 'התהליך נשמר',
    noDiagramToLoad: 'אין תהליך לטעינה',
    loadDiagramError: 'טעינת התהליך נכשלה',
    loadDiagramSuccess: 'התהליך נטען',
    saveDiagramError: 'שמירת התהליך נכשלה',
    restoreDiagramSuccess: 'התהליך נטען',
    restoreDiagramError: 'שחזור הטיוטה נכשל',
    aiConnectionError: 'שגיאה בחיבור לשרת ה-AI',
    wrongDiagramFormat: 'מבנה התהליך אינו תקין',
    contentCopied: 'הועתק',
    variablesListIsEmpty: 'רשימת המשתנים ריקה.',
    cantEditReadOnlyMode: 'העריכה חסומה במצב צפייה בלבד.',
  },
  loader: {
    text: 'טוען…',
  },
  templateSelector: {
    title: 'בחירת תבנית',
    description: 'התחילו במהירות עם תבניות מוכנות<br/>לעורך התהליכים',
    emptyCanvas: 'קנבס ריק',
  },
  importExport: {
    export: 'ייצוא',
    import: 'ייבוא',
    ignoreAndImport: 'התעלמות וייבוא',
    importTip: 'הדרך הפשוטה לראות את המבנה הצפוי היא לבנות תהליך ולייצא אותו.',
  },
  decisionBranches: {
    // Reachable: `action.*` and `logic.condition` use `NodeType.DecisionNode`,
    // whose BODY renders the branch cards — not only the properties panel.
    branch: 'ענף #{{index}}',
    branches: 'ענפים',
    addBranch: 'הוספת ענף',
    label: 'כותרת',
  },
  conditions: {
    title: 'עורך התנאים',
    subtitle: 'הגדירו את כללי התנאי',
    cancel: 'ביטול',
    confirm: 'אישור',
    // i18next picks the suffix from `Intl.PluralRules('he')`, whose categories
    // are one / two / other — there is NO zero category in Hebrew, so the SDK's
    // own `totalNumber_zero` can never be selected here and is not translated.
    // A count of 0 lands on `_other`, which is why that string reads naturally
    // with a leading number.
    totalNumber: '{{count}} תנאים',
    totalNumber_one: 'תנאי אחד',
    totalNumber_two: 'שני תנאים',
    totalNumber_other: '{{count}} תנאים',
    dependencies: 'תלויות',
    compare: {
      or: 'או',
      and: 'וגם',
      one: 'אחד',
      all: 'הכול',
      isEqual: 'שווה ל',
      isNotEqual: 'אינו שווה ל',
      isGreaterThan: 'גדול מ',
      isLessThan: 'קטן מ',
      isLessThanOrEqual: 'קטן או שווה ל',
      isGreaterThanOrEqual: 'גדול או שווה ל',
      isContaining: 'מכיל',
      isNotContaining: 'אינו מכיל',
      isBefore: 'לפני',
      isAfter: 'אחרי',
    },
  },
  variables: {
    variablesListIsEmptyHint: 'בדקו שהצעד מחובר לתרשים.',
    // Mirrors the SDK's own string, unclosed braces included: it is telling the
    // owner what to TYPE, and `{{` with no closing pair is left literal by
    // i18next's interpolation regex rather than being substituted.
    placeholderForStringOrVariable: 'הקלידו ערך או בחרו משתנה באמצעות {{...',
    placeholderTypeNumber: 'הקלידו ערך מספרי',
    placeholderTypeString: 'הקלידו ערך טקסט',
    typeValue: 'הקלידו ערך',
    pickVariable: 'בחירת משתנה',
    clickToPickVariable: 'לחצו כדי לבחור משתנה',
    defaultValue: 'ערך ברירת מחדל',
    variableNotFound: 'המשתנה לא נמצא.',
    removeVariableWarning: 'מחיקת המשתנה תסיר לצמיתות את ההגדרות שלו.',
    removeVariableIsBlocked: 'המשתנה בשימוש בצעדים הבאים ולכן אי אפשר למחוק אותו.',
  },
  workflowsSettings: {
    // Unreachable until the app bar was restored: the modal opens from
    // `ProjectSelection`'s kebab, and the previous hand-rolled toolbar had no
    // route to `openSettings` at all.
    modalTitle: 'הגדרות',
    modalDescription: 'ניהול מאפייני התהליך',
    tab: {
      general: 'כללי',
      generalDescription: 'הגדרות כלליות',
      globalVariables: 'משתנים גלובליים',
      globalVariablesDescription: 'ניהול משתנים לשימוש חוזר בתהליך',
      addVariable: 'הוספת משתנה',
      editVariable: 'עריכת משתנה',
      removeVariable: 'מחיקת משתנה',
      emptyVariablesList: 'לא הוגדרו משתנים.',
    },
  },
  validation: {
    // Surfaced by the import modal, which reached the UI for the first time
    // with the app bar's dots menu.
    error: {
      notJSONObject: 'הערך שהוזן אינו אובייקט JSON תקין.',
      nodesWithoutDefinition: 'צעדים שאינם נתמכים: {{nodesIds}}',
      nodesWithErrors: 'צעדים עם שגיאות: {{nodesIds}}',
    },
  },
  deleteConfirmation: {
    text: 'האם למחוק?',
    cancel: 'ביטול',
    delete: 'מחיקה',
    node: 'צעד',
    nodes: 'צעדים',
    edge: 'חיבור',
    edges: 'חיבורים',
    andConnected: 'והחיבורים אליהם',
    selected: 'הפריט שנבחר',
    selectedPlural: 'הפריטים שנבחרו',
    deleteSelection: 'מחיקת הבחירה',
    dontShowMeThisAgain: 'אל תציגו לי שוב',
  },
};

let applied = false;

/**
 * Add the Hebrew bundle and switch to it.
 *
 * Idempotent: the SDK's registries are module-global singletons and this file's
 * effect is too, so a second call under Fast Refresh would be wasted work.
 *
 * `changeLanguage` is deliberate rather than left to the detector. The detector
 * caches its choice in localStorage under `i18nextLng`, so a browser that once
 * resolved to English — or an admin on an English-locale machine — would stay
 * English forever. KALFA is Hebrew-first and this layout exposes no language
 * switcher, so there is no user choice being overridden.
 */
export function applyHebrewToSdk(): void {
  if (applied) return;
  applied = true;

  // deep = true, overwrite = true — merge into whatever is already registered
  // for `he` (the plugins namespace, if a plugin registered one) rather than
  // replacing it.
  i18next.addResourceBundle('he', 'translation', HE, true, true);
  void i18next.changeLanguage('he');
}
