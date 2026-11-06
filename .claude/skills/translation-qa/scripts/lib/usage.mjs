// Finds where each translation key is used in the code, and which element shows it. It reads the code with the
// project's own TypeScript parser, so a key's context comes from the JSX around it and not from what the key is called.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, relative } from 'node:path';

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const SKIPPED_FOLDERS = new Set(['node_modules', 'locales', 'generated', '__tests__', '.next']);
// Calls that translate. i18next-cli treats the same names as translation functions.
const TRANSLATE_FUNCTIONS = new Set(['t', 'tt']);
// Elements that do not grow with their text: a button or a tab has to hold the label on one short line.
const TIGHT_ELEMENTS = new Set([
  'button', 'Button', 'th', 'TableHead', 'Tab', 'TabsTrigger', 'MenuItem', 'DropdownMenuItem', 'NavigationMenuLink',
  'SelectItem', 'option', 'summary', 'Badge', 'ToggleGroupItem', 'Toggle',
]);
// A link is tight inside navigation, and in running text it simply wraps.
const NAVIGATION_ELEMENTS = new Set(['nav', 'header', 'footer', 'NavigationMenu']);
const LINK_ELEMENTS = new Set(['a', 'Link']);
const CLIPPING_CLASS = /\b(truncate|line-clamp-\d+|text-ellipsis)\b/;

export function loadTypeScript(projectRoot) {
  try {
    return createRequire(join(projectRoot, 'package.json'))('typescript');
  } catch {
    return undefined;
  }
}

export function listCodeFiles(folder, out = []) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.has(entry.name)) listCodeFiles(join(folder, entry.name), out);
    } else if (CODE_EXTENSIONS.has(extname(entry.name)) && !/\.(test|spec)\./.test(entry.name)) {
      out.push(join(folder, entry.name));
    }
  }
  return out;
}

function tagName(ts, node) {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  return opening.tagName.getText();
}

function attributeText(ts, node, name) {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const attribute = opening.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText() === name);
  return attribute?.initializer?.getText() ?? '';
}

function isElement(ts, node) {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
}

