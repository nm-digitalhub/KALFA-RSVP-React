// Run from the project root: node --test .claude/skills/translation-qa/scripts/check_translations.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'check_translations.mjs');
const PROJECT_ROOT = resolve(HERE, '../../../..');
const folders = [];

const CLEAN = {
  he: {
    greeting: 'שלום {{name}},',
    save: 'שמירה',
    items_one: 'פריט אחד',
    items_two: 'שני פריטים',
    items_other: '{{count}} פריטים',
    note: 'ההודעה נשלחה בהצלחה לכל האורחים שלך היום.',
    link: 'לפרטים ב<faq>שאלות נפוצות</faq> באתר',
    hours: 'עד 24 שעות לפני תחילת האירוע בערב',
    web: 'פרטים נוספים ב-https://example.com או ב-a@example.com',
    cta: { go: 'המשך' },
  },
  en: {
    greeting: 'Hello {{name}},',
    save: 'Save',
    items_one: 'One item',
    items_other: '{{count}} items',
    note: 'The message was sent successfully to all your guests today.',
    link: 'See the <faq>FAQ</faq> on the website',
    hours: 'Up to 24 hours before the evening event starts',
    web: 'More details at https://example.com or a@example.com',
    cta: { go: 'Continue' },
  },
  fr: {
    greeting: 'Bonjour {{name}},',
    save: 'Enregistrer',
    items_one: '{{count}} élément',
    items_many: '{{count}} d’éléments',
    items_other: '{{count}} éléments',
    note: 'Le message a bien été envoyé à tous vos invités aujourd’hui.',
    link: 'Consultez les <faq>questions fréquentes</faq> sur le site',
    hours: 'Jusqu’à 24 heures avant le début de la soirée',
    web: 'Plus d’informations sur https://example.com ou a@example.com',
    cta: { go: 'Continuer' },
  },
};

function fixture(change = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'translation-qa-'));
  folders.push(root);
  const files = structuredClone(CLEAN);
  change(files);
  for (const [language, content] of Object.entries(files)) {
    mkdirSync(join(root, language));
    writeFileSync(join(root, language, 'app.json'), JSON.stringify(content));
  }
  return root;
}

function run(args, script = SCRIPT) {
  const result = spawnSync('node', [script, ...args], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return { ...result, json };
}

// The code scan has its own tests below, so most cases skip it and use the fallback key pattern.
function audit(change, extra = []) {
  return run(['--source-root', fixture(change), '--no-usage', ...extra]);
}

function found(result, id, language) {
  return result.json.checks.find((check) => check.id === id && (!language || check.language === language));
}

after(() => folders.forEach((folder) => rmSync(folder, { recursive: true, force: true })));

describe('a correct set of files', () => {
  it('reports nothing', () => {
    const result = audit();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.json.checks, []);
    assert.deepEqual(result.json.summary, { critical: 0, warning: 0, style: 0 });
    assert.equal(result.json.placeholderCheck, 'passed');
    assert.equal(result.json.coverage.fr.app.percent, 100);
  });
});

