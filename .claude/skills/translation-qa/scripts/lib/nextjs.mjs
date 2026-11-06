// Code checks for Next.js, from node_modules/next/dist/docs/01-app/02-guides/internationalization.md and the metadata
// guide. A correct translation still reaches the reader in the wrong language if the code fixes the language in advance.
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { listCodeFiles, loadTypeScript } from './usage.mjs';

const TRANSLATE_CALLS = new Set(['t', 'getT', 'getFixedT']);
// Text fields of a page's metadata. Settings such as `robots` hold no words to translate.
const METADATA_TEXT_FIELDS = new Set(['title', 'description', 'default', 'template', 'absolute']);
// `dir="ltr"` is correct around a phone number or a code, so only a fixed page direction counts.
const FIXED_LANGUAGE = { lang: /./, dir: /^rtl$/ };

function insideFunction(ts, node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionLike(parent)) return true;
  }
  return false;
}

function hasTextField(ts, node) {
  let found = false;
  const visit = (child) => {
    if (ts.isPropertyAssignment(child) && METADATA_TEXT_FIELDS.has(child.name.getText()) && ts.isStringLiteralLike(child.initializer) && /\p{L}/u.test(child.initializer.text)) found = true;
    if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

export function scanNextCode(projectRoot, codeRoot) {
  const ts = loadTypeScript(projectRoot);
  if (!ts || !existsSync(codeRoot)) return [];
  const findings = [];
  for (const file of listCodeFiles(codeRoot)) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const client = /^\s*['"]use client['"]/.test(text);
    const add = (id, node, detail) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      findings.push({ id, key: `${relative(projectRoot, file)}:${line + 1}`, detail });
    };
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText() === 'metadata' && node.initializer && hasTextField(ts, node.initializer)
        && ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) add('next-static-metadata', node);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TRANSLATE_CALLS.has(node.expression.text) && !insideFunction(ts, node)) {
        add('next-module-scope-t', node, node.expression.text);
      }
      if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
        const rule = FIXED_LANGUAGE[node.name.getText()];
        if (rule?.test(node.initializer.text)) add('next-hardcoded-language', node, `${node.name.getText()}="${node.initializer.text}"`);
      }
      if (client && ts.isImportDeclaration(node) && /locales\/.*\.json$/.test(node.moduleSpecifier.text)) add('next-locale-in-client', node, node.moduleSpecifier.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}
