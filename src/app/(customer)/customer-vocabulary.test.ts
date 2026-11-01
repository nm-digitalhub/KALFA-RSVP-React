import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// No "קמפיין" in what a customer reads on a customer route (openspec separate-event-setup-from-management, design D8,
// task 5.3). The service is "אישורי הגעה" / "השירות"; the word stays on staff surfaces only.
//
// Text, not code: the scan reads string literals, template pieces and JSX text through the TypeScript parser, so
// comments (not nodes) and identifiers (not text) never match. A staff-only string on a customer route is allowed by
// an entry below, each with the reason a reviewer can check — and an entry that matches nothing fails, so the list
// cannot outlive the code it excuses.

const WORD = 'קמפיין';
const ROOT = join(process.cwd(), 'src', 'app', '(customer)');

type Found = { file: string; line: number; text: string };

/** Every piece of text in `source` a screen can show: string literals, template pieces and JSX text. */
export function customerTextOf(source: string, file: string): Found[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Found[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const text = node.text.replace(/\s+/g, ' ').trim();
      if (text) found.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// Staff-only text on a customer route. `text` is a fragment of the string as scanned (whitespace collapsed).
const ALLOWED: { file: string; text: string; reason: string }[] = [
  {
    file: 'app/events/[id]/campaign/[campaignId]/manage-client.tsx',
    text: 'חלון החיוב של הקמפיין יזוז איתו',
    reason: 'RescheduleEventForm confirmation: rendered only when canReschedule = viewerIsAdmin && eventIsActive.',
  },
  {
    file: 'app/events/[id]/campaign/[campaignId]/manage-client.tsx',
    text: 'פעולות תפעוליות שמשנות את מחזור החיים של הקמפיין.',
    reason: 'The "פעולות מנהל" block: rendered only when showAdminSection, whose actions all need viewerIsAdmin.',
  },
  {
    file: 'app/events/[id]/campaign/[campaignId]/manage-client.tsx',
    text: 'השהיית קמפיין',
    reason: 'Pause button: rendered only when canPause = viewerIsAdmin && status === active.',
  },
  {
    file: 'app/events/[id]/campaign/[campaignId]/manage-client.tsx',
    text: 'סגירת קמפיין',
    reason: 'Staff close button: rendered only when canClose, which starts with viewerIsAdmin.',
  },
  {
    file: 'app/events/[id]/campaign/[campaignId]/manage-client.tsx',
    text: 'לסגור את הקמפיין? לא יישלחו פניות נוספות.',
    reason: "The staff close button's confirmation (canClose, viewerIsAdmin).",
  },
];

function customerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return customerFiles(path);
    return entry.name.endsWith('.tsx') && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

const relativeFile = (path: string) => relative(ROOT, path).split(sep).join('/');

describe('customerTextOf', () => {
  it('finds the word in a literal, a template piece, a JSX attribute and JSX text', () => {
    const planted = [
      `const a = 'ניהול ${WORD}';`,
      'const b = `${n} אנשי קשר ב' + WORD + '`;',
      `const c = <Card title="מצב ה${WORD}" />;`,
      `const d = <p>ה${WORD} פעיל</p>;`,
    ].join('\n');
    expect(customerTextOf(planted, 'planted.tsx').filter((f) => f.text.includes(WORD))).toHaveLength(4);
  });

  it('ignores comments and identifiers', () => {
    const source = [`// ה${WORD} נסגר`, `/* ${WORD} */`, `const ${'campaign'} = 1;`, `{/* ${WORD} */}`].join('\n');
    expect(customerTextOf(source, 'comments.tsx').filter((f) => f.text.includes(WORD))).toEqual([]);
  });
});

describe(`customer routes show no "${WORD}"`, () => {
  const files = customerFiles(ROOT);
  const hits = files.flatMap((path) =>
    customerTextOf(readFileSync(path, 'utf8'), relativeFile(path)).filter((f) => f.text.includes(WORD)),
  );
  const isAllowed = (hit: Found) => ALLOWED.some((a) => a.file === hit.file && hit.text.includes(a.text));

  it('sweeps the customer routes (an empty sweep proves nothing)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no customer-visible text with the word outside the staff-only allowlist', () => {
    const offending = hits.filter((hit) => !isAllowed(hit)).map((h) => `${h.file}:${h.line} ${h.text}`);
    expect(offending).toEqual([]);
  });

  it('keeps no allowlist entry that matches nothing', () => {
    for (const entry of ALLOWED) {
      expect(
        hits.some((hit) => hit.file === entry.file && hit.text.includes(entry.text)),
        `${entry.file}: "${entry.text}" is allowed but no longer appears`,
      ).toBe(true);
    }
  });
});