describe('planted defects', () => {
  const cases = [
    ['placeholder-mismatch', 'critical', 'fr', (f) => { f.fr.greeting = 'Bonjour {{nom}},'; }],
    ['broken-tags', 'critical', 'fr', (f) => { f.fr.link = 'Consultez les <faq>questions fréquentes sur le site'; }],
    ['missing-plural-form', 'critical', 'en', (f) => { delete f.en.items_other; }],
    ['structure-mismatch', 'critical', 'fr', (f) => { f.fr.save = { label: 'Enregistrer' }; }],
    ['missing', 'warning', 'en', (f) => { delete f.en.save; }],
    ['empty', 'warning', 'en', (f) => { f.en.save = ''; }],
    ['orphaned', 'warning', 'en', (f) => { f.en.removed = 'Gone'; }],
    ['identical', 'warning', 'en', (f) => { f.en.save = 'שמירה'; }],
    ['source-script-left', 'warning', 'en', (f) => { f.en.note = 'The message was sent to all your אורחים today, as planned.'; }],
    ['unused-plural-form', 'warning', 'en', (f) => { f.en.items_two = 'Two items'; }],
    ['number-mismatch', 'warning', 'en', (f) => { f.en.hours = 'Up to 48 hours before the evening event starts'; }],
    ['url-mismatch', 'warning', 'en', (f) => { f.en.web = 'More details at https://example.org or a@example.com'; }],
    ['email-mismatch', 'warning', 'en', (f) => { f.en.web = 'More details at https://example.com or b@example.com'; }],
    ['length', 'warning', 'fr', (f) => { f.fr.note = 'Envoyé.'; }],
    ['ui-length', 'warning', 'fr', (f) => { f.fr.cta.go = 'Continuer vers la page suivante'; }],
    ['fr-elision', 'warning', 'fr', (f) => { f.fr.note = 'Le message de invitation a bien été envoyé à vos invités.'; }],
    ['fr-possessive', 'warning', 'fr', (f) => { f.fr.note = 'Le message a bien été envoyé à sa amie et à tous vos invités.'; }],
    ['fr-word-before-placeholder', 'warning', 'fr', (f) => { f.fr.greeting = 'La réponse de {{name}},'; }],
    ['fr-inclusive-dot', 'warning', 'fr', (f) => { f.fr.save = 'Invité·e'; }],
    ['fr-tu-form', 'warning', 'fr', (f) => { f.fr.save = 'Choisis ton menu'; }],
    ['fr-reader-gender', 'warning', 'fr', (f) => { f.fr.save = 'Vous êtes invité à répondre'; }],
    ['negation-mismatch', 'warning', 'fr', (f) => { f.he.save = 'לא נשמר'; f.fr.save = 'Enregistré'; }],
    ['possible-truncation', 'warning', 'en', (f) => { f.en.note = 'The message was sent successfully to all of your'; }],
    ['possible-truncation', 'warning', 'fr', (f) => { f.fr.note = 'Le message a bien été envoyé (à tous vos invités aujourd’hui.'; }],
    ['metadata-length', 'style', 'en', (f) => { f.he.page = { meta: { title: 'כותרת' } }; f.en.page = { meta: { title: 'A very long title that goes on well past what search engines usually show' } }; f.fr.page = { meta: { title: 'Titre' } }; }],
    ['construct-article', 'style', 'en', (f) => { f.he.save = 'הרשימת המוזמנים'; }],
    ['final-punctuation', 'style', 'en', (f) => { f.en.note = 'The message was sent successfully to all your guests today'; }],
    ['edge-whitespace', 'style', 'en', (f) => { f.en.save = 'Save '; }],
    ['double-space', 'style', 'en', (f) => { f.en.note = 'The message was  sent successfully to all your guests today.'; }],
    ['optional-plural-form', 'style', 'fr', (f) => { delete f.fr.items_many; }],
    ['mixed-apostrophes', 'style', 'fr', (f) => { f.fr.hours = 'Jusqu\'à 24 heures avant le début de la soirée'; }],
    ['fr-spacing', 'style', 'fr', (f) => { f.fr.save = 'Enregistrer ?'; }],
    ['fr-unaccented-capital', 'style', 'fr', (f) => { f.fr.save = 'A bientôt'; }],
  ];
  for (const [id, severity, language, change] of cases) {
    it(`finds ${id}`, () => {
      const result = audit(change);
      const check = found(result, id, language);
      assert.ok(check, `${id} not reported: ${result.stdout}${result.stderr}`);
      assert.equal(check.severity, severity);
      assert.equal(result.status, severity === 'critical' ? 1 : 0);
    });
  }
});

describe('UI settings', () => {
  const settings = (root, values) => {
    const file = join(root, 'ui.json');
    writeFileSync(file, JSON.stringify(values));
    return ['--ui-settings', file];
  };
  const longLabel = (f) => { f.fr.cta.go = 'Continuer vers la page'; };
  it('reads another project\'s key names and limits', () => {
    const root = fixture((f) => { f.he.primary = 'המשך'; f.en.primary = 'Go'; f.fr.primary = 'Continuer vers la page'; });
    const result = run(['--source-root', root, '--no-usage', '--no-lint', ...settings(root, { keyPattern: '^primary$', narrowestControlPx: 10 })]);
    assert.equal(found(result, 'ui-length', 'fr').findings[0].key, 'primary');
  });
  it('a wider control exempts the label', () => {
    const root = fixture(longLabel);
    assert.equal(found(run(['--source-root', root, '--no-usage', '--no-lint', ...settings(root, { keyPattern: 'cta', narrowestControlPx: 500 })]), 'ui-length'), undefined);
  });
  it('explains a missing settings file', () => {
    const result = run(['--ui-settings', '/nonexistent.json']);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /settings file not found/);
  });
  it('--ui-pattern wins over the settings file', () => {
    const root = fixture(longLabel);
    assert.equal(found(run(['--source-root', root, '--no-usage', '--no-lint', '--ui-pattern', '^nothing$']), 'ui-length'), undefined);
  });
  it('the shipped numbers explain themselves', () => {
    const { why, ...values } = JSON.parse(readFileSync(join(HERE, 'ui-settings.json'), 'utf8'));
    for (const name of Object.keys(values)) assert.ok(why[name], name);
  });
  it('help names every format', () => {
    const help = run(['--help']).stdout;
    for (const format of ['PO', 'XLIFF', 'ARB', 'ICU', 'YAML', '.strings', '.resx']) assert.ok(help.includes(format), format);
  });
});