// What shows the text: a JSX child, an attribute, page metadata, a validation rule, or a plain value in the code.
function describe(ts, call) {
  let attribute;
  let property;
  const ancestors = [];
  for (let node = call.parent; node; node = node.parent) {
    if (!attribute && ts.isJsxAttribute(node)) attribute = node.name.getText();
    if (!property && ts.isPropertyAssignment(node)) property = node.name.getText();
    ancestors.push(node);
  }
  const elements = ancestors.filter((node) => isElement(ts, node));
  const metadata = ancestors.some((node) => (
    (ts.isFunctionDeclaration(node) && node.name?.text === 'generateMetadata')
    || (ts.isVariableDeclaration(node) && node.name.getText() === 'metadata')
  ));
  if (metadata) return { kind: 'metadata', element: property ?? 'metadata', tight: false };
  const validation = ancestors.some((node) => ts.isCallExpression(node) && /^z\.|\bz\.\w+\(/.test(node.expression.getText()));
  if (validation) return { kind: 'validation', element: property ?? 'zod', tight: false };
  const element = elements[0];
  if (!element) {
    const variable = ancestors.find((node) => ts.isVariableDeclaration(node))?.name.getText();
    return { kind: 'value', element: property ?? variable ?? 'value', tight: false };
  }
  const name = tagName(ts, element);
  if (attribute) return { kind: 'attribute', element: `${name} ${attribute}`, tight: false };
  const insideNavigation = elements.some((node) => NAVIGATION_ELEMENTS.has(tagName(ts, node)));
  // CSS that hides what doesn't fit, on the element or the two around it. The reader gets a cut sentence and no warning.
  const clipped = elements.slice(0, 3).map((node) => attributeText(ts, node, 'className').match(CLIPPING_CLASS)?.[0]).find(Boolean);
  const buttonLink = /buttonVariants/.test(attributeText(ts, element, 'className'));
  const tight = TIGHT_ELEMENTS.has(name) || (LINK_ELEMENTS.has(name) && (insideNavigation || buttonLink));
  return { kind: 'element', element: name, tight, clipped };
}

function namespaceAt(records, position) {
  let found;
  for (const record of records) if (record.position <= position) found = record.namespace;
  return found;
}

export function scanUsage(projectRoot, codeRoot) {
  const ts = loadTypeScript(projectRoot);
  if (!ts) return { available: false, reason: 'typescript is not installed in this project' };
  if (!existsSync(codeRoot)) return { available: false, reason: `code folder not found: ${codeRoot}` };

  const usages = [];
  const dynamicPrefixes = [];
  for (const file of listCodeFiles(codeRoot)) {
    const text = readFileSync(file, 'utf8');
    if (!/\bt\(|i18nKey|\.t\(/.test(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const namespaces = [];
    const fileUsages = [];
    // `{item.label}` or `{label}` inside an element: where a value defined earlier in the file ends up.
    const renderedAs = new Map();
    const add = (key, node, details) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      const namespace = key.includes(':') ? key.split(':')[0] : namespaceAt(namespaces, node.getStart());
      fileUsages.push({ key: key.includes(':') ? key.split(':').slice(1).join(':') : key, namespace, file: relative(projectRoot, file), line: line + 1, ...details });
    };
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
        const argument = node.arguments[0];
        if (/^(getT|useT|useTranslation|getFixedT)$/.test(name) && argument && ts.isStringLiteralLike(argument)) {
          namespaces.push({ position: node.getStart(), namespace: argument.text });
        }
        if (TRANSLATE_FUNCTIONS.has(name) && argument) {
          if (ts.isStringLiteralLike(argument)) add(argument.text, node, describe(ts, node));
          else if (ts.isTemplateExpression(argument)) dynamicPrefixes.push(argument.head.text);
        }
      }
      if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
        const value = node.expression;
        const name = ts.isIdentifier(value) ? value.text : ts.isPropertyAccessExpression(value) ? value.name.text : undefined;
        if (name) {
          const shown = describe(ts, value);
          if (shown.kind === 'element') {
            const known = renderedAs.get(name);
            renderedAs.set(name, { element: shown.element, tight: shown.tight || Boolean(known?.tight), clipped: shown.clipped ?? known?.clipped });
          }
        }
      }
      if (ts.isJsxAttribute(node) && node.name.getText() === 'i18nKey' && node.initializer && ts.isStringLiteralLike(node.initializer)) {
        add(node.initializer.text, node, describe(ts, node.parent.parent));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const usage of fileUsages) {
      const shown = usage.kind === 'value' ? renderedAs.get(usage.element) : undefined;
      usages.push(shown ? { ...usage, kind: 'element', element: shown.element, tight: shown.tight, clipped: shown.clipped, via: usage.element } : usage);
    }
  }
  return { available: true, usages, dynamicPrefixes: dynamicPrefixes.filter(Boolean) };
}

// Plural keys appear in code without their suffix, so `summary_one` is looked up as `summary`.
export function usageIndex(scan) {
  const index = new Map();
  for (const usage of scan.usages ?? []) {
    if (!index.has(usage.key)) index.set(usage.key, []);
    index.get(usage.key).push(usage);
  }
  return {
    find(key, namespace) {
      const base = key.replace(/(_ordinal)?_(zero|one|two|few|many|other)$/, '');
      const found = index.get(key) ?? index.get(base) ?? [];
      const inNamespace = found.filter((usage) => !usage.namespace || usage.namespace === namespace);
      return inNamespace.length > 0 ? inNamespace : found;
    },
    isDynamic(key) {
      return (scan.dynamicPrefixes ?? []).some((prefix) => key.startsWith(prefix));
    },
  };
}
