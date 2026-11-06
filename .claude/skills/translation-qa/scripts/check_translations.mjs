#!/usr/bin/env node
// Deterministic checks for i18next JSON translation files. Read-only: it prints to stdout and never writes a file.
// Written in Node, with no dependencies, because i18next picks plural forms through Intl.PluralRules, which Python lacks.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { detectFormat, flatten, FORMATS, importFromProject, parseIcu, placeholders, prepareFormats, readTranslations } from './lib/formats.mjs';
import { compileGlossary, glossaryFindings, lengthMasks, parseGlossary } from './lib/glossary.mjs';
import { scanNextCode } from './lib/nextjs.mjs';
import { scanUsage, usageIndex } from './lib/usage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const THRESHOLDS_FILE = join(HERE, 'length-thresholds.json');
const FONT_FILE = join(HERE, 'ui-font-widths.json');
const UI_SETTINGS_FILE = join(HERE, 'ui-settings.json');

const EXIT = { clean: 0, critical: 1, usage: 2, input: 3 };

// Below this source length one short word swings the ratio: `שאלות נפוצות` → `FAQ` is 0.25 and correct.
const MIN_SOURCE_LENGTH = 20;
// From this source length ratios measurably tighten, so long strings get their own, narrower range.
const LONG_SOURCE_LENGTH = 80;
// See calibrate: keeps a cut in half below the range, with a margin for strings a little longer than the median.
const MIN_FLOOR_OF_MEDIAN = 0.62;
// The allowance above a pair's normal length for tight UI elements. It comes from the skill's original 130% rule.
const UI_MARGIN = 1.3;
// The project's own UI numbers live in ui-settings.json, with the reason for each. These apply when a project has none:
// any label over its limit is reported, and nothing is called too wide for a row.
const DEFAULT_UI_SETTINGS = { fontPx: 14, narrowestControlPx: 0, fullRowButtonPx: Infinity, keyPattern: '(^|\\.)(cta|button|btn|submit|action|tab|menu|nav)(\\.|$)' };
// Search engines cut titles and descriptions at about these lengths. A convention, not a limit, so a style finding.
const METADATA_LIMITS = { title: 60, description: 160 };
// Used for a language pair that has not been measured.
const DEFAULT_RANGE = { short: [0.5, 2], long: [0.5, 2], ui: 1.3 };
// Agents lose output past roughly 10-30K characters, so a report shows a few examples per check and pages the rest.
const DEFAULT_EXAMPLES = 3;
const DEFAULT_CHECK_LIMIT = 50;
const DEFAULT_DUMP_LIMIT = 80;
const SNIPPET_LENGTH = 90;
// Integer plural rules repeat within 1000. Scanning past that shows which forms real counts reach. A form used only from
// 1,000,000, like French `many`, stays optional, which matches how i18next-cli treats plural categories.
const PLURAL_SCAN_LIMIT = 10000;

const CHECKS = {
  'placeholder-mismatch': ['critical', 'A {{placeholder}}, $t() reference or component tag differs from the source (reported by i18next-cli lint)'],
  'broken-tags': ['critical', 'Unclosed or wrongly nested tags in the translation'],
  'missing-plural-form': ['critical', 'A plural form the language needs is missing, so readers see the raw key or the fallback language'],
  'structure-mismatch': ['critical', 'A text in one file is a nested object in the other'],
  missing: ['warning', 'Key is in the source but not in the translation'],
  empty: ['warning', 'Translation is empty'],
  orphaned: ['warning', 'Key is in the translation but not in the source'],
  identical: ['warning', 'Translation is identical to the source'],
  'source-script-left': ['warning', 'Hebrew letters remain in a non-Hebrew translation'],
  'unused-plural-form': ['warning', 'A plural form this language never uses'],
  'number-mismatch': ['warning', 'Numbers differ from the source'],
  'url-mismatch': ['warning', 'URLs differ from the source'],
  'email-mismatch': ['warning', 'E-mail addresses differ from the source'],
  length: ['warning', 'Length is outside the normal range for this language pair'],
  'ui-length': ['warning', 'UI label may be too long for its element, confirm on the screen'],
  'fr-elision': ['warning', 'Missing French elision'],
  'fr-possessive': ['warning', 'ma, ta or sa before a vowel should be mon, ton or son'],
  'fr-word-before-placeholder': ['warning', 'An elidable word or gendered article sits right before a placeholder'],
  'fr-inclusive-dot': ['warning', 'Inclusive writing with a middle dot'],
  'fr-tu-form': ['warning', 'A tu form in text that uses vous'],
  'fr-reader-gender': ['warning', 'An adjective or participle assumes the reader is one gender'],
  'negation-mismatch': ['warning', 'The source has a negation and the translation may have lost it'],
  'possible-truncation': ['warning', 'The translation may be cut off'],
  'ui-clipped': ['warning', 'The element cuts text that does not fit, and the translation is wider than the source'],
  'ui-overflow': ['warning', 'Button label is wider than a full row at 320px, and buttons do not wrap'],
  'unfinished': ['warning', 'The file marks this translation as not final'],
  'format-specifier-mismatch': ['critical', 'A format specifier or placeholder differs from the source'],
  'icu-syntax': ['critical', 'Invalid ICU message syntax'],
  'final-punctuation': ['style', 'Final punctuation differs from the source'],
  'edge-whitespace': ['style', 'Leading or trailing whitespace'],
  'double-space': ['style', 'Double space'],
  capitalization: ['style', 'First letter case differs from the source'],
  'optional-plural-form': ['style', 'A plural form only very large counts use is missing'],
  'mixed-apostrophes': ['style', 'Straight and curly apostrophes are mixed in this language'],
  'fr-spacing': ['style', 'Spacing around French punctuation does not follow fr-FR'],
  'fr-unaccented-capital': ['style', 'A capital should keep its accent: À'],
  'glossary-review': ['style', 'A glossary term is not used here, although the translations usually follow it. Often a fair paraphrase, so read it'],
  'metadata-length': ['style', 'Page title or description is longer than search engines usually show'],
  'construct-article': ['style', 'Possible article on the first noun of a Hebrew construct'],
  'next-static-metadata': ['warning', 'A static metadata export holds text, so the page title can not follow the language'],
  'next-module-scope-t': ['warning', 'Text is translated at module scope, before any request has a language'],
  'next-hardcoded-language': ['warning', 'lang or dir is fixed in the code, so a translated page keeps the wrong language or direction'],
  'next-locale-in-client': ['warning', 'A language file is imported into a client component, which sends it to every browser'],
};
const SEVERITY_ORDER = { critical: 0, warning: 1, style: 2 };