describe('text that is cut', () => {
  it('finds a translation with far fewer sentences', () => {
    const source = 'נשלחה הודעה. האורחים קיבלו אותה. התשובות נשמרות. אפשר לעקוב בכל רגע.';
    const result = audit((f) => { f.he.long = source; f.en.long = 'A message was sent and guests got it, so replies are saved.'; f.fr.long = 'Un message a été envoyé. Les invités l’ont reçu. Les réponses sont enregistrées. Vous pouvez suivre à tout moment.'; });
    assert.match(found(result, 'possible-truncation', 'en').findings[0].detail, /sentences/);
    assert.equal(found(result, 'possible-truncation', 'fr'), undefined);
  });
  it('accepts a complete sentence that ends with a colon or a bracket', () => {
    const result = audit((f) => { f.he.long = 'אפשר לבחור אחת מהאפשרויות הבאות כאן.'; f.en.long = 'You can choose from these options (all free).'; f.fr.long = 'Vous pouvez choisir parmi ces options\u00A0:'; });
    assert.equal(found(result, 'possible-truncation'), undefined);
  });
  it('marks a shortened row in the overview, and prints the whole text with --check', () => {
    const long = `${'The message was sent to every guest on the list '.repeat(4)}today, and it is here to stay.`;
    const change = (f) => { f.en.extra = long; };
    const overview = audit(change);
    const row = found(overview, 'orphaned').findings[0];
    assert.equal(row.textCut, true);
    const full = audit(change, ['--check', 'orphaned', '--lang', 'en']);
    assert.equal(full.json.checks[0].findings[0].target, long);
    assert.equal(full.json.checks[0].findings[0].textCut, undefined);
  });
  it('says how many findings it shows', () => {
    const check = found(audit((f) => { for (let i = 0; i < 5; i += 1) f.en[`gone${i}`] = 'Gone'; }), 'orphaned');
    assert.deepEqual([check.count, check.shown], [5, 3]);
  });
  it('finds an element that clips a wider translation, and leaves a shorter one alone', () => {
    const code = mkdtempSync(join(tmpdir(), 'translation-qa-clip-'));
    folders.push(code);
    writeFileSync(join(code, 'card.tsx'), "export default function Card() { const { t } = getT('app'); return <p className=\"truncate text-sm\">{t('note')}</p>; }");
    const wider = run(['--source-root', fixture(), '--no-lint', '--code-root', code]);
    assert.match(found(wider, 'ui-clipped', 'fr').findings[0].detail, /truncate/);
    const shorter = run(['--source-root', fixture((f) => { f.en.note = 'Sent to all your guests today.'; f.fr.note = 'Envoyé à tous vos invités.'; }), '--no-lint', '--code-root', code]);
    assert.equal(found(shorter, 'ui-clipped'), undefined);
  });
});

describe('a plural group missing a form', () => {
  it('reports one fault, and does not count the key as translated', () => {
    const result = audit((f) => { delete f.en.items_other; });
    assert.ok(found(result, 'missing-plural-form', 'en'));
    assert.equal(found(result, 'orphaned'), undefined);
    assert.equal(found(result, 'placeholder-mismatch'), undefined);
    assert.ok(result.json.coverage.en.app.percent < 100);
  });
  it('still checks the forms that are there', () => {
    const result = audit((f) => { delete f.en.items_other; f.en.items_one = 'Un item en עברית'; });
    assert.ok(found(result, 'source-script-left', 'en'));
  });
});

describe('correct French that must not be reported', () => {
  const clean = [
    ['de A à Z', 'Tout est prêt de A à Z'],
    ['a word before huit', 'Le huit est complet'],
    ['a hyphenated pronoun', 'Faites-le à votre rythme'],
    ['a narrow no-break space', 'Enregistrer ?'],
    ['a middle dot as a separator', 'KALFA · Tous droits réservés'],
    ['a time', 'Rendez-vous à 12:30'],
  ];
  for (const [name, text] of clean) {
    it(`accepts ${name}`, () => {
      const result = audit((f) => { f.fr.save = text; });
      assert.deepEqual(result.json.checks.filter((check) => check.id.startsWith('fr-')), [], result.stdout);
    });
  }
  it('accepts the noun ton, and a third-person verb', () => {
    const result = audit((f) => { f.fr.save = 'Le ton reste chaleureux, et KALFA envoie un message'; });
    assert.equal(found(result, 'fr-tu-form'), undefined);
  });
  it('keeps a negation expressed by a negative word', () => {
    const result = audit((f) => { f.he.save = 'הערה (לא חובה)'; f.fr.save = 'Remarque (facultatif)'; f.en.save = 'Unsupported type'; });
    assert.equal(found(result, 'negation-mismatch'), undefined);
  });
  it('allows an article before a count, which is printed in digits', () => {
    const result = audit((f) => { f.fr.items_other = 'Le {{count}} éléments'; });
    assert.equal(found(result, 'fr-word-before-placeholder'), undefined);
  });
});

