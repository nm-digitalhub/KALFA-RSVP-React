// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import {
  BASE_FEE_AGREEMENT_VERSION,
  OPEN_CEILING_AGREEMENT_VERSION,
  defaultBodyAsTemplate,
} from '@/lib/agreements/template';
import { PACKAGE_SEED_BODY } from '@/test/agreement-seed';
import { canEditVisually, contractExtensions, normalizeContractHtml, serializeContractHtml } from './contract-editor-extensions';

// The editor must never change a contract by loading it. Every body the system itself produces — the seeded package
// contract and the three pay-per-result templates — has to come back out of the editor unchanged.

function roundTrip(html: string): string {
  const editor = new Editor({ extensions: contractExtensions(), content: html });
  try {
    return serializeContractHtml(editor);
  } finally {
    editor.destroy();
  }
}

const BODIES: Array<[string, string]> = [
  ['the seeded package contract', PACKAGE_SEED_BODY],
  ['pay-per-result v3', defaultBodyAsTemplate('draft-2026-07-v3')],
  ['base-fee v4', defaultBodyAsTemplate(BASE_FEE_AGREEMENT_VERSION)],
  ['open-ceiling v5', defaultBodyAsTemplate(OPEN_CEILING_AGREEMENT_VERSION)],
];

describe('the visual editor keeps the contract exactly', () => {
  it.each(BODIES)('%s: nothing is lost on the way through the editor', (_name, body) => {
    expect(body.length).toBeGreaterThan(1000);
    expect(normalizeContractHtml(roundTrip(body))).toBe(normalizeContractHtml(body));
    expect(canEditVisually(body)).toBe(true);
  });

  it.each(BODIES)('%s: every {{token}} survives, in order', (_name, body) => {
    const tokens = (html: string) => html.match(/\{\{[\w.]+\}\}/g) ?? [];
    expect(tokens(roundTrip(body))).toEqual(tokens(body));
  });

  it('keeps the terms table, the highlighted box and the sub-title with their classes', () => {
    const html = roundTrip(PACKAGE_SEED_BODY);
    expect(html).toContain('<dl class="terms">');
    expect(html).toContain('<dt>מחיר החבילה</dt>');
    expect(html).toContain('<div class="intent">');
    expect(html).toContain('<div class="sub">');
  });

  it('writes a list item as <li>text</li>, without the editor\'s own paragraph wrapper (it would add a margin)', () => {
    const html = roundTrip('<ul><li>אחד</li><li>שניים</li></ul>');
    expect(html).toBe('<ul><li>אחד</li><li>שניים</li></ul>');
  });

  it('writes a link without the rel/target the editor would add', () => {
    expect(roundTrip('<p><a href="/terms">תנאים</a></p>')).toBe('<p><a href="/terms">תנאים</a></p>');
  });

  it('an empty editor is the empty string — "no custom body" — not <p></p>', () => {
    expect(roundTrip('')).toBe('');
  });

  it('does not write a dir attribute into the contract (the editor is RTL by its container, not by its content)', () => {
    expect(roundTrip(PACKAGE_SEED_BODY)).not.toMatch(/\sdir=/);
  });
});

describe('canEditVisually — the guard against a silent loss', () => {
  it.each([
    ['an unknown element with a class', '<p>a</p><span class="todo">b</span>'],
    ['a <div> that is not one of the two note classes', '<div class="other">x</div>'],
    ['a table', '<table><tr><td>x</td></tr></table>'],
    ['an inline style', '<p style="color:red">x</p>'],
  ])('says no for %s', (_label, html) => {
    expect(canEditVisually(html)).toBe(false);
  });

  it.each([
    ['plain paragraphs and bold', '<h2>1. סעיף</h2><p>טקסט <strong>מודגש</strong></p>'],
    ['a list', '<ul><li>אחד</li><li>שניים</li></ul>'],
    ['a token inside a link', '<p><a href="/terms">תנאים</a> {{eventName}}</p>'],
  ])('says yes for %s', (_label, html) => {
    expect(canEditVisually(html)).toBe(true);
  });

  it('an empty body is editable (the starting point of a new one)', () => {
    expect(canEditVisually('')).toBe(true);
  });
});

describe('normalizeContractHtml', () => {
  it('ignores layout whitespace and attribute quoting, not text', () => {
    expect(normalizeContractHtml('<div>\n  <p>a   b</p>\n</div>')).toBe(normalizeContractHtml('<div><p>a b</p></div>'));
    expect(normalizeContractHtml("<p class='x'>a</p>")).toBe(normalizeContractHtml('<p class="x">a</p>'));
    expect(normalizeContractHtml('<p>a b</p>')).not.toBe(normalizeContractHtml('<p>ab</p>'));
  });
});
