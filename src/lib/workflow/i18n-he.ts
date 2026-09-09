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
// `exports` map is closed to everything but `.` and `./style.css`. What makes
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
    folderName: 'שם התיקייה',
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