describe('language pairs', () => {
  it('does not ask English for the Hebrew dual', () => {
    assert.equal(found(audit(), 'missing-plural-form'), undefined);
  });
  it('asks Hebrew for its dual when Hebrew is the target', () => {
    const result = audit((f) => { delete f.he.items_two; }, ['--source', 'en', '--targets', 'he', '--no-lint']);
    assert.equal(found(result, 'missing-plural-form', 'he').findings[0].key, 'items_two');
  });
  it('skips the capital check for a Hebrew source and applies it from English', () => {
    assert.equal(found(audit((f) => { f.fr.save = 'enregistrer'; }), 'capitalization'), undefined);
    const fromEnglish = audit((f) => { f.fr.save = 'enregistrer'; }, ['--source', 'en', '--targets', 'fr', '--no-lint']);
    assert.ok(found(fromEnglish, 'capitalization', 'fr'));
  });
  it('ignores a Hebrew prefix and sentence punctuation around an address', () => {
    const result = audit((f) => { f.en.web = 'More details at https://example.com. Or write to a@example.com.'; });
    assert.equal(found(result, 'url-mismatch'), undefined);
    assert.equal(found(result, 'email-mismatch'), undefined);
  });
  it('does not judge the length of a short source', () => {
    assert.equal(found(audit((f) => { f.en.save = 'Save this event and all of its details right now'; }), 'length'), undefined);
  });
});

describe('command line', () => {
  it('exits 2 on invalid arguments, with guidance', () => {
    for (const args of [['--nope'], ['--check', 'nope'], ['--limit', 'x'], ['--lang', 'de'], ['--ui-pattern', '(']]) {
      const result = run(args);
      assert.equal(result.status, 2, args.join(' '));
      assert.match(result.stderr, /Error:/);
    }
  });
  it('exits 3 when the source cannot be read', () => {
    const result = run(['--source-root', '/nonexistent']);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /Source folder not found/);
  });
  it('exits 3 on invalid JSON and names the file', () => {
    const root = fixture();
    writeFileSync(join(root, 'en', 'app.json'), '{ nope');
    const result = run(['--source-root', root]);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /en\/app\.json/);
  });
  it('counts a missing target file as missing keys', () => {
    const root = fixture();
    rmSync(join(root, 'en', 'app.json'));
    const result = run(['--source-root', root, '--no-lint']);
    assert.equal(result.json.coverage.en.app.translated, 0);
    assert.match(result.stderr, /does not exist/);
  });
  it('says when the placeholder check was skipped', () => {
    assert.equal(audit(undefined, ['--no-lint']).json.placeholderCheck, 'skipped');
  });
  it('limits the report and pages one check', () => {
    const change = (f) => { for (let i = 0; i < 6; i += 1) f.en[`gone${i}`] = 'Gone'; };
    const root = fixture(change);
    assert.equal(found(run(['--source-root', root]), 'orphaned').findings.length, 3);
    const page = run(['--source-root', root, '--check', 'orphaned', '--lang', 'en', '--limit', '2', '--offset', '4']);
    assert.deepEqual(page.json.checks[0].findings.map((finding) => finding.key), ['gone4', 'gone5']);
  });
  it('dumps rows side by side, one page at a time', () => {
    const result = spawnSync('node', [SCRIPT, '--source-root', fixture(), '--dump', '--limit', '2'], { cwd: PROJECT_ROOT, encoding: 'utf8' });
    const rows = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[0]), ['ns', 'key', 'he', 'en', 'fr', 'usedIn', 'hash']);
    assert.match(result.stderr, /Next: --offset 2/);
  });
  it('calibrates even when the thresholds file was just emptied by the shell redirect', () => {
    const copy = mkdtempSync(join(tmpdir(), 'translation-qa-script-'));
    folders.push(copy);
    cpSync(HERE, copy, { recursive: true });
    writeFileSync(join(copy, 'length-thresholds.json'), '');
    const result = run(['--source-root', fixture(), '--calibrate'], join(copy, 'check_translations.mjs'));
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.json.pairs['he>fr']);
  });
  it('reports a damaged thresholds file instead of crashing', () => {
    const copy = mkdtempSync(join(tmpdir(), 'translation-qa-script-'));
    folders.push(copy);
    cpSync(HERE, copy, { recursive: true });
    writeFileSync(join(copy, 'length-thresholds.json'), '');
    const result = run(['--source-root', fixture()], join(copy, 'check_translations.mjs'));
    assert.equal(result.status, 3);
    assert.match(result.stderr, /--calibrate/);
  });
  it('writes calibration results in one step, with no temp file left behind', () => {
    const folder = mkdtempSync(join(tmpdir(), 'translation-qa-out-'));
    folders.push(folder);
    const out = join(folder, 'thresholds.json');
    const result = run(['--source-root', fixture(), '--calibrate', '--out', out]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(JSON.parse(readFileSync(out, 'utf8')).pairs['he>fr'].catchRate);
    assert.deepEqual(readdirSync(folder), ['thresholds.json']);
  });
  it('states how strong the length check is for each pair', () => {
    assert.ok(audit().json.lengthCatchRate['he>fr'].halfCut > 0.8);
  });
  it('says what it did not check', () => {
    assert.match(audit().json.scope.notChecked, /Meaning/);
  });
  it('ships thresholds for all six directions, each with its strength on short strings', () => {
    const { pairs } = JSON.parse(readFileSync(join(HERE, 'length-thresholds.json'), 'utf8'));
    assert.deepEqual(Object.keys(pairs).sort(), ['en>fr', 'en>he', 'fr>en', 'fr>he', 'he>en', 'he>fr']);
    for (const pair of Object.values(pairs)) assert.ok(pair.catchRate.under80Characters.halfCut > 0.7);
  });
});

