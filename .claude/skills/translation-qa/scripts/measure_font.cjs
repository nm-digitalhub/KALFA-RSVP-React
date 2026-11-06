#!/usr/bin/env node
// Measures how wide each character is in the project's real font, in a real browser, and prints the table that
// check_translations.mjs uses to estimate a label's width. Run it from the project root after a build, only when the font
// changes: node .claude/skills/translation-qa/scripts/measure_font.cjs Heebo > .claude/skills/translation-qa/scripts/ui-font-widths.json
const { readFileSync, readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = process.cwd();
const { chromium } = require(resolve(root, 'node_modules/playwright'));
const cssFolder = join(root, '.next/static/css');
const css = readdirSync(cssFolder).map((file) => readFileSync(join(cssFolder, file), 'utf8')).find((text) => text.includes('font-face'));
if (!css) {
  process.stderr.write('Error: no @font-face found in .next/static/css. Run the project build first.\n');
  process.exit(3);
}

const family = process.argv[2];
if (!family) {
  process.stderr.write('Error: name the font family, for example: measure_font.cjs Heebo\n');
  process.exit(2);
}
const faces = [...css.matchAll(/@font-face\{[^}]*\}/g)].map(([face]) => face).filter((face) => face.includes(family))
  .map((face) => face.replace(/url\([^)]*\/media\/([^)]+)\)/, (_, file) => {
    const name = file.replace(/["']/g, '').split('?')[0];
    return `url(data:font/woff2;base64,${readFileSync(join(root, '.next/static/media', name)).toString('base64')})`;
  }));

const CHARACTERS = [];
for (let code = 0x20; code <= 0x7e; code += 1) CHARACTERS.push(String.fromCodePoint(code));
for (let code = 0xa0; code <= 0xff; code += 1) CHARACTERS.push(String.fromCodePoint(code));
for (let code = 0x5d0; code <= 0x5ea; code += 1) CHARACTERS.push(String.fromCodePoint(code));
CHARACTERS.push('œ', 'Œ', '’', '“', '”', '…', '–', '—', '€', '₪', ' ');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<style>${faces.join('\n')}</style><span id="x" style="font:500 100px ${family};white-space:pre"></span>`);
  const widths = await page.evaluate(async ([characters, name]) => {
    await document.fonts.load(`500 100px ${name}`, 'aéא');
    await document.fonts.ready;
    const context = document.createElement('canvas').getContext('2d');
    context.font = `500 100px ${name}`;
    return Object.fromEntries(characters.map((character) => [character, Math.round(context.measureText(character).width * 10) / 1000]));
  }, [CHARACTERS, family]);
  await browser.close();
  process.stdout.write(`${JSON.stringify({ font: `${family} 500`, unit: 'em', widths }, null, 0)}\n`);
})();