const HELP = `Usage: node check_translations.mjs [options]

Checks translation files against their source: i18next JSON in folders, or one file at a time with --target-file in
PO, XLIFF, ARB, ICU JSON, YAML, .strings or .resx. Run it from the project root. It only reads files.
Requires Node.js 18+. It uses the project's own i18next, i18next-cli and typescript when they are installed.

Options:
  --source LANG        Source language (default: he)
  --targets LIST       Comma-separated target languages (default: en,fr)
  --source-root DIR    Folder holding <lang>/<namespace>.json for the source (default: src/locales)
  --target-root DIR    The same for the targets (default: the source root)
  --ns LIST            Comma-separated namespaces (default: every .json in the source folder)
  --lang LANG          Show only this target language
  --check ID           List every finding of one check, with --limit and --offset
  --limit N            Findings to show (default: ${DEFAULT_EXAMPLES} per check, ${DEFAULT_CHECK_LIMIT} with --check, ${DEFAULT_DUMP_LIMIT} with --dump)
  --offset N           Findings to skip
  --ui-pattern REGEX   Key names that are tight UI elements, for labels the code scan can't place
  --ui-settings FILE   The project's UI numbers (default: scripts/ui-settings.json). Copy it for another project
  --no-lint            Skip the i18next-cli placeholder check, and say so in the report
  --code-root DIR      Code to scan for where each key is used (default: src)
  --no-usage           Skip the code scan and decide UI labels by --ui-pattern
  --next [--next-root DIR]  Also check the Next.js code that decides the language, under DIR (default: --code-root)
  --glossary LANG=FILE A Markdown glossary (default: <target-root>/<lang>/glossary.md when it exists). Repeatable
  --changed-since REF  Only keys whose translation changed since this git ref
  --dump               Print source, translations, code usage and a hash per key, as JSON Lines, for reading in context
  --review FILE        Check a JSON Lines record of the reading: every key read once, and none changed since
  --source-file FILE   Check one file instead of folders. Optional for PO and XLIFF, which carry their source
  --target-file L=FILE The translation for language L, with --source-file. Repeatable
  --format NAME        File format: ${FORMATS.join(', ')} (default: from the extension)
  --thresholds         Print the length thresholds in use
  --calibrate          Measure thresholds from the files and print them. Only on reviewed translations, or when the owner asks
  --out FILE           With --calibrate, write the result to FILE safely instead of printing it
  --help               Show this help

Exit codes:
  0  No critical findings
  1  Critical findings
  2  Invalid arguments
  3  Files could not be read, or the placeholder check could not run

Examples:
  node check_translations.mjs
  node check_translations.mjs --target-root docs/translations/drafts
  node check_translations.mjs --target-root docs/translations/drafts --check length --lang fr
  node check_translations.mjs --target-root docs/translations/drafts --dump --offset 80
  node check_translations.mjs --target-file fr=locale/fr.po
  node check_translations.mjs --source-file en.arb --target-file fr=fr.arb`;

function fail(code, message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(code);
}

function readOptions() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        source: { type: 'string', default: 'he' },
        targets: { type: 'string', default: 'en,fr' },
        'source-root': { type: 'string', default: 'src/locales' },
        'target-root': { type: 'string' },
        ns: { type: 'string' },
        lang: { type: 'string' },
        check: { type: 'string' },
        limit: { type: 'string' },
        offset: { type: 'string', default: '0' },
        'ui-pattern': { type: 'string' },
        'ui-settings': { type: 'string' },
        'no-lint': { type: 'boolean', default: false },
        'code-root': { type: 'string', default: 'src' },
        'no-usage': { type: 'boolean', default: false },
        next: { type: 'boolean', default: false },
        'next-root': { type: 'string' },
        glossary: { type: 'string', multiple: true, default: [] },
        'changed-since': { type: 'string' },
        review: { type: 'string' },
        'source-file': { type: 'string' },
        'target-file': { type: 'string', multiple: true, default: [] },
        format: { type: 'string' },
        out: { type: 'string' },
        dump: { type: 'boolean', default: false },
        thresholds: { type: 'boolean', default: false },
        calibrate: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    }).values;
  } catch (error) {
    fail(EXIT.usage, `${error.message}\nRun with --help to see the options.`);
  }
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    process.exit(EXIT.clean);
  }
  const pairsOf = (flag, values) => Object.fromEntries(values.map((value) => {
    const split = value.indexOf('=');
    if (split < 1) fail(EXIT.usage, `--${flag} needs LANG=FILE.\n       Received: "${value}"`);
    return [value.slice(0, split), resolve(value.slice(split + 1))];
  }));
  const targetFiles = pairsOf('target-file', parsed['target-file']);
  if (parsed['source-file'] && Object.keys(targetFiles).length === 0) fail(EXIT.usage, '--source-file needs at least one --target-file LANG=FILE');
  if (parsed.format && !FORMATS.includes(parsed.format)) fail(EXIT.usage, `--format must be one of: ${FORMATS.join(', ')}.\n       Received: "${parsed.format}"`);
  const fileMode = Object.keys(targetFiles).length > 0;
  const targets = fileMode ? Object.keys(targetFiles) : parsed.targets.split(',').map((target) => target.trim()).filter(Boolean);
  if (targets.length === 0) fail(EXIT.usage, '--targets needs at least one language, for example --targets en,fr');
  if (parsed.check && !CHECKS[parsed.check]) {
    fail(EXIT.usage, `--check must be one of: ${Object.keys(CHECKS).join(', ')}.\n       Received: "${parsed.check}"`);
  }
  if (parsed.lang && !targets.includes(parsed.lang)) {
    fail(EXIT.usage, `--lang must be one of --targets: ${targets.join(', ')}.\n       Received: "${parsed.lang}"`);
  }
  for (const flag of ['limit', 'offset']) {
    if (parsed[flag] !== undefined && !/^\d+$/.test(parsed[flag])) {
      fail(EXIT.usage, `--${flag} must be a whole number.\n       Received: "${parsed[flag]}"`);
    }
  }
  const settingsPath = parsed['ui-settings'] ? resolve(parsed['ui-settings']) : UI_SETTINGS_FILE;
  if (parsed['ui-settings'] && !existsSync(settingsPath)) fail(EXIT.input, `UI settings file not found: ${settingsPath}`);
  let ui = DEFAULT_UI_SETTINGS;
  try {
    if (existsSync(settingsPath)) ui = { ...DEFAULT_UI_SETTINGS, ...JSON.parse(readFileSync(settingsPath, 'utf8')) };
  } catch (error) {
    fail(EXIT.input, `Could not read ${settingsPath}: ${error.message}`);
  }
  let uiPattern;
  try {
    uiPattern = new RegExp(parsed['ui-pattern'] ?? ui.keyPattern);
  } catch (error) {
    fail(EXIT.usage, `--ui-pattern is not a valid regular expression: ${error.message}`);
  }
  const sourceRoot = resolve(parsed['source-root']);
  return {
    source: parsed.source,
    targets,
    sourceRoot,
    targetRoot: parsed['target-root'] ? resolve(parsed['target-root']) : sourceRoot,
    namespaces: parsed.ns ? parsed.ns.split(',').map((ns) => ns.trim()).filter(Boolean) : undefined,
    lang: parsed.lang,
    check: parsed.check,
    limit: parsed.limit === undefined ? undefined : Number(parsed.limit),
    offset: Number(parsed.offset),
    uiPattern,
    ui,
    lint: !parsed['no-lint'] && !fileMode,
    fileMode,
    sourceFile: parsed['source-file'] ? resolve(parsed['source-file']) : undefined,
    targetFiles,
    format: parsed.format,
    codeRoot: resolve(parsed['code-root']),
    useUsage: !parsed['no-usage'] && !fileMode,
    checkNext: parsed.next && !fileMode,
    nextRoot: resolve(parsed['next-root'] ?? parsed['code-root']),
    glossaries: pairsOf('glossary', parsed.glossary),
    changedSince: parsed['changed-since'],
    review: parsed.review ? resolve(parsed.review) : undefined,
    out: parsed.out ? resolve(parsed.out) : undefined,
    dump: parsed.dump,
    thresholds: parsed.thresholds,
    calibrate: parsed.calibrate,
  };
}