describe('where a key is used', () => {
  function project() {
    const code = mkdtempSync(join(tmpdir(), 'translation-qa-code-'));
    folders.push(code);
    writeFileSync(join(code, 'page.tsx'), `
      import { z } from 'zod';
      export const schema = z.string().min(1, t('note'));
      export function generateMetadata() { return { title: t('greeting') }; }
      const links = [{ label: t('web') }];
      export default function Page() {
        const { t } = getT('app');
        return (
          <main>
            <Button>{t('save')}</Button>
            <input placeholder={t('hours')} />
            <nav>{links.map((link) => <Link key={link.label}>{link.label}</Link>)}</nav>
            <p><Link>{t('link')}</Link></p>
          </main>
        );
      }
    `);
    return code;
  }
  const rows = (root, code) => spawnSync('node', [SCRIPT, '--source-root', root, '--no-lint', '--code-root', code, '--dump', '--limit', '100'], { cwd: PROJECT_ROOT, encoding: 'utf8' })
    .stdout.trim().split('\n').map((line) => JSON.parse(line));

  it('names the element around each key', () => {
    const byKey = Object.fromEntries(rows(fixture(), project()).map((row) => [row.key, row.usedIn[0] ?? '']));
    assert.match(byKey.save, /page\.tsx:\d+ Button$/);
    assert.match(byKey.hours, /input placeholder$/);
    assert.match(byKey.greeting, /title$/);
    assert.match(byKey.note, /zod$/);
    assert.match(byKey.web, /Link$/);
  });
  it('treats a button as tight from the code, whatever its key is called', () => {
    const result = run(['--source-root', fixture((f) => { f.fr.save = 'Enregistrer les modifications de cette page'; }), '--no-lint', '--code-root', project()]);
    assert.ok(found(result, 'ui-length', 'fr'), result.stdout);
  });
  it('does not treat a link in running text as tight', () => {
    const result = run(['--source-root', fixture((f) => { f.fr.link = 'Consultez les <faq>questions fréquentes</faq> sur le site et lisez tout'; }), '--no-lint', '--code-root', project()]);
    const keys = (found(result, 'ui-length')?.findings ?? []).map((finding) => finding.key);
    assert.ok(!keys.includes('link'), result.stdout);
  });
  it('reports a button too wide for a full row', () => {
    const long = 'Enregistrer toutes les modifications de cette page et revenir à la liste complète';
    const result = run(['--source-root', fixture((f) => { f.fr.save = long; }), '--no-lint', '--code-root', project()]);
    assert.ok(found(result, 'ui-overflow', 'fr'), result.stdout);
  });
  it('lists keys it could not find instead of guessing', () => {
    const summary = run(['--source-root', fixture(), '--no-lint', '--code-root', project()]).json.usage.namespaces.app;
    assert.ok(summary.unresolved > 0);
    assert.equal(summary.found + summary.unresolved, summary.keys);
  });
  it('says when the code scan could not run', () => {
    const usage = run(['--source-root', fixture(), '--no-lint', '--code-root', '/nonexistent']).json.usage;
    assert.equal(usage.checked, false);
    assert.match(usage.reason, /not found/);
  });
});

