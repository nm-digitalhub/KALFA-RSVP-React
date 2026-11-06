// Reads the common translation file formats into one shape, so every format goes through the same checks.
// Each reader returns { entries, sources?, unfinished?, style }: entries maps a key to its text, sources holds the source
// text when the file carries it (PO, XLIFF), unfinished lists keys the file marks as not final, and style names the
// placeholder syntax.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXTENSIONS = {
  '.json': 'json', '.arb': 'arb', '.po': 'po', '.pot': 'po', '.xlf': 'xliff', '.xliff': 'xliff',
  '.yml': 'yaml', '.yaml': 'yaml', '.strings': 'strings', '.resx': 'resx',
};
export const FORMATS = ['json', 'icu', ...new Set(Object.values(EXTENSIONS))].filter((format, index, all) => all.indexOf(format) === index);

// Libraries come from the project, so the skill ships no dependencies of its own.
export async function importFromProject(projectRoot, name) {
  try {
    const resolved = createRequire(join(projectRoot, 'package.json')).resolve(name);
    const module = await import(pathToFileURL(resolved).href);
    // A CommonJS package keeps its exports under `default` when imported.
    return typeof module.default === 'object' ? { ...module.default, ...module } : module;
  } catch {
    return undefined;
  }
}

let icuParser;
let xmlParser;

// Loads what the requested formats need. Only PO and .strings are read by hand: no parser for them is installed.
export async function prepareFormats(projectRoot, formats) {
  if (formats.some((format) => format === 'icu' || format === 'arb')) {
    icuParser = (await importFromProject(projectRoot, '@formatjs/icu-messageformat-parser'))?.parse;
    if (!icuParser) throw new Error('reading ICU messages needs @formatjs/icu-messageformat-parser in this project');
  }
  if (formats.some((format) => format === 'xliff' || format === 'resx')) {
    const XMLParser = (await importFromProject(projectRoot, 'fast-xml-parser'))?.XMLParser;
    if (!XMLParser) throw new Error('reading XML formats needs fast-xml-parser in this project');
    // Source and target stay as raw text, so inline tags such as <x id="1"/> can be compared.
    xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      processEntities: false,
      trimValues: false,
      stopNodes: ['*.source', '*.target', '*.value'],
      isArray: (name) => ['file', 'trans-unit', 'unit', 'segment', 'data'].includes(name),
    });
  }
}

export function detectFormat(path, requested) {
  return requested ?? EXTENSIONS[extname(path).toLowerCase()];
}

export function flatten(value, prefix = '', out = new Map()) {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  } else {
    out.set(prefix, value === null ? '' : String(value));
  }
  return out;
}

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function unquotePo(line) {
  return JSON.parse(`"${line.trim().slice(1, -1).replace(/\\(?!["\\nrt])/g, '\\\\').replace(/\t/g, '\\t')}"`);
}

function readPo(text) {
  const entries = new Map();
  const sources = new Map();
  const unfinished = new Set();
  let entry;
  let field;
  const finish = () => {
    if (!entry || entry.msgid === undefined || entry.msgid === '') return;
    const key = entry.msgctxt ? `${entry.msgctxt}\u0004${entry.msgid}` : entry.msgid;
    const forms = Object.keys(entry).filter((name) => name.startsWith('msgstr'));
    for (const form of forms) {
      const index = form.match(/\[(\d+)\]/)?.[1];
      const id = index === undefined ? key : `${key}[${index}]`;
      entries.set(id, entry[form]);
      sources.set(id, index !== undefined && index !== '0' ? entry.msgid_plural : entry.msgid);
      if (entry.fuzzy) unfinished.add(id);
    }
  };
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      finish();
      entry = undefined;
      continue;
    }
    if (trimmed.startsWith('#,')) {
      entry ??= {};
      if (trimmed.includes('fuzzy')) entry.fuzzy = true;
      continue;
    }
    if (trimmed.startsWith('#')) continue;
    const start = trimmed.match(/^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+(".*")$/);
    entry ??= {};
    if (start) {
      [, field] = start;
      entry[field] = unquotePo(start[2]);
    } else if (trimmed.startsWith('"') && field) {
      entry[field] += unquotePo(trimmed);
    }
  }
  finish();
  return { entries, sources, unfinished, style: 'printf' };
}

const xmlText = (node) => decodeXml(String((typeof node === 'object' && node !== null ? node['#text'] : node) ?? ''));

function collect(node, names, out = []) {
  if (node === null || typeof node !== 'object') return out;
  for (const [name, value] of Object.entries(node)) {
    if (names.includes(name)) out.push(...value);
    else if (Array.isArray(value)) for (const item of value) collect(item, names, out);
    else collect(value, names, out);
  }
  return out;
}