function loadFile(path) {
  try {
    return flatten(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    return fail(EXIT.input, `Could not read ${path}: ${error.message}\n       Fix the file, or leave it out with --ns.`);
  }
}

function listNamespaces(options) {
  const folder = join(options.sourceRoot, options.source);
  if (!existsSync(folder)) {
    fail(EXIT.input, `Source folder not found: ${folder}\n       Pass --source-root and --source, and run from the project root.`);
  }
  const found = readdirSync(folder).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -'.json'.length));
  if (found.length === 0) fail(EXIT.input, `No .json files in ${folder}`);
  if (!options.namespaces) return found.sort();
  const unknown = options.namespaces.filter((ns) => !found.includes(ns));
  if (unknown.length > 0) fail(EXIT.usage, `--ns not found: ${unknown.join(', ')}. Available: ${found.join(', ')}`);
  return options.namespaces;
}

// The project's own i18next, when it has one, so plural forms and placeholders are read exactly as the site reads them.
// The defaults below are i18next's own, for projects that don't use it.
let plural = (language, type) => new Intl.PluralRules(language, { type });
let interpolationPatterns = [/\{\{(.+?)\}\}/g, /\$t\((.*?)\)/g];

async function connectI18next() {
  const i18next = await importFromProject(process.cwd(), 'i18next');
  if (!i18next?.createInstance) return;
  const instance = i18next.createInstance();
  await instance.init({ initAsync: false, resources: {}, lng: 'en' });
  const { pluralResolver, interpolator } = instance.services;
  plural = (language, type) => pluralResolver.getRule(language, { ordinal: type === 'ordinal' });
  interpolationPatterns = [interpolator.regexp, interpolator.nestingRegexp];
}