describe('glossary', () => {
  const table = '| עברית | אנגלית | למה |\n| --- | --- | --- |\n| אורח, אורחים | guest, guests | term |\n| בעלי השמחה | לא תורגם כמונח | note |\n';
  const withGlossary = (extra) => {
    const root = fixture((f) => {
      f.he.a = 'לאורחים שלך'; f.en.a = 'For your guests';
      f.he.b = 'רשימת האורחים'; f.en.b = 'The guest list';
      f.he.c = 'אורחים רבים'; f.en.c = 'Many guests';
      f.he.d = 'ולאורחים'; f.en.d = extra;
      for (const key of ['a', 'b', 'c', 'd']) f.fr[key] = 'Invités';
    });
    writeFileSync(join(root, 'en', 'glossary.md'), table);
    return run(['--source-root', root, '--no-usage', '--no-lint']);
  };
  it('reads a Hebrew prefix and reports the outlier', () => {
    const check = found(withGlossary('And to the attendees'), 'glossary-review', 'en');
    assert.equal(check.findings[0].key, 'd');
    assert.equal(check.severity, 'style');
  });
  it('accepts the term in another inflection', () => {
    assert.equal(found(withGlossary('And to each guest'), 'glossary-review'), undefined);
  });
  it('skips a row the translations do not follow', () => {
    const root = fixture((f) => {
      f.he.a = 'אורחים'; f.en.a = 'Attendees'; f.he.b = 'אורחים'; f.en.b = 'People'; f.he.c = 'אורחים'; f.en.c = 'Visitors';
      for (const key of ['a', 'b', 'c']) f.fr[key] = 'Invités';
    });
    writeFileSync(join(root, 'en', 'glossary.md'), table);
    assert.equal(found(run(['--source-root', root, '--no-usage', '--no-lint']), 'glossary-review'), undefined);
  });
  it('accepts a glossary from any path', () => {
    const root = fixture();
    const file = join(root, 'terms.md');
    writeFileSync(file, table);
    assert.equal(run(['--source-root', root, '--no-usage', '--no-lint', '--glossary', `en=${file}`]).json.glossary.en.terms, 1);
  });
});

describe('the record of a reading', () => {
  const record = (root) => {
    const rows = spawnSync('node', [SCRIPT, '--source-root', root, '--no-usage', '--dump', '--limit', '100'], { cwd: PROJECT_ROOT, encoding: 'utf8' })
      .stdout.trim().split('\n').map((line) => JSON.parse(line));
    return rows.flatMap((row) => ['en', 'fr'].filter((lang) => row[lang] !== undefined && row.he !== undefined)
      .map((lang) => JSON.stringify({ ns: row.ns, key: row.key, lang, hash: row.hash[lang], verdict: 'ok' })));
  };
  const review = (root, lines) => {
    const file = join(root, 'review.jsonl');
    writeFileSync(file, lines.join('\n'));
    return run(['--source-root', root, '--no-usage', '--review', file]);
  };
  it('passes when every string was read', () => {
    const root = fixture();
    const result = review(root, record(root));
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.json.complete, true);
  });
  it('lists a string nobody read', () => {
    const root = fixture();
    const result = review(root, record(root).slice(1));
    assert.equal(result.status, 1);
    assert.equal(result.json.missing.count, 1);
  });
  it('asks for a plural form the source language lacks', () => {
    const root = fixture();
    const lines = record(root);
    assert.ok(lines.some((line) => line.includes('items_many')));
    assert.equal(review(root, lines.filter((line) => !line.includes('items_many'))).json.missing.count, 1);
  });
  it('notices a string that changed after it was read', () => {
    const root = fixture();
    const lines = record(root);
    const file = join(root, 'en', 'app.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('Save', 'Keep'));
    assert.equal(review(root, lines).json.stale.count, 1);
  });
  it('rejects an issue with no note', () => {
    const root = fixture();
    const lines = record(root);
    lines[0] = lines[0].replace('"ok"', '"issue"');
    assert.equal(review(root, lines).json.invalid.count, 1);
  });
});

describe('changes since a commit', () => {
  it('reports only keys that changed', () => {
    const root = fixture((f) => { f.en.save = 'שמירה'; f.en.greeting = 'שלום {{name}},'; });
    const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'base');
    const file = join(root, 'en', 'app.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"שמירה"', '"שמירה "'));
    const result = spawnSync('node', [SCRIPT, '--source-root', '.', '--no-usage', '--no-lint', '--changed-since', 'HEAD'], { cwd: root, encoding: 'utf8' });
    const report = JSON.parse(result.stdout);
    const ids = report.checks.flatMap((check) => check.findings.map((finding) => finding.key));
    assert.ok(ids.includes('save'));
    assert.ok(!ids.includes('greeting'), result.stdout);
  });
});

