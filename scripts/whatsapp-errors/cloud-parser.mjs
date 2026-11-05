import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString } from 'mdast-util-to-string';
import * as heModule from 'he';
const he = heModule.default ?? heModule;

const clean = value => he.decode(value).replace(/<br\s*\/?\s*>/gi, '\n').trim();
const text = node => clean(toString(node));
const links = node => {
  const result = [];
  function walk(n) {
    if (n.type === 'link') result.push({ text: text(n), url: n.url });
    for (const child of n.children ?? []) walk(child);
  }
  walk(node);
  return result;
};

export function extract(markdown) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const headings = [];
  const entries = [];
  let sourceRows = 0;
  for (const node of tree.children) {
    if (node.type === 'heading') {
      headings.length = node.depth - 1;
      headings[node.depth - 1] = text(node);
      continue;
    }
    if (node.type !== 'table') continue;
    const [header, ...rows] = node.children;
    const columns = header.children.map(text);
    if (columns[0] === 'Property') continue;
    if (!['Code', 'Error'].includes(columns[0])) throw new Error(`Unknown table at line ${node.position.start.line}`);
    const marketing = headings.includes('Marketing Messages API for WhatsApp error codes');
    const expected = marketing
      ? ['Code', 'Message', 'Details', 'Possible reasons and solutions', 'HTTP status code']
      : columns[0] === 'Code'
        ? ['Code', 'details', 'Possible reasons and solutions']
        : ['Error', 'Description', 'Possible solution'];
    if (columns.map(c => c.replace(/\s+/g, ' ').toLowerCase()).join('|') !== expected.map(c => c.toLowerCase()).join('|')) {
      throw new Error(`Unexpected columns at line ${node.position.start.line}`);
    }
    for (const row of rows) {
      if (row.children.length !== expected.length) throw new Error(`Unexpected cells at line ${row.position.start.line}`);
      sourceRows++;
      const cells = row.children.map(text);
      const first = cells[0];
      const range = /^(\d+)-(\d+)$/.exec(first);
      const prefix = /^(\d+(?:\s*,\s*\d+)*)(?=$|\s|<)/.exec(first);
      if (!range && !prefix) throw new Error(`Unrecognized code at line ${row.position.start.line}: ${first}`);
      const codes = range ? [null] : prefix[1].split(',').map(v => Number(v.trim()));
      const title = range ? null : first.slice(prefix[1].length).replace(/^\s*-\s*/, '').trim() || null;
      for (const code of codes) entries.push({
        api: marketing ? 'marketing' : 'cloud',
        section: headings.filter(Boolean).slice(1).join(' / '),
        sourceLine: row.position.start.line,
        kind: range ? 'range' : 'exact',
        code,
        min: range ? Number(range[1]) : null,
        max: range ? Number(range[2]) : null,
        title: marketing ? null : title,
        message: marketing ? cells[1] : null,
        description: marketing ? cells[2] : cells[1],
        solution: marketing ? cells[3] : cells[2],
        httpStatus: marketing ? Number(cells[4].match(/^\d{3}/)?.[0]) : null,
        httpStatusText: marketing ? cells[4] : null,
        links: links(row),
      });
    }
  }
  if (!sourceRows) throw new Error('No error rows found');
  const knownCodes = [...new Set(entries.filter(e => e.kind === 'exact').map(e => e.code))].sort((a,b) => a-b);
  return { entries, knownCodes, sourceRows };
}

