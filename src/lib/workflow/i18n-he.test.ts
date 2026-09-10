// The gate that `TranslationKey` was documented to be and cannot be.
//
// @workflowbuilder/sdk exports a `TranslationKey` type described as the "union
// of every valid translation key registered in the SDK's i18next instance". It
// is unusable in 2.3.0: `dist/index.d.ts:45` imports it from
// `./features/i18n/i18next`, and the shipped `dist/` contains only `index.d.ts`,
// `style.css` and `.js` chunks — no `features/` directory at all. With
// `skipLibCheck: true` that resolution failure is swallowed and the type
// degrades to `any`, so `const k: TranslationKey = 'not.a.real.key'` compiles
// clean. (Measured: the same file under `--skipLibCheck false` reports
// `TS2307: Cannot find module './features/i18n/i18next'`.)
//
// So key coverage cannot be checked by the compiler, and it is not the kind of
// thing that shows up at runtime either — i18next answers a missing key by
// falling back to English, which looks like a design choice rather than a bug.
// This test is the check instead.
//
// It reads BOTH bundles back out of the live i18next registry rather than
// parsing any source file. That is deliberate: it makes the assertions about
// what the SDK will actually render, not about what our object literal looks
// like.
import '@workflowbuilder/sdk';

import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import { applyHebrewToSdk } from './i18n-he';

/**
 * SDK keys deliberately left in English, and why each one is.
 *
 * Asserted EXACTLY, not as a floor. An SDK upgrade that starts rendering
 * `node.*`, or that adds a whole new key family, has to fail here — that is the
 * regression nothing else in the repo can see.
 */
const UNTRANSLATED_BY_DESIGN = [
  // Vendor demo data. `t('node.trigger.label')` and friends have ZERO call sites
  // in the shipped bundle; our palette comes from PALETTE_ITEMS.
  'node.action.label',
  'node.action.description',
  'node.conditional.label',
  'node.conditional.description',
  'node.decision.label',
  'node.decision.description',
  'node.delay.label',
  'node.delay.description',
  'node.notification.label',
  'node.notification.description',
  'node.trigger.label',
  'node.trigger.description',
  'node.aiAgent.label',
  'node.aiAgent.description',
  // The AI-agent tool picker, likewise zero call sites in the bundle.
  'aiTools.title',
  'aiTools.addTool',
  'aiTools.addToolSlot',
  'aiTools.modalTitle',
  // i18next selects a plural suffix through `Intl.PluralRules`, whose Hebrew
  // categories are one / two / other. There is no `zero`, so this key can never
  // be selected for `he`; a count of 0 lands on `conditions.totalNumber_other`,
  // which IS translated.
  'conditions.totalNumber_zero',
].sort();

/** Every leaf key path in a resource bundle, dot-joined. */
function leafPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

let en: string[];
let he: string[];

beforeAll(() => {
  applyHebrewToSdk();

  const enBundle = i18next.getResourceBundle('en', 'translation') as unknown;
  const heBundle = i18next.getResourceBundle('he', 'translation') as unknown;

  // Non-vacuity. `applyHebrewToSdk` is guarded by a module-level `applied` flag,
  // so if anything had already consumed it against a different instance the
  // Hebrew bundle would be empty — and an empty bundle would make the coverage
  // assertion below fail for the wrong reason, or a reversed one pass for none.
  expect(enBundle, 'the SDK registered no English bundle').toBeTruthy();
  expect(heBundle, 'applyHebrewToSdk registered no Hebrew bundle').toBeTruthy();

  en = leafPaths(enBundle).sort();
  he = leafPaths(heBundle).sort();
  expect(en.length).toBeGreaterThan(100);
  expect(he.length).toBeGreaterThan(100);
});

describe('the Hebrew bundle reaches the SDK', () => {
  // THE LOAD-BEARING ASSERTION.
  //
  // i18n-he.ts works only because `i18next` dedupes to a single copy, making the
  // instance it imports the same one the SDK initialised. Its own comment states
  // the failure mode: "If `npm ls i18next` ever shows two copies again, this file
  // silently stops having any effect ... the panels would quietly revert to
  // English with no error." Asking i18next for the translated value — rather than
  // for the presence of a key — is what turns that silence into a failure.
  it('resolves an SDK key through the SDK-owned i18next instance', () => {
    expect(i18next.t('header.folderName')).toBe('תהליך');
  });

  it('has actually switched the language to Hebrew', () => {
    expect(i18next.resolvedLanguage).toBe('he');
  });
});

describe('coverage against the shipped English resource', () => {
  it('translates every SDK key except the documented exceptions', () => {
    const missing = en.filter((key) => !he.includes(key)).sort();
    expect(missing).toEqual(UNTRANSLATED_BY_DESIGN);
  });

  it('declares no key the SDK does not have', () => {
    // A typo in i18n-he.ts is otherwise invisible forever: the misspelled key is
    // never asked for, and the real one falls back to English.
    //
    // The two plural forms are the exception and are real: i18next derives
    // `conditions.totalNumber_two` / `_other` from Hebrew's plural categories,
    // and neither exists in an English resource, whose categories are one/other.
    const extra = he.filter((key) => !en.includes(key)).sort();
    expect(extra).toEqual(['conditions.totalNumber_other', 'conditions.totalNumber_two']);
  });
});
