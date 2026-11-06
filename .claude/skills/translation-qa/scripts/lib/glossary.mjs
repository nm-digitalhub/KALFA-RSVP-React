// Reads the term tables in a Markdown glossary (first column Hebrew, second column the translation), so the glossary
// stays the one place where a term is decided. Only rows the matcher can apply reliably become checks.
import { readFileSync } from 'node:fs';

const HEBREW = /[֐-׿]/;
const HEBREW_WORD = /[֐-׿][֐-׿'"׳״-]*/g;
// A note in the target cell means the row records a decision, not a word to look for.
const NOT_A_TERM = /לא תורגם|לא מתורגם|ללא תרגום|ראו `?notes/;
// Hebrew joins these letters to the next word, up to three at a time: `ולאורחים`, `שבאירוע`, `ב-WhatsApp`.
const HEBREW_PREFIX = '[ושהכלבמ]{0,3}-?';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function cells(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function clean(cell) {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[*_]{2}/g, '');
}

function hebrewForms(cell) {
  return clean(cell)
    .split(/[,;]/)
    .map((form) => form.replace(/\/[֐-׿]+/g, '').trim())
    .filter((form) => HEBREW.test(form) && !/[…?]/.test(form) && form.length >= 3);
}

function targetForms(cell) {
  return clean(cell)
    .split(/[,;]/)
    .map((form) => form.replace(HEBREW_WORD, ' ').replace(/\s+/g, ' ').trim())
    .filter((form) => /\p{L}{2}/u.test(form) && !/[…?!]/.test(form));
}

export function parseGlossary(path) {
  const terms = [];
  let inTable = false;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim().startsWith('|')) {
      inTable = false;
      continue;
    }
    const row = cells(line);
    if (/^עברית/.test(row[0] ?? '')) {
      inTable = true;
      continue;
    }
    if (!inTable || /^:?-+:?$/.test(row[0] ?? '') || row.length < 2 || NOT_A_TERM.test(row[1])) continue;
    const source = hebrewForms(row[0]);
    const target = targetForms(row[1]);
    if (source.length > 0 && target.length > 0) terms.push({ source, target });
  }
  return terms;
}

function sourcePattern(forms) {
  const alternatives = forms.map((form) => escapeRegExp(form).replace(/ /g, '\\s+')).join('|');
  return new RegExp(`(?<![\\p{L}])${HEBREW_PREFIX}(?:${alternatives})(?![\\p{L}])`, 'u');
}

// A leading article is not part of the term, and the last word may inflect, so `import` also matches `importer`,
// `invité` matches `invitées`, and `the system` matches `this system`.
const LEADING_ARTICLE = /^(the|a|an|le|la|les|l['’]|un|une|des)\s*/i;
const MAX_ENDING = 3;

function targetPattern(forms) {
  const inflected = (form) => {
    const words = form.replace(LEADING_ARTICLE, '').split(/\s+/).map((word) => escapeRegExp(word).replace(/['’]/g, "['’]"));
    words[0] = `${words[0]}(?:e|s|es|x)?`;
    if (words.length === 1) words[0] = `${escapeRegExp(form.replace(LEADING_ARTICLE, ''))}\\p{L}{0,${MAX_ENDING}}`;
    else words[words.length - 1] += `\\p{L}{0,${MAX_ENDING}}`;
    return words.join('[\\s\\u00A0\\u202F-]+');
  };
  return new RegExp(`(?<![\\p{L}])(?:${forms.map(inflected).join('|')})(?![\\p{L}])`, 'iu');
}

export function compileGlossary(terms) {
  return terms.map((term) => ({ ...term, sourceMatch: sourcePattern(term.source), targetMatch: targetPattern(term.target) }));
}

// A glossary row can record a choice for one screen, not a rule for every use of the word, so a row is applied only
// where the translations already follow it. Then a miss is an outlier worth reading, and not a word used in another sense.
const MIN_OCCURRENCES = 3;
const MIN_ADHERENCE = 0.6;

export function glossaryFindings(compiled, pairs) {
  const findings = [];
  let applied = 0;
  for (const term of compiled) {
    const hits = pairs.filter(({ source }) => term.sourceMatch.test(source));
    const misses = hits.filter(({ target }) => !term.targetMatch.test(target));
    if (hits.length < MIN_OCCURRENCES || (hits.length - misses.length) / hits.length < MIN_ADHERENCE) continue;
    applied += 1;
    for (const miss of misses) findings.push({ ...miss, detail: `${term.source[0]} → ${term.target.join(' / ')}, followed in ${hits.length - misses.length} of ${hits.length}` });
  }
  return { findings, applied, total: compiled.length };
}

// When a term is twice as long in one language as in another, it alone can move a string's length ratio: `RSVP` against
// `confirmation de présence`. Masking those terms in both languages keeps the ratio about the sentence, which measurably
// raises how many cut translations the length check catches.
const DISTORTING_RATIO = 2;

export function lengthMasks(termsByLanguage) {
  const rows = new Map();
  for (const [language, terms] of Object.entries(termsByLanguage)) {
    for (const term of terms) {
      for (const form of term.source) {
        if (!rows.has(form)) rows.set(form, {});
        rows.get(form)[language] = term.target;
      }
    }
  }
  const forms = {};
  for (const row of rows.values()) {
    const languages = Object.keys(row);
    if (languages.length < 2) continue;
    const longest = languages.map((language) => Math.max(...row[language].map((form) => form.length)));
    if (Math.max(...longest) / Math.min(...longest) < DISTORTING_RATIO) continue;
    for (const language of languages) {
      forms[language] ??= new Set();
      for (const form of row[language]) forms[language].add(form);
    }
  }
  return Object.fromEntries(Object.entries(forms).map(([language, set]) => [
    language,
    new RegExp(`(?<![\\p{L}])(?:${[...set].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})s?(?![\\p{L}])`, 'giu'),
  ]));
}