describe('other file formats', () => {
  const write = (name, text) => {
    const folder = mkdtempSync(join(tmpdir(), 'translation-qa-format-'));
    folders.push(folder);
    const file = join(folder, name);
    writeFileSync(file, text);
    return file;
  };
  const check = (args) => run(args);
  const po = (translation) => `msgid ""\nmsgstr "Content-Type: text/plain"\n\n#: a.c:1\nmsgid "Hello %s, you have %d items"\nmsgstr "${translation}"\n`;

  it('reads PO, which carries its source', () => {
    assert.deepEqual(check(['--source', 'en', '--target-file', `fr=${write('fr.po', po('Bonjour %s, vous avez %d éléments'))}`]).json.checks.filter((item) => item.severity === 'critical'), []);
  });
  it('finds a lost format specifier in PO', () => {
    const result = check(['--source', 'en', '--target-file', `fr=${write('fr.po', po('Bonjour %s, vous avez des éléments'))}`]);
    assert.equal(result.status, 1);
    assert.ok(found(result, 'format-specifier-mismatch', 'fr'));
  });
  it('reports a fuzzy PO entry, and does not count it as reaching readers', () => {
    const text = 'msgid ""\nmsgstr ""\n\n#, fuzzy\nmsgid "Save"\nmsgstr "Enregistrer"\n\nmsgid "Open"\nmsgstr "Ouvrir"\n';
    const result = check(['--source', 'en', '--target-file', `fr=${write('fr.po', text)}`]);
    assert.ok(found(result, 'unfinished', 'fr'));
    assert.deepEqual(result.json.coverage.fr['fr.po'], { sourceKeys: 2, translated: 1, percent: 50, unfinished: 1 });
  });
  it('dumps and reviews a single file too', () => {
    const file = write('fr.po', po('Bonjour %s, vous avez %d éléments'));
    const dumped = spawnSync('node', [SCRIPT, '--source', 'en', '--target-file', `fr=${file}`, '--dump'], { cwd: PROJECT_ROOT, encoding: 'utf8' });
    const row = JSON.parse(dumped.stdout.trim().split('\n')[0]);
    assert.equal(row.fr, 'Bonjour %s, vous avez %d éléments');
    const review = write('review.jsonl', JSON.stringify({ ns: row.ns, key: row.key, lang: 'fr', hash: row.hash.fr, verdict: 'ok' }));
    assert.equal(check(['--source', 'en', '--target-file', `fr=${file}`, '--review', review]).json.complete, true);
  });
  it('reads XLIFF 1.2 and finds a lost inline tag', () => {
    const text = '<xliff version="1.2"><file><body><trans-unit id="a"><source>Hi <x id="1"/> there</source><target>Bonjour</target></trans-unit></body></file></xliff>';
    assert.ok(found(check(['--source', 'en', '--target-file', `fr=${write('fr.xlf', text)}`]), 'placeholder-mismatch', 'fr'));
  });
  it('reads XLIFF 2 and its state', () => {
    const text = '<xliff version="2.0"><file><unit id="a"><segment state="initial"><source>Save &amp; close</source><target>Enregistrer et fermer</target></segment></unit></file></xliff>';
    const result = check(['--source', 'en', '--target-file', `fr=${write('fr.xliff', text)}`]);
    assert.ok(found(result, 'unfinished', 'fr'));
    assert.deepEqual(result.json.coverage.fr['fr.xliff'], { sourceKeys: 1, translated: 0, percent: 0, unfinished: 1 });
  });
  it('reads ARB and catches invalid ICU', () => {
    const source = write('en.arb', JSON.stringify({ '@@locale': 'en', hello: 'Hello {name}', '@hello': { description: 'x' } }));
    const result = check(['--source', 'en', '--source-file', source, '--target-file', `fr=${write('fr.arb', JSON.stringify({ hello: 'Bonjour {name' }))}`]);
    assert.equal(result.status, 1);
    assert.ok(found(result, 'icu-syntax', 'fr'));
    assert.equal(result.json.coverage.fr['fr.arb'].sourceKeys, 1);
  });
  it('checks ICU plural cases against the language', () => {
    const source = write('en.json', JSON.stringify({ n: '{count, plural, one {# item} other {# items}}' }));
    const clean = check(['--source', 'en', '--format', 'icu', '--source-file', source, '--target-file', `fr=${write('fr.json', JSON.stringify({ n: '{count, plural, one {# élément} other {# éléments}}' }))}`]);
    assert.equal(clean.status, 0, clean.stdout);
    const hebrew = check(['--source', 'en', '--format', 'icu', '--source-file', source, '--target-file', `he=${write('he.json', JSON.stringify({ n: '{count, plural, one {פריט} other {# פריטים}}' }))}`]);
    assert.equal(found(hebrew, 'missing-plural-form', 'he').findings[0].detail, 'count: two');
  });
  it('reads Rails YAML without its language key', () => {
    const source = write('en.yml', 'en:\n  hello: "Hello %{name}"\n');
    const result = check(['--source', 'en', '--source-file', source, '--target-file', `fr=${write('fr.yml', 'fr:\n  hello: "Bonjour"\n')}`]);
    assert.ok(found(result, 'placeholder-mismatch', 'fr'));
    assert.equal(found(result, 'placeholder-mismatch', 'fr').findings[0].key, 'hello');
  });
  it('reads .strings and finds a changed specifier', () => {
    const source = write('en.strings', '/* c */\n"hello" = "Hello %@";\n');
    const result = check(['--source', 'en', '--source-file', source, '--target-file', `fr=${write('fr.strings', '"hello" = "Bonjour %d";\n')}`]);
    assert.ok(found(result, 'format-specifier-mismatch', 'fr'));
  });
  it('reads .resx and skips binary resources', () => {
    const data = (value) => `<root><data name="hello" xml:space="preserve"><value>${value}</value></data><data name="icon" type="System.Byte[]"><value>AAA</value></data></root>`;
    const result = check(['--source', 'en', '--source-file', write('en.resx', data('Hello {0}')), '--target-file', `fr=${write('fr.resx', data('Bonjour'))}`]);
    assert.ok(found(result, 'format-specifier-mismatch', 'fr'));
    assert.equal(result.json.coverage.fr['fr.resx'].sourceKeys, 1);
  });
  it('does not treat a percent sign in text as a specifier', () => {
    const text = 'msgid ""\nmsgstr ""\n\nmsgid "100% sure"\nmsgstr "Sûr à 100\u00A0%"\n';
    assert.equal(found(check(['--source', 'en', '--target-file', `fr=${write('fr.po', text)}`]), 'format-specifier-mismatch'), undefined);
  });
  it('explains a format it can not tell', () => {
    const result = check(['--target-file', `fr=${write('fr.txt', 'x')}`]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--format/);
  });
  it('asks for a source when the file has none', () => {
    const result = check(['--target-file', `fr=${write('fr.resx', '<root/>')}`]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--source-file/);
  });
});