// Same text the thresholds were measured on: only what a reader sees, with no markup and no niqqud.
function visibleText(value) {
  return interpolationPatterns.reduce((text, pattern) => text.replace(pattern, ''), value)
    .replace(/<\/?[A-Za-z0-9_-]+\s*\/?>/g, '')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[  ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A Hebrew prefix can sit right before an address (`ב-a@example.com`), so an e-mail must start with a letter or digit.
const EMAIL = /[A-Za-z0-9][\w.+-]*@[\w-]+(?:\.[\w-]+)+/g;
const URL_PATTERN = /https?:\/\/[^\s<>"')]+/g;

// Punctuation at the end of a sentence is not part of the address, and languages place it differently.
// The text the length check compares. Terms that distort the ratio are masked, but only when both languages have them.
function comparableText(value, language, otherLanguage, masks) {
  const text = visibleText(value);
  return masks?.[language] && masks[otherLanguage] ? text.replace(masks[language], '§') : text;
}

function sortedMatches(value, pattern) {
  return (value.match(pattern) ?? []).map((match) => match.replace(/[.,;:!?…]+$/, '')).sort().join(' ');
}

function pluralCategories(language, type) {
  const rules = plural(language, type);
  const all = rules.resolvedOptions().pluralCategories;
  const reached = new Set();
  for (let count = 0; count < PLURAL_SCAN_LIMIT; count += 1) reached.add(rules.select(count));
  return { all, required: all.filter((category) => reached.has(category)) };
}

const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const PLURAL_KEY = /^(.*?)(_ordinal)?_(zero|one|two|few|many|other)$/;

function pluralGroups(keys) {
  const groups = new Map();
  for (const key of keys) {
    const match = key.match(PLURAL_KEY);
    if (!match) continue;
    const base = `${match[1]}${match[2] ?? ''}`;
    if (!groups.has(base)) groups.set(base, { ordinal: Boolean(match[2]), name: match[1], forms: new Map() });
    groups.get(base).forms.set(match[3], key);
  }
  // A key that only happens to end in `_one` is not a plural: real plural groups always have `_other`.
  for (const [base, group] of groups) if (!group.forms.has('other')) groups.delete(base);
  return groups;
}

function snippet(value, length) {
  if (value === undefined) return undefined;
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function brokenTags(value) {
  const open = [];
  for (const [tag, closing, name, selfClosing] of value.matchAll(/<(\/?)([A-Za-z0-9_-]+)\s*(\/?)>/g)) {
    if (selfClosing || name === 'br') continue;
    if (!closing) open.push(name);
    else if (open.pop() !== name) return `unexpected ${tag}`;
  }
  return open.length > 0 ? `unclosed <${open.at(-1)}>` : undefined;
}

// `de A à Z` is correct, so a lone letter does not count as the next word, except `à`.
const VOWEL_WORD = '(?=[aàâäeéèêëiîïoôöuùûüœ]\\p{L}|à(?![\\p{L}]))';
const NO_ELISION_WORDS = '(?!huit|onz|oui\\b|ouistiti)';
const ELISION = new RegExp(`(?<![\\p{L}\\-'’])(le|la|de|je|me|te|se|ne|que|jusque)\\s+${NO_ELISION_WORDS}${VOWEL_WORD}`, 'giu');
const POSSESSIVE = new RegExp(`(?<![\\p{L}\\-'’])(ma|ta|sa)\\s+${NO_ELISION_WORDS}${VOWEL_WORD}`, 'giu');
const WORD_BEFORE_PLACEHOLDER = /(?<![\p{L}\-'’])(le|la|de|je|me|te|se|ne|que|du|au|un|une)\s+\{\{\s*-?\s*(\w+)/giu;
// A count or a year is printed in digits, and there is no elision before digits.
const NUMERIC_PLACEHOLDER = /^(count|year|number|total|amount)$/i;
const FR_UNITS = '(?:h|min|s|km|m|kg|g|l|Mo|Go|ans?|jours?|heures?|minutes?|secondes?|semaines?|mois)';

function frenchSpacingIssues(value) {
  const text = value
    .replace(/<\/?[A-Za-z0-9_-]+\s*\/?>/g, '')
    .replace(/\{\{.*?\}\}/g, 'X')
    .replace(/https?:\/\/\S+/g, 'X')
    .replace(/&\w+;/g, 'X');
  const issues = [];
  if (/(?<![  !?])[;!?](?=\s|$)/.test(text)) issues.push('; ! ? need a narrow or plain non-breaking space before');
  if (/(?<! ):(?=\s|$)/.test(text)) issues.push(': needs a non-breaking space (U+00A0) before');
  if (/«(?! )|(?<! )»/.test(text)) issues.push('« » need a non-breaking space inside');
  if (/[   ][,.](?!\.)/.test(text)) issues.push('no space before , or .');
  if (/\d[ ]?[%€]/.test(text) || new RegExp(`\\d ${FR_UNITS}\\b`, 'u').test(text)) issues.push('a number needs a non-breaking space before its unit, % or €');
  return issues;
}

function finalMark(value) {
  const last = visibleText(value).replace(/\.\.\.$/, '…').at(-1);
  return last && '.?!:…'.includes(last) ? last : '';
}

function firstLetter(value) {
  return visibleText(value).match(/\p{L}/u)?.[0];
}

function hasCase(letter) {
  return letter.toLowerCase() !== letter.toUpperCase();
}

function isIdentical(source, target) {
  if (source.trim() !== target.trim()) return false;
  const text = visibleText(target).replace(URL_PATTERN, '').replace(EMAIL, '');
  // Same exceptions as `i18next-cli status`: text with no letters, and short all-caps words such as OK or FAQ.
  return /\p{L}/u.test(text) && !/^\p{Lu}{1,5}$/u.test(text);
}

// Used for a character outside the measured table. About the width of an average Heebo letter.
const FALLBACK_CHARACTER_EM = 0.55;
let fontWidths;

function textWidth(text, fontPx) {
  fontWidths ??= existsSync(FONT_FILE) ? JSON.parse(readFileSync(FONT_FILE, 'utf8')).widths : {};
  let em = 0;
  for (const character of text) em += fontWidths[character] ?? FALLBACK_CHARACTER_EM;
  return em * fontPx;
}

// Words that carry a negation. A source with one and a translation with none is worth reading: this is how a sentence
// turns into its opposite without any other check noticing. Negative words such as `invalide` count, so a fair
// translation of `לא תקין` is not reported.
const NEGATION = {
  he: /(?<![\p{L}])[ושכ]?(לא|אין|אל|בלי|ללא|אינו|אינה|אינם|אינן|מבלי)(?![\p{L}])/u,
  en: /(?<![\p{L}])(not|no|never|none|nothing|nobody|neither|nor|without|cannot|unable|hardly|optional|failed|missing|missed|expired|only|instead|exactly|same|separately|un\p{L}{4,}|in(?:valid|active|correct))(?![\p{L}])|n['’]t(?![\p{L}])/iu,
  fr: /(?<![\p{L}])(ne|n['’]|non|pas|jamais|sans|aucun|aucune|rien|personne|plus|ni|facultatif|facultative|manquant|manquante|inconnu|inconnue|invalide|indisponible|inactif|inactive|impossible|échoué|expiré|expirée|seulement|uniquement|au lieu|même|séparément)(?![\p{L}])/iu,
};
// `essaie` and `envoie` are also the normal third person, so as an imperative they count only at the start of a sentence.
const TU_FORMS = /(?<![\p{L}'’-])(tu|toi|tes|ton|ta)(?![\p{L}'’-])|(?:^|[.!?:]\s+)(envoie|écris|choisis|réponds|clique|appuie|vérifie|remplis|essaie)(?![\p{L}'’-])/iu;
// `le ton` and `la ta` are nouns, not the possessive. Polite text never needs the bare possessive before a noun.
const TU_FALSE_FRIENDS = /(?<![\p{L}])(le|un|du|au|ce|même|de)\s+ton(?![\p{L}])/iu;
const READER_GENDER = /(?<![\p{L}])vous\s+(?:êtes|serez|étiez|seriez|sembl\p{L}+)\s+(?:\p{L}+\s+)?(prêt|prête|sûr|sûre|certain|certaine|inscrit|inscrite|connecté|connectée|invité|invitée|bienvenu|bienvenue|seul|seule|ravi|ravie|convaincu|convaincue|arrivé|arrivée|venu|venue|content|contente|heureux|heureuse)(?![\p{L}])/iu;
// Words a sentence can't end on. English prepositions and French `qui` are left out: `Log in`, `pass on` and `Pour qui ?`
// are correct, and they were the only false alarms on the reviewed translations.
const ENDS_MID_SENTENCE = {
  en: /(?<![\p{L}])(the|a|an|and|or|of|with|from|that|your|our)$/iu,
  fr: /(?<![\p{L}'’])(le|la|les|l['’]|de|du|des|d['’]|et|ou|à|au|aux|pour|avec|un|une|que|votre|vos|notre|nos)$/iu,
  he: /(?<![\p{L}])(של|את|על|עם|או|כי|אם|כל|גם)$/u,
};
const SENTENCE_END = /[.!?…](?=\s|$)/g;
// Fewer than half the source's sentences, counted only from three up, because translators often join two short ones.
const MIN_SENTENCES_TO_COMPARE = 3;

function truncationSigns(source, target, language) {
  const from = visibleText(source);
  const to = visibleText(target);
  const signs = [];
  if (/[.!?…]$/.test(from) && !/[.!?…:)»"”]$/.test(to)) signs.push('the source ends a sentence and the translation does not');
  if (ENDS_MID_SENTENCE[language]?.test(to.replace(/[.,;:!?…\s]+$/, ''))) signs.push('it ends on a word that can not end a sentence');
  for (const [open, close] of [['(', ')'], ['«', '»'], ['“', '”']]) {
    const count = (text, mark) => text.split(mark).length - 1;
    if (count(to, open) !== count(to, close) && count(from, open) === count(from, close)) signs.push(`unbalanced ${open} ${close}`);
  }
  const sourceSentences = (from.match(SENTENCE_END) ?? []).length;
  const targetSentences = (to.match(SENTENCE_END) ?? []).length;
  if (sourceSentences >= MIN_SENTENCES_TO_COMPARE && targetSentences * 2 < sourceSentences) signs.push(`${targetSentences} sentences against ${sourceSentences} in the source`);
  return signs;
}

const CONSTRUCT_ARTICLE = /(?<![\p{L}])ה(רשימת|בעלי|אישורי|תאריכי|בתי|מספרי)\s+[א-ת]/u;

function loadThresholds() {
  if (!existsSync(THRESHOLDS_FILE)) return { pairs: {} };
  try {
    return JSON.parse(readFileSync(THRESHOLDS_FILE, 'utf8'));
  } catch (error) {
    return fail(EXIT.input, `Could not read ${THRESHOLDS_FILE}: ${error.message}\n       Create it again with --calibrate.`);
  }
}

function checkString(add, context) {
  const { source, target, sourceLang, targetLang, range, tight, button, clipped, metadataField, firstTarget, masks, ui } = context;
  const targetBase = targetLang.split('-')[0];
  const sourceBase = sourceLang.split('-')[0];
  const french = targetBase === 'fr';
  const hebrewTarget = targetBase === 'he';

  const tagProblem = brokenTags(target);
  if (tagProblem && !brokenTags(source)) add('broken-tags', tagProblem);
  if (isIdentical(source, target)) add('identical');
  if (!hebrewTarget && /[֐-׿]/.test(visibleText(target))) add('source-script-left');

  const numbers = (value) => sortedMatches(visibleText(value).replace(/(?<=\d)[ ,.](?=\d{3}\b)/g, ''), /\d+/g);
  if (numbers(source) !== numbers(target)) add('number-mismatch', `${numbers(source) || 'none'} → ${numbers(target) || 'none'}`);
  if (sortedMatches(source, URL_PATTERN) !== sortedMatches(target, URL_PATTERN)) add('url-mismatch');
  if (sortedMatches(source, EMAIL) !== sortedMatches(target, EMAIL)) add('email-mismatch');

  const sourceLength = comparableText(source, sourceLang, targetLang, masks).length;
  const targetLength = visibleText(target).length;
  const comparedLength = comparableText(target, targetLang, sourceLang, masks).length;
  const ratio = sourceLength > 0 ? comparedLength / sourceLength : 0;
  if (sourceLength >= MIN_SOURCE_LENGTH) {
    const [low, high] = sourceLength >= LONG_SOURCE_LENGTH ? range.long : range.short;
    if (ratio < low || ratio > high) add('length', `ratio ${ratio.toFixed(2)}, normal ${low}–${high}`);
  }
  const width = Math.round(textWidth(visibleText(target), ui.fontPx));
  if (tight && ratio > range.ui && width > ui.narrowestControlPx) add('ui-length', `ratio ${ratio.toFixed(2)}, limit ${range.ui}, about ${width}px wide`);
  if (button && width > ui.fullRowButtonPx) add('ui-overflow', `about ${width}px, a full row holds ${ui.fullRowButtonPx}px`);
  if (clipped && textWidth(visibleText(target), ui.fontPx) > textWidth(visibleText(source), ui.fontPx)) add('ui-clipped', `${clipped} on the element, about ${width}px wide`);
  for (const sign of truncationSigns(source, target, targetBase)) add('possible-truncation', sign);
  if (metadataField && targetLength > METADATA_LIMITS[metadataField]) add('metadata-length', `${targetLength} characters, usually shown up to ${METADATA_LIMITS[metadataField]}`);
  if (NEGATION[sourceBase]?.test(visibleText(source)) && NEGATION[targetBase] && !NEGATION[targetBase].test(visibleText(target))) add('negation-mismatch');
  if (sourceBase === 'he' && firstTarget && CONSTRUCT_ARTICLE.test(visibleText(source))) add('construct-article', 'in the source');

  if (finalMark(source) !== finalMark(target)) add('final-punctuation', `"${finalMark(source)}" → "${finalMark(target)}"`);
  if (target !== target.trim() && source === source.trim()) add('edge-whitespace');
  if (/\S {2,}\S/.test(target) && !/\S {2,}\S/.test(source)) add('double-space');
  const sourceFirst = firstLetter(source);
  const targetFirst = firstLetter(target);
  if (sourceFirst && targetFirst && hasCase(sourceFirst) && hasCase(targetFirst)) {
    const upper = (letter) => letter === letter.toUpperCase();
    if (upper(sourceFirst) !== upper(targetFirst)) add('capitalization');
  }

  if (!french) return;
  const prose = target.replace(/<\/?[A-Za-z0-9_-]+\s*\/?>/g, '');
  for (const match of prose.matchAll(ELISION)) add('fr-elision', match[0].trim());
  if (/(?<![\p{L}\-'’])si\s+ils?\b/iu.test(prose)) add('fr-elision', 'si il');
  for (const match of prose.matchAll(POSSESSIVE)) add('fr-possessive', match[0].trim());
  for (const match of prose.matchAll(WORD_BEFORE_PLACEHOLDER)) {
    if (!NUMERIC_PLACEHOLDER.test(match[2])) add('fr-word-before-placeholder', `${match[1]} {{${match[2]}}}`);
  }
  if (/\p{L}·\p{L}/u.test(prose)) add('fr-inclusive-dot');
  const tuForm = prose.match(TU_FORMS);
  if (tuForm && !TU_FALSE_FRIENDS.test(prose)) add('fr-tu-form', tuForm[0]);
  const reader = prose.match(READER_GENDER);
  if (reader) add('fr-reader-gender', reader[0]);
  if (/(^|[.!?]\s+)A (?=\p{Ll})/u.test(prose)) add('fr-unaccented-capital');
  for (const issue of frenchSpacingIssues(target)) add('fr-spacing', issue);
}

// One unit to compare: a namespace file in folder mode, or one file in file mode.
function loadSets(options, namespaces, targetLang) {
  if (options.fileMode) {
    const projectRoot = process.cwd();
    const path = options.targetFiles[targetLang];
    const format = detectFormat(path, options.format);
    if (!format) fail(EXIT.usage, `Can't tell the format of ${path}. Pass --format, one of: ${FORMATS.join(', ')}.`);
    if (!existsSync(path)) fail(EXIT.input, `Target file not found: ${path}`);
    const read = (file, kind) => {
      try {
        return readTranslations(file, kind, projectRoot);
      } catch (error) {
        return fail(EXIT.input, `Could not read ${file}: ${error.message}`);
      }
    };
    const target = read(path, format);
    let sourceMap = target.sources;
    if (options.sourceFile) sourceMap = read(options.sourceFile, detectFormat(options.sourceFile, options.format)).entries;
    if (!sourceMap) fail(EXIT.usage, `${format} files don't carry their source text. Pass --source-file FILE.`);
    return [{ ns: basename(path), sourceMap, targetMap: target.entries, style: target.style, unfinished: target.unfinished ?? new Set() }];
  }
  return namespaces.map((ns) => {
    const sourceMap = loadFile(join(options.sourceRoot, options.source, `${ns}.json`));
    const targetPath = join(options.targetRoot, targetLang, `${ns}.json`);
    const targetMap = existsSync(targetPath) ? loadFile(targetPath) : new Map();
    if (!existsSync(targetPath)) process.stderr.write(`Note: ${targetPath} does not exist, so all its keys count as missing.\n`);
    return { ns, sourceMap, targetMap, style: 'i18next', unfinished: new Set() };
  });
}

function checkFormat(add, source, target, style) {
  if (style === 'i18next') return;
  if (style === 'icu') {
    const parsed = parseIcu(target);
    if (parsed.error && !parseIcu(source).error) add('icu-syntax', parsed.error);
  }
  const expected = placeholders(source, style).join(' ');
  const actual = placeholders(target, style).join(' ');
  if (expected !== actual) add(style === 'printf' || style === 'dotnet' ? 'format-specifier-mismatch' : 'placeholder-mismatch', `${expected || 'none'} → ${actual || 'none'}`);
}

function icuPluralGaps(target, language) {
  const gaps = [];
  for (const plural of parseIcu(target).plurals) {
    const { required } = pluralCategories(language, plural.ordinal ? 'ordinal' : 'cardinal');
    for (const category of required) {
      // `=1` covers `one` only where `one` means exactly 1, as i18next-cli reads it.
      if (!plural.categories.includes(category) && !(category === 'one' && plural.categories.includes('=1'))) gaps.push(`${plural.argument}: ${category}`);
    }
  }
  return gaps;
}

function usageContext(options, key, ns) {
  const uses = options.usage?.find(key, ns) ?? [];
  const known = uses.some((use) => use.kind !== 'value');
  const metadataField = /(^|\.)meta\.(title|ogTitle)$/.test(key) ? 'title' : /(^|\.)meta\.(description|ogDescription)$/.test(key) ? 'description' : undefined;
  return {
    uses,
    tight: known ? uses.some((use) => use.tight) : options.uiPattern.test(key),
    button: uses.some((use) => /^[Bb]utton$/.test(use.element)),
    clipped: uses.find((use) => use.clipped)?.clipped,
    metadataField,
  };
}

function auditLanguage(options, namespaces, targetLang, thresholds, findings) {
  const pair = `${options.source}>${targetLang}`;
  const range = thresholds.pairs[pair] ?? DEFAULT_RANGE;
  const cardinal = pluralCategories(targetLang, 'cardinal');
  const ordinal = pluralCategories(targetLang, 'ordinal');
  const coverage = {};
  const apostrophes = { straight: [], curly: [] };
  const comparedPairs = [];

  for (const { ns, sourceMap, targetMap, style, unfinished } of loadSets(options, namespaces, targetLang)) {
    const add = (id, key, source, target, detail) => {
      const location = options.usage?.find(key, ns)[0];
      findings.push({ id, language: targetLang, ns, key, source, target, detail, usedIn: location ? `${location.file}:${location.line} ${location.element}` : undefined });
    };
    const compare = (key, sourceKey) => {
      const source = sourceMap.get(sourceKey);
      const target = targetMap.get(key);
      const { tight, button, clipped, metadataField } = usageContext(options, key, ns);
      const report = (id, detail) => add(id, key, source, target, detail);
      checkString(report, {
        source, target, sourceLang: options.source, targetLang, range, tight, button, clipped, metadataField, firstTarget: targetLang === options.targets[0], masks: range.masked ? options.masks : undefined, ui: options.ui,
      });
      checkFormat(report, source, target, style);
      if (style === 'icu') for (const gap of icuPluralGaps(target, targetLang)) report('missing-plural-form', gap);
      if (unfinished.has(key)) report('unfinished');
      comparedPairs.push({ ns, key, source, target });
      if (/\p{Script=Latin}'\p{Script=Latin}/u.test(target)) apostrophes.straight.push({ ns, key, target });
      if (/\p{Script=Latin}’\p{Script=Latin}/u.test(target)) apostrophes.curly.push({ ns, key, target });
    };

    const sourceGroups = style === 'i18next' ? pluralGroups(sourceMap.keys()) : new Map();
    const sourcePluralKeys = new Set([...sourceGroups.values()].flatMap((group) => [...group.forms.values()]));
    const knownTargetKeys = new Set();
    let total = 0;
    let translated = 0;

    for (const [base, group] of sourceGroups) {
      total += 1;
      const categories = group.ordinal ? ordinal : cardinal;
      // A language can need a form the source lacks, or lack one the source has, so forms are read as a group, and even
      // a group with no `_other` still belongs to this source key.
      const present = PLURAL_FORMS.filter((category) => targetMap.has(`${base}_${category}`));
      for (const category of present) knownTargetKeys.add(`${base}_${category}`);
      const filled = present.filter((category) => targetMap.get(`${base}_${category}`));
      if (filled.length === 0) {
        add('missing', base, sourceMap.get(group.forms.get('other')), undefined, 'plural');
        continue;
      }
      const gaps = categories.required.filter((category) => !filled.includes(category));
      if (gaps.length === 0) translated += 1;
      for (const category of gaps) add('missing-plural-form', `${base}_${category}`, sourceMap.get(group.forms.get('other')), undefined);
      for (const category of categories.all) {
        if (!categories.required.includes(category) && !filled.includes(category)) add('optional-plural-form', `${base}_${category}`, undefined, undefined);
      }
      for (const category of filled) {
        const key = `${base}_${category}`;
        if (category !== 'zero' && !categories.all.includes(category)) add('unused-plural-form', key, undefined, targetMap.get(key));
        compare(key, group.forms.get(category) ?? group.forms.get('other'));
      }
    }

    for (const [key, source] of sourceMap) {
      if (sourcePluralKeys.has(key)) continue;
      total += 1;
      if (!targetMap.has(key)) {
        const nested = [...targetMap.keys()].some((other) => other.startsWith(`${key}.`));
        add(nested ? 'structure-mismatch' : 'missing', key, source, undefined);
        continue;
      }
      knownTargetKeys.add(key);
      if (targetMap.get(key).trim() === '') {
        if (source.trim() !== '') add('empty', key, source, '');
        continue;
      }
      translated += 1;
      compare(key, key);
    }

    for (const [key, target] of targetMap) {
      if (knownTargetKeys.has(key)) continue;
      const parent = [...sourceMap.keys()].some((other) => key.startsWith(`${other}.`));
      const nestedInSource = parent || [...sourceMap.keys()].some((other) => other.startsWith(`${key}.`));
      if (nestedInSource) {
        if (parent) add('structure-mismatch', key, undefined, target);
        continue;
      }
      add('orphaned', key, undefined, target);
    }
    // An entry the file marks as not final is left out of the compiled file, so readers don't get it yet.
    const final = translated - [...unfinished].filter((key) => targetMap.get(key)).length;
    coverage[ns] = { sourceKeys: total, translated: final, percent: total === 0 ? 100 : Math.round((final / total) * 1000) / 10, ...(final === translated ? {} : { unfinished: translated - final }) };
  }

  if (apostrophes.straight.length > 0 && apostrophes.curly.length > 0) {
    const minority = apostrophes.straight.length <= apostrophes.curly.length ? apostrophes.straight : apostrophes.curly;
    const form = minority === apostrophes.straight ? 'straight' : 'curly';
    for (const { ns, key, target } of minority) {
      findings.push({ id: 'mixed-apostrophes', language: targetLang, ns, key, target, detail: `${form} here, the other form elsewhere` });
    }
  }
  const termsFile = glossaryPath(options, targetLang);
  let glossary;
  if (termsFile && existsSync(termsFile)) {
    const result = glossaryFindings(compileGlossary(parseGlossary(termsFile)), comparedPairs);
    glossary = { terms: result.total, applied: result.applied };
    for (const { ns, key, source, target, detail } of result.findings) findings.push({ id: 'glossary-review', language: targetLang, ns, key, source, target, detail });
  }
  return { coverage, glossary };
}

async function runLint(options, namespaces, findings) {
  const cli = await importFromProject(process.cwd(), 'i18next-cli');
  if (!cli?.runLinter) fail(EXIT.input, 'i18next-cli is not installed here, so placeholders were not checked.\n       Run npm install, or pass --no-lint to skip this check.');
  let result;
  try {
    result = await cli.runLinter({
      locales: [options.source, ...options.targets],
      extract: {
        // `lint` needs one code file to read. This file shows no text to users, so only the translation files are compared.
        input: [fileURLToPath(import.meta.url)],
        primaryLanguage: options.source,
        // A function, because the source and the targets can sit in different folders.
        output: (language, namespace) => `${language === options.source ? options.sourceRoot : options.targetRoot}/${language}/${namespace}.json`,
        defaultNS: false,
      },
      lint: { checkTranslationPlaceholders: 'error', checkInterpolationParams: false, checkConcatenation: 'off' },
    });
  } catch (error) {
    fail(EXIT.input, `i18next-cli lint failed, so placeholders were not checked: ${error.message}\n       Pass --no-lint to skip this check.`);
  }
  let found = 0;
  for (const [file, issues] of Object.entries(result.files)) {
    const [, language, ns] = file.match(/([^/]+)\/([^/]+)\.json$/) ?? [];
    for (const issue of issues.filter((item) => item.type === 'placeholder')) {
      const split = issue.text.indexOf(': ');
      found += 1;
      if (namespaces.includes(ns)) findings.push({ id: 'placeholder-mismatch', language, ns, key: issue.text.slice(0, split), detail: issue.text.slice(split + 2).replace(/ \(compared with.*$/, '') });
    }
  }
  return found > 0 ? 'found issues' : 'passed';
}

async function report(options, namespaces, thresholds) {
  const findings = [];
  const coverage = {};
  const glossary = {};
  for (const language of options.targets) {
    const result = auditLanguage(options, namespaces, language, thresholds, findings);
    coverage[language] = result.coverage;
    if (result.glossary) glossary[language] = result.glossary;
  }
  const lint = options.fileMode ? 'built-in' : options.lint ? await runLint(options, namespaces, findings) : 'skipped';
  if (options.checkNext) for (const finding of scanNextCode(process.cwd(), options.nextRoot)) findings.push({ ...finding, language: 'code', ns: 'code' });

  // lint compares a plural group only when it is complete, so a missing form also shows up on its siblings. That is the same
  // fault, already reported as missing-plural-form, and a fix for it clears both.
  const pluralBase = (key) => key.replace(/(_ordinal)?_(zero|one|two|few|many|other)$/, '');
  const brokenPlurals = new Set(findings.filter((finding) => finding.id === 'missing-plural-form').map((finding) => `${finding.language}|${finding.ns}|${pluralBase(finding.key)}`));
  const isSideEffect = (finding) => finding.id === 'placeholder-mismatch' && brokenPlurals.has(`${finding.language}|${finding.ns}|${pluralBase(finding.key)}`);

  const changed = options.changedSince ? changedKeys(options, namespaces) : undefined;
  const inScope = (finding) => !isSideEffect(finding) && (!options.lang || finding.language === options.lang) && (!changed || finding.language === 'code' || changed.has(`${finding.language}|${finding.ns}|${finding.key}`));
  const visible = findings.filter(inScope);
  const groups = new Map();
  for (const finding of visible) {
    const id = `${finding.id}|${finding.language}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(finding);
  }
  const summary = { critical: 0, warning: 0, style: 0 };
  for (const finding of visible) summary[CHECKS[finding.id][0]] += 1;

  // Only the overview shortens text, and it says so on each row. --check always prints the whole string.
  const length = options.check ? Infinity : SNIPPET_LENGTH;
  const limit = options.limit ?? (options.check ? DEFAULT_CHECK_LIMIT : DEFAULT_EXAMPLES);
  const checks = [...groups.values()]
    .filter((group) => !options.check || group[0].id === options.check)
    .sort((a, b) => SEVERITY_ORDER[CHECKS[a[0].id][0]] - SEVERITY_ORDER[CHECKS[b[0].id][0]] || b.length - a.length)
    .map((group) => ({
      id: group[0].id,
      severity: CHECKS[group[0].id][0],
      language: group[0].language,
      description: CHECKS[group[0].id][1],
      count: group.length,
      shown: group.slice(options.offset, options.offset + limit).length,
      findings: group.slice(options.offset, options.offset + limit).map(({ ns, key, source, target, detail, usedIn }) => ({
        ns,
        key,
        source: snippet(source, length),
        target: snippet(target, length),
        detail,
        usedIn,
        ...((source?.length > length || target?.length > length) ? { textCut: true } : {}),
      })),
    }));

  process.stdout.write(`${JSON.stringify({
    source: options.source,
    targets: options.targets,
    namespaces,
    placeholderCheck: lint,
    summary,
    coverage,
    usage: usageSummary(options, namespaces),
    glossary,
    lengthCatchRate: catchRates(options, thresholds),
    lengthThresholdsNote: thresholds.provisional,
    changedSince: options.changedSince,
    scope: {
      measured: 'Keys, placeholders, tags, plural forms, numbers, addresses, length, width, typography and word patterns.',
      notChecked: 'Meaning, tone and whether a term fits its context. A person or an independent reviewer has to read those, so an empty report does not mean the translation is right.',
    },
    checks,
    more: options.check ? undefined : 'Each check shows its first findings, and a row with textCut shortens its text. Use --check ID --lang LANG for every finding with its whole text.',
  }, null, 2)}\n`);
  return findings.some((finding) => CHECKS[finding.id][0] === 'critical') ? EXIT.critical : EXIT.clean;
}

function catchRates(options, thresholds) {
  return Object.fromEntries(options.targets.flatMap((language) => {
    const rate = thresholds.pairs[`${options.source}>${language}`]?.catchRate;
    return rate ? [[`${options.source}>${language}`, rate]] : [];
  }));
}

function usageSummary(options, namespaces) {
  if (!options.usage) return { checked: false, reason: options.usageReason };
  const summary = {};
  for (const ns of namespaces) {
    const keys = [...loadFile(join(options.sourceRoot, options.source, `${ns}.json`)).keys()];
    const unresolved = keys.filter((key) => options.usage.find(key, ns).length === 0);
    summary[ns] = { keys: keys.length, found: keys.length - unresolved.length, unresolved: unresolved.length, examples: unresolved.slice(0, 3) };
  }
  return { checked: true, namespaces: summary };
}

function changedKeys(options, namespaces) {
  const changed = new Set();
  for (const language of options.targets) {
    for (const ns of namespaces) {
      const path = join(options.targetRoot, language, `${ns}.json`);
      if (!existsSync(path)) continue;
      let before = new Map();
      try {
        before = flatten(JSON.parse(execFileSync('git', ['show', `${options.changedSince}:${relative(process.cwd(), path)}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 })));
      } catch {
        process.stderr.write(`Note: ${path} is not in ${options.changedSince}, so all its keys count as changed.\n`);
      }
      for (const [key, value] of loadFile(path)) if (before.get(key) !== value) changed.add(`${language}|${ns}|${key}`);
    }
  }
  return changed;
}

function fingerprint(source, target) {
  return createHash('sha256').update(`${source ?? ''}\u0000${target ?? ''}`).digest('hex').slice(0, 12);
}

// A plural form the source language lacks, like French `_many`, is read against the source's `_other`.
function sourceOf(sourceMap, key) {
  if (sourceMap.has(key)) return sourceMap.get(key);
  const match = key.match(PLURAL_KEY);
  return match ? sourceMap.get(`${match[1]}${match[2] ?? ''}_other`) : undefined;
}

function allRows(options, namespaces) {
  const rows = new Map();
  for (const language of options.targets) {
    for (const { ns, sourceMap, targetMap, style } of loadSets(options, namespaces, language)) {
      const source = (key) => (style === 'i18next' ? sourceOf(sourceMap, key) : sourceMap.get(key));
      for (const key of new Set([...sourceMap.keys(), ...targetMap.keys()])) {
        const id = `${ns}|${key}`;
        if (!rows.has(id)) {
          const usedIn = (options.usage?.find(key, ns) ?? []).slice(0, 3).map((use) => `${use.file}:${use.line} ${use.element}`);
          rows.set(id, { ns, key, [options.source]: source(key), usedIn, hash: {} });
        }
        const row = rows.get(id);
        row[language] = targetMap.get(key);
        row.hash[language] = fingerprint(source(key), targetMap.get(key));
      }
    }
  }
  return [...rows.values()].map(({ usedIn, hash, ...text }) => ({ ...text, usedIn, hash }));
}

function dump(options, namespaces) {
  const changed = options.changedSince ? changedKeys(options, namespaces) : undefined;
  const rows = allRows(options, namespaces).filter((row) => !changed || options.targets.some((language) => changed.has(`${language}|${row.ns}|${row.key}`)));
  const limit = options.limit ?? DEFAULT_DUMP_LIMIT;
  const page = rows.slice(options.offset, options.offset + limit);
  for (const row of page) process.stdout.write(`${JSON.stringify(row)}\n`);
  const end = options.offset + page.length;
  process.stderr.write(`Rows ${options.offset + 1}-${end} of ${rows.length}.${end < rows.length ? ` Next: --offset ${end}` : ''}\n`);
}

// The record of a reading: one JSON line per key and language, { ns, key, lang, hash, verdict, note }. The script can't
// judge meaning, but it can prove that every string was read, and that none changed after it was read.
const REVIEW_VERDICTS = new Set(['ok', 'issue']);

function checkReview(options, namespaces) {
  if (!existsSync(options.review)) fail(EXIT.input, `Review file not found: ${options.review}`);
  const lines = readFileSync(options.review, 'utf8').split('\n').filter((line) => line.trim() !== '');
  const reviewed = new Map();
  const invalid = [];
  lines.forEach((line, index) => {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      invalid.push({ line: index + 1, reason: 'not JSON' });
      return;
    }
    if (!REVIEW_VERDICTS.has(row.verdict)) invalid.push({ line: index + 1, reason: 'verdict must be ok or issue', key: row.key });
    else if (row.verdict === 'issue' && !row.note) invalid.push({ line: index + 1, reason: 'an issue needs a note', key: row.key });
    else reviewed.set(`${row.lang}|${row.ns}|${row.key}`, row);
  });
  const missing = [];
  const stale = [];
  const verdicts = { ok: 0, issue: 0 };
  for (const row of allRows(options, namespaces)) {
    for (const language of options.targets) {
      if (row[language] === undefined || row[options.source] === undefined) continue;
      const id = `${language}|${row.ns}|${row.key}`;
      const entry = reviewed.get(id);
      if (!entry) missing.push(id);
      else if (entry.hash !== row.hash[language]) stale.push(id);
      else verdicts[entry.verdict] += 1;
    }
  }
  const limit = options.limit ?? DEFAULT_CHECK_LIMIT;
  process.stdout.write(`${JSON.stringify({
    complete: missing.length === 0 && stale.length === 0 && invalid.length === 0,
    verdicts,
    missing: { count: missing.length, keys: missing.slice(options.offset, options.offset + limit) },
    stale: { count: stale.length, keys: stale.slice(options.offset, options.offset + limit) },
    invalid: { count: invalid.length, lines: invalid.slice(0, limit) },
  }, null, 2)}\n`);
  return missing.length + stale.length + invalid.length === 0 ? EXIT.clean : EXIT.critical;
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
}

// Rounded outward to 0.05, so the published range never excludes a value the measurement included.
const roundDown = (value) => Math.floor(value * 20 + 1e-9) / 20;
const roundUp = (value) => Math.ceil(value * 20 - 1e-9) / 20;

function calibrate(options, namespaces) {
  const languages = [options.source, ...options.targets];
  const maps = Object.fromEntries(languages.map((language) => {
    const root = language === options.source ? options.sourceRoot : options.targetRoot;
    const merged = new Map();
    for (const ns of namespaces) {
      const path = join(root, language, `${ns}.json`);
      if (existsSync(path)) for (const [key, value] of loadFile(path)) merged.set(`${ns}:${key}`, value);
    }
    return [language, merged];
  }));
  const pairs = {};
  for (const from of languages) {
    for (const to of languages) {
      if (from === to) continue;
      const measure = (masks) => {
        const comparable = [...maps[from]].flatMap(([key, value]) => {
          const target = maps[to].get(key);
          return target ? [[comparableText(value, from, to, masks).length, comparableText(target, to, from, masks).length]] : [];
        });
        const ratios = (min, max) => comparable
          .filter(([length]) => length >= min && length < max)
          .map(([length, targetLength]) => targetLength / length)
          .sort((a, b) => a - b);
        const short = ratios(MIN_SOURCE_LENGTH, LONG_SOURCE_LENGTH);
        const long = ratios(LONG_SOURCE_LENGTH, Infinity);
        const all = ratios(MIN_SOURCE_LENGTH, Infinity);
        if (all.length === 0) return undefined;
        // The middle 95%: wide enough to leave normal strings alone, narrow enough to catch a translation cut in half.
        // A few legitimately short strings can pull the 2.5th percentile far down, and then a translation cut in half passes.
        // So the floor never drops below this share of the median: a typical string cut in half lands at 0.5 of the median.
        const span = (values) => [
          Math.max(roundDown(percentile(values, 0.025)), roundDown(percentile(values, 0.5) * MIN_FLOOR_OF_MEDIAN)),
          roundUp(percentile(values, 0.975)),
        ];
        const ranges = { short: span(short.length > 0 ? short : all), long: span(long.length > 0 ? long : all) };
        // How often this range would catch a real fault, tried on these same strings, so each pair states its own strength.
        const outside = (values, [low, high], change) => values.filter((ratio) => ratio * change < low || ratio * change > high).length;
        const share = (count, total) => (total === 0 ? null : Math.round((count / total) * 100) / 100);
        const caught = (change) => share(outside(short, ranges.short, change) + outside(long, ranges.long, change), all.length);
        const caughtShort = (change) => share(outside(short, ranges.short, change), short.length);
        return {
          ...ranges,
          ui: Math.round(percentile(all, 0.5) * UI_MARGIN * 100) / 100,
          sample: { short: short.length, long: long.length },
          catchRate: {
            halfCut: caught(0.5),
            thirdCut: caught(0.7),
            doubled: caught(2),
            under80Characters: { halfCut: caughtShort(0.5), thirdCut: caughtShort(0.7), doubled: caughtShort(2) },
          },
        };
      };
      const plain = measure(undefined);
      if (!plain) continue;
      // Masking helps one direction and can hurt another, so each pair keeps whichever catches more cut translations.
      const masked = options.masks[from] && options.masks[to] ? measure(options.masks) : undefined;
      pairs[`${from}>${to}`] = masked && masked.catchRate.halfCut > plain.catchRate.halfCut ? { ...masked, masked: true } : plain;
    }
  }
  const result = `${JSON.stringify({ measuredOn: new Date().toISOString().slice(0, 10), pairs }, null, 2)}\n`;
  if (!options.out) {
    process.stdout.write(result);
    return;
  }
  // Written beside the target and renamed into place, so a failed run never leaves an empty thresholds file.
  const temporary = `${options.out}.${process.pid}.tmp`;
  writeFileSync(temporary, result);
  renameSync(temporary, options.out);
  process.stderr.write(`Wrote ${options.out}\n`);
}

function glossaryPath(options, language) {
  return options.glossaries[language] ?? [options.targetRoot, options.sourceRoot].map((root) => join(root, language, 'glossary.md')).find(existsSync);
}

async function main() {
  const options = readOptions();
  await connectI18next();
  try {
    const paths = [...Object.values(options.targetFiles), options.sourceFile].filter(Boolean);
    await prepareFormats(process.cwd(), paths.map((path) => detectFormat(path, options.format)));
  } catch (error) {
    fail(EXIT.input, `${error.message}. Run npm install in the project.`);
  }
  const glossaries = Object.fromEntries([options.source, ...options.targets].flatMap((language) => {
    const path = glossaryPath(options, language);
    return path && existsSync(path) ? [[language, parseGlossary(path)]] : [];
  }));
  options.masks = lengthMasks(glossaries);
  if (options.thresholds) {
    process.stdout.write(`${JSON.stringify(loadThresholds(), null, 2)}\n`);
    return EXIT.clean;
  }
  const namespaces = options.fileMode ? [] : listNamespaces(options);
  // Before the thresholds are read: `--calibrate > length-thresholds.json` has already emptied that file.
  if (options.calibrate) {
    calibrate(options, namespaces);
    return EXIT.clean;
  }
  if (options.useUsage) {
    const scan = scanUsage(process.cwd(), options.codeRoot);
    if (scan.available) options.usage = usageIndex(scan);
    else options.usageReason = scan.reason;
  } else {
    options.usageReason = options.fileMode ? 'not used for single files' : 'turned off with --no-usage';
  }
  if (options.review) return checkReview(options, namespaces);
  if (options.dump) {
    dump(options, namespaces);
    return EXIT.clean;
  }
  return report(options, namespaces, loadThresholds());
}

process.exitCode = await main();