function readXliff(text) {
  const entries = new Map();
  const sources = new Map();
  const unfinished = new Set();
  for (const unit of collect(xmlParser.parse(text), ['trans-unit', 'unit'])) {
    if (!unit.id) continue;
    // XLIFF 2 keeps the text in <segment>, and XLIFF 1.2 directly in the unit.
    const part = unit.segment?.[0] ?? unit;
    sources.set(unit.id, xmlText(part.source));
    entries.set(unit.id, xmlText(part.target));
    const state = part.state ?? part.target?.state ?? '';
    if (/^(needs-|new|initial)/.test(state)) unfinished.add(unit.id);
  }
  return { entries, sources, unfinished, style: 'xliff' };
}

function readStrings(text) {
  const entries = new Map();
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [, key, value] of bare.matchAll(/"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g)) {
    entries.set(key, value.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\'));
  }
  return { entries, style: 'printf' };
}

function readResx(text) {
  const entries = new Map();
  for (const item of collect(xmlParser.parse(text), ['data'])) {
    // Files, images and other binary resources also live in <data>, and are not text to translate.
    if (item.name && !item.type && !item.mimetype) entries.set(item.name, xmlText(item.value));
  }
  return { entries, style: 'dotnet' };
}

function readYaml(text, projectRoot, path) {
  let yaml;
  try {
    yaml = createRequire(join(projectRoot, 'package.json'))('yaml');
  } catch {
    throw new Error(`reading ${path} needs the "yaml" package in this project`);
  }
  const parsed = yaml.parse(text) ?? {};
  // Rails files start with the language: `fr: { hello: ... }`. The language is not part of the key.
  const top = Object.keys(parsed);
  const root = top.length === 1 && /^[a-z]{2}([-_][A-Za-z]{2})?$/.test(top[0]) ? parsed[top[0]] : parsed;
  return { entries: flatten(root), style: 'rails' };
}

function readArb(text) {
  const entries = flatten(Object.fromEntries(Object.entries(JSON.parse(text)).filter(([key]) => !key.startsWith('@'))));
  return { entries, style: 'icu' };
}

export function readTranslations(path, format, projectRoot) {
  const text = readFileSync(path, 'utf8');
  switch (format) {
    case 'json': return { entries: flatten(JSON.parse(text)), style: 'i18next' };
    case 'icu': return { entries: flatten(JSON.parse(text)), style: 'icu' };
    case 'arb': return readArb(text);
    case 'po': return readPo(text);
    case 'xliff': return readXliff(text);
    case 'strings': return readStrings(text);
    case 'resx': return readResx(text);
    case 'yaml': return readYaml(text, projectRoot, path);
    default: throw new Error(`unsupported format "${format}". Supported: ${FORMATS.join(', ')}`);
  }
}

// Node types of @formatjs/icu-messageformat-parser.
const ICU_ARGUMENT_TYPES = new Set([1, 2, 3, 4, 5, 6]);
const ICU_SELECT = 5;
const ICU_PLURAL = 6;
const ICU_TAG = 8;

// The argument names of one ICU message, each plural's cases, and the syntax error if there is one.
export function parseIcu(message) {
  const args = new Set();
  const plurals = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (ICU_ARGUMENT_TYPES.has(node.type)) args.add(node.value);
      if (node.type === ICU_PLURAL) plurals.push({ argument: node.value, categories: Object.keys(node.options), ordinal: node.pluralType === 'ordinal' });
      if (node.type === ICU_PLURAL || node.type === ICU_SELECT) for (const option of Object.values(node.options)) walk(option.value);
      if (node.type === ICU_TAG) walk(node.children);
    }
  };
  try {
    walk(icuParser(message, { ignoreTag: true }));
    return { args: [...args].sort(), plurals };
  } catch (error) {
    return { args: [...args].sort(), plurals, error: error.message };
  }
}

const PATTERNS = {
  printf: /%%|%\(\w+\)[sdf]|%(?:\d+\$)?[-+#0]*\d*(?:\.\d+)?(?:ll|l|h)?[sdifuxXeEgGc@]|\{\w+\}/g,
  rails: /%\{\w+\}/g,
  dotnet: /\{\d+(?:[,:][^}]*)?\}/g,
};

// The placeholders of one text, sorted, so two texts compare whatever the word order. `%%` is an escaped sign, not a value.
export function placeholders(value, style) {
  if (style === 'icu') return parseIcu(value).args;
  if (style === 'xliff') return [...value.matchAll(/<(?:x|ph|g|bpt|ept|pc|sc|ec)\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]).sort();
  return (value.match(PATTERNS[style]) ?? []).filter((match) => match !== '%%').sort();
}