describe('Next.js code that decides the language', () => {
  function report(files) {
    const root = mkdtempSync(join(tmpdir(), 'translation-qa-next-'));
    folders.push(root);
    const code = join(root, 'src');
    mkdirSync(join(code, 'app'), { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(code, 'app', name), text);
    return run(['--source-root', fixture(), '--no-lint', '--code-root', code, '--next']).json;
  }
  const ids = (json) => json.checks.filter((check) => check.language === 'code').map((check) => check.id);

  it('finds a static title, which can not follow the language', () => {
    assert.deepEqual(ids(report({ 'page.tsx': "export const metadata = { title: 'עמוד הבית' };" })), ['next-static-metadata']);
  });
  it('accepts generateMetadata', () => {
    assert.deepEqual(ids(report({ 'page.tsx': "export async function generateMetadata() { const { t } = await getT('public'); return { title: t('a') }; }" })), []);
  });
  it('accepts a static metadata export with no text', () => {
    assert.deepEqual(ids(report({ 'page.tsx': 'export const metadata = { robots: { index: false } };' })), []);
  });
  it('finds a translation made at module scope', () => {
    assert.deepEqual(ids(report({ 'labels.ts': "const t = getT('public');\nexport const label = t('a');" })), ['next-module-scope-t']);
  });
  it('accepts a translation made inside a function', () => {
    assert.deepEqual(ids(report({ 'labels.ts': "export function label() { const t = getT('public'); return t('a'); }" })), []);
  });
  it('finds a hardcoded language or direction', () => {
    assert.deepEqual(ids(report({ 'layout.tsx': 'export default function L() { return <html lang="he" dir="rtl"><body /></html>; }' })), ['next-hardcoded-language']);
  });
  it('accepts a language from a value, and dir="ltr" around a phone number', () => {
    assert.deepEqual(ids(report({ 'layout.tsx': 'export default function L({ lang }) { return <html lang={lang}><body><span dir="ltr">050</span></body></html>; }' })), []);
  });
  it('finds a language file imported into a client component', () => {
    assert.deepEqual(ids(report({ 'box.tsx': "'use client';\nimport text from '@/locales/he/public.json';\nexport const a = text;" })), ['next-locale-in-client']);
  });
  it('accepts a language file on the server', () => {
    assert.deepEqual(ids(report({ 'box.ts': "import text from '@/locales/he/public.json';\nexport const a = text;" })), []);
  });
});
