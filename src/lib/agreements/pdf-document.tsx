import { join } from 'node:path';
import type { ReactNode } from 'react';

import { Document, Font, Link, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

import type { AgreementPdfBlock, AgreementPdfInline, AgreementPdfStyle } from './pdf-html';
import type { AgreementApproval } from './template';

// react-pdf reads the font files itself, from absolute paths (its docs: "an absolute path if you're using react-pdf on
// Node"). They are built from the working directory — the app runs from the repo root, pm2 and the tests alike — and
// NOT with require.resolve / createRequire: webpack recognises both and then tries to bundle the .ttf as a module,
// which fails the production build ("Module parse failed ... DejaVuSans.ttf").
const FONT_DIR = join(process.cwd(), 'node_modules', 'dejavu-fonts-ttf', 'ttf');

Font.register({
  family: 'AgreementSans',
  fonts: [
    {
      src: join(FONT_DIR, 'DejaVuSans.ttf'),
      fontWeight: 400,
      fontStyle: 'normal',
    },
    {
      src: join(FONT_DIR, 'DejaVuSans-Bold.ttf'),
      fontWeight: 700,
      fontStyle: 'normal',
    },
    {
      src: join(FONT_DIR, 'DejaVuSans-Oblique.ttf'),
      fontWeight: 400,
      fontStyle: 'italic',
    },
    {
      src: join(FONT_DIR, 'DejaVuSans-BoldOblique.ttf'),
      fontWeight: 700,
      fontStyle: 'italic',
    },
  ],
});

// Mono has no Hebrew glyphs; code/pre fall back to AgreementSans for those.
Font.register({
  family: 'AgreementMono',
  fonts: [
    { src: join(FONT_DIR, 'DejaVuSansMono.ttf'), fontWeight: 400, fontStyle: 'normal' },
    { src: join(FONT_DIR, 'DejaVuSansMono-Bold.ttf'), fontWeight: 700, fontStyle: 'normal' },
    { src: join(FONT_DIR, 'DejaVuSansMono-Oblique.ttf'), fontWeight: 400, fontStyle: 'italic' },
    { src: join(FONT_DIR, 'DejaVuSansMono-BoldOblique.ttf'), fontWeight: 700, fontStyle: 'italic' },
  ],
});

// Legal prose must never be hyphenated according to an English dictionary.
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    // Old output = Puppeteer 20mm/15mm print margins + body { margin: 40px }.
    paddingTop: 86.7,
    paddingBottom: 86.7,
    paddingLeft: 72.5,
    paddingRight: 72.5,

    fontFamily: 'AgreementSans',
    fontSize: 12,
    lineHeight: 1.7,
    color: '#1a1a1a',
    direction: 'rtl',
  },

  h1: {
    fontFamily: 'AgreementSans',
    fontWeight: 700,
    fontSize: 16.5,
    lineHeight: 1.35,
    direction: 'rtl',
    textAlign: 'right',
    marginBottom: 3,
  },

  h2: {
    fontFamily: 'AgreementSans',
    fontWeight: 700,
    fontSize: 12,
    direction: 'rtl',
    textAlign: 'right',
    marginTop: 15,
    marginBottom: 4.5,
    paddingBottom: 3,
    borderBottomWidth: 0.75,
    borderBottomColor: '#e3e3e8',
  },

  h3: {
    fontFamily: 'AgreementSans',
    fontWeight: 700,
    fontSize: 11,
    direction: 'rtl',
    textAlign: 'right',
    marginTop: 12,
    marginBottom: 4.5,
  },

  h4: { fontWeight: 700, fontSize: 10.5, marginTop: 10, marginBottom: 4 },
  h5: { fontWeight: 700, fontSize: 10, marginTop: 8, marginBottom: 3 },
  h6: { fontWeight: 700, fontSize: 9.5, marginTop: 6, marginBottom: 3 },
  pre: {
    fontFamily: ['AgreementMono', 'AgreementSans'],
    fontSize: 10,
    lineHeight: 1.4,
    marginTop: 6,
    marginBottom: 6,
    padding: 9,
    backgroundColor: '#f7f7f9',
  },

  paragraph: {
    fontFamily: 'AgreementSans',
    fontSize: 12,
    lineHeight: 1.7,
    direction: 'rtl',
    textAlign: 'right',
    marginTop: 4.5,
    marginBottom: 4.5,
  },

  strong: {
    fontWeight: 700,
  },

  em: {
    fontStyle: 'italic',
  },

  strike: {
    textDecoration: 'line-through',
  },

  todo: {
    color: '#b45309',
    fontWeight: 700,
  },

  link: {
    color: '#1a1a1a',
    textDecoration: 'underline',
  },

  sub: {
    fontFamily: 'AgreementSans',
    fontSize: 9.75,
    lineHeight: 1.7,
    color: '#666666',
    direction: 'rtl',
    textAlign: 'right',
    marginBottom: 15,
  },

  intent: {
    backgroundColor: '#fff7ed',
    borderWidth: 0.75,
    borderColor: '#fed7aa',
    borderRadius: 6,
    padding: 9,
    marginTop: 4.5,
    marginBottom: 4.5,
  },

  intentText: {
    fontFamily: 'AgreementSans',
    fontSize: 12,
    lineHeight: 1.7,
    fontWeight: 600,
    direction: 'rtl',
    textAlign: 'right',
  },

  draft: {
    fontFamily: 'AgreementSans',
    fontSize: 8.25,
    lineHeight: 1.7,
    color: '#b45309',
    direction: 'rtl',
    textAlign: 'right',
    marginTop: 16.5,
  },

  terms: {
    backgroundColor: '#f7f7f9',
    borderWidth: 0.75,
    borderColor: '#e3e3e8',
    borderRadius: 6,
    padding: 10.5,
    marginTop: 4.5,
    marginBottom: 4.5,
  },

  termRow: {
    flexDirection: 'row-reverse',
    gap: 10.5,
    marginBottom: 3,
  },

  termLabel: {
    width: 105,
    flexShrink: 0,
    fontFamily: 'AgreementSans',
    fontSize: 12,
    lineHeight: 1.7,
    fontWeight: 700,
    direction: 'rtl',
    textAlign: 'right',
  },

  termValue: {
    flexGrow: 1,
    flexBasis: 0,
    fontFamily: 'AgreementSans',
    fontSize: 12,
    lineHeight: 1.7,
    direction: 'rtl',
    textAlign: 'right',
  },

  list: {
    marginTop: 4.5,
    marginBottom: 4.5,
  },

  listItem: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    marginBottom: 2,
  },

  listMarker: {
    width: 18,
    flexShrink: 0,
    fontFamily: 'AgreementSans',
    fontSize: 12,
    lineHeight: 1.7,
    textAlign: 'center',
  },

  listBody: {
    flexGrow: 1,
    flexBasis: 0,
  },

  blockquote: {
    borderRightWidth: 2,
    borderRightColor: '#d4d4d8',
    paddingRight: 10,
    marginTop: 6,
    marginBottom: 6,
  },

  rule: {
    borderBottomWidth: 0.75,
    borderBottomColor: '#e3e3e8',
    marginTop: 8,
    marginBottom: 8,
  },

  meta: {
    fontFamily: 'AgreementSans',
    fontSize: 9,
    lineHeight: 1.7,
    color: '#555555',
    direction: 'rtl',
    textAlign: 'right',
    marginTop: 6,
  },
});

function absoluteHref(href: string, appOrigin: string): string {
  if (href.startsWith('#')) return href;
  return new URL(href, appOrigin).toString();
}

type TextStyle = AgreementPdfStyle & { fontFamily?: string | string[] };

// React-PDF does not inherit direction/textIndent/decoration details through
// Views. Carry text properties explicitly; never inherit padding or borders.
function inheritedText(style: TextStyle): TextStyle {
  return {
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    textAlign: style.textAlign,
    textDecoration: style.textDecoration,
    textDecorationColor: style.textDecorationColor,
    textDecorationStyle: style.textDecorationStyle,
    textIndent: style.textIndent,
    textTransform: style.textTransform,
    verticalAlign: style.verticalAlign,
    direction: style.direction,
    opacity: style.opacity,
  };
}
function definedText(style: TextStyle): TextStyle {
  return Object.fromEntries(
    Object.entries(inheritedText(style)).filter(([, value]) => value !== undefined),
  );
}
function aligned(style: TextStyle): TextStyle {
  return { ...style, textAlign: style.textAlign ?? (style.direction === 'ltr' ? 'left' : 'right') };
}
// Textkit hangs ASCII spaces outside the line's alignment box. NBSP keeps
// pre indentation inside that box; tabs advance to the next eight-column stop.
// The AST retains the original text. Share the cursor across nested marks.
function preformattedText(value: string, cursor: { column: number }): string {
  let output = '';
  for (const char of value) {
    if (char === '\n') {
      output += char;
      cursor.column = 0;
    } else if (char === '\t') {
      const count = 8 - (cursor.column % 8);
      output += '\u00a0'.repeat(count);
      cursor.column += count;
    } else {
      output += char === ' ' ? '\u00a0' : char;
      cursor.column += 1;
    }
  }
  return output;
}
function renderInline(
  nodes: AgreementPdfInline[],
  appOrigin: string,
  parent: TextStyle,
  pre?: { column: number },
): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    if (node.type === 'text') return pre ? preformattedText(node.value, pre) : node.value;
    if (node.type === 'break') {
      if (pre) pre.column = 0;
      return (
        <Text key={key} style={{ ...parent, ...node.style }}>
          {'\n'}
        </Text>
      );
    }
    let semantic: TextStyle = {};
    switch (node.type) {
      case 'strong':
        semantic = styles.strong;
        break;
      case 'em':
      case 'cite':
        semantic = styles.em;
        break;
      case 'strike':
        semantic = styles.strike;
        break;
      case 'todo':
        semantic = styles.todo;
        break;
      case 'u':
        semantic = { textDecoration: 'underline' };
        break;
      case 'mark':
        semantic = { backgroundColor: '#ffff00' };
        break;
      case 'code':
        semantic = { fontFamily: ['AgreementMono', 'AgreementSans'] };
        break;
      case 'sub':
        semantic = { verticalAlign: 'sub' };
        break;
      case 'sup':
        semantic = { verticalAlign: 'super' };
        break;
      case 'small':
        semantic = { fontSize: (parent.fontSize ?? 12) * 0.8 };
        break;
      case 'link':
        semantic = styles.link;
        break;
    }
    const style = { ...parent, ...semantic, ...node.style };
    const content = renderInline(node.children, appOrigin, definedText(style), pre);
    if (node.type === 'link')
      return (
        <Link key={key} src={absoluteHref(node.href, appOrigin)} style={style}>
          {content}
        </Link>
      );
    // Preserve isolation and override semantics, as well as the dir style.
    const open =
      node.type === 'bdo'
        ? style.direction === 'ltr'
          ? '\u202d'
          : '\u202e'
        : node.type === 'bdi'
          ? node.style?.direction === 'ltr'
            ? '\u2066'
            : node.style?.direction === 'rtl'
              ? '\u2067'
              : '\u2068'
          : '';
    const close = node.type === 'bdo' ? '\u202c' : node.type === 'bdi' ? '\u2069' : '';
    return (
      <Text key={key} style={style}>
        {open}
        {content}
        {close}
      </Text>
    );
  });
}
function renderBlock(
  block: AgreementPdfBlock,
  appOrigin: string,
  key: string,
  inherited: TextStyle = { direction: 'rtl' },
): ReactNode {
  const own = block.style ?? {};
  const text = definedText({ ...inherited, ...own });
  const children = (blocks: AgreementPdfBlock[], parent = text, prefix = key) =>
    blocks.map((child, index) => renderBlock(child, appOrigin, `${prefix}-${index}`, parent));
  switch (block.type) {
    case 'heading': {
      const style = aligned({
        ...inherited,
        ...styles[`h${block.level}`],
        direction: inherited.direction,
        ...own,
        textAlign: own.textAlign ?? inherited.textAlign,
      });
      return (
        <Text key={key} style={style} minPresenceAhead={30}>
          {renderInline(block.children, appOrigin, definedText(style))}
        </Text>
      );
    }
    case 'paragraph': {
      const style = aligned({
        ...styles.paragraph,
        // Bare text in div/terms cells has no browser paragraph margins.
        ...(block.implicit ? { marginTop: 0, marginBottom: 0 } : {}),
        ...inherited,
        ...own,
        textAlign: own.textAlign ?? inherited.textAlign,
      });
      return (
        <Text key={key} style={style} orphans={2} widows={2}>
          {renderInline(block.children, appOrigin, definedText(style))}
        </Text>
      );
    }
    case 'pre': {
      const style = aligned({
        ...inherited,
        ...styles.pre,
        ...own,
        textAlign: own.textAlign ?? inherited.textAlign,
      });
      // Paint the block background on a View so nested code runs cannot inherit
      // it and paint outside the padded box.
      return (
        <View key={key} style={style}>
          <Text style={definedText(style)}>
            {renderInline(block.children, appOrigin, definedText(style), { column: 0 })}
          </Text>
        </View>
      );
    }
    case 'note': {
      const semantic =
        block.variant === 'intent'
          ? { ...styles.intent, ...definedText(styles.intentText) }
          : styles[block.variant];
      const style = { ...inherited, ...semantic, direction: inherited.direction, ...own };
      return (
        <View key={key} style={style}>
          {children(block.blocks, definedText(style))}
        </View>
      );
    }
    case 'terms':
      return (
        <View key={key} style={{ ...styles.terms, ...own }}>
          {block.rows.map((row, index) => (
            <View
              key={`${key}-row-${index}`}
              style={{
                ...styles.termRow,
                flexDirection: text.direction === 'ltr' ? 'row' : 'row-reverse',
              }}
            >
              <View style={{ width: 105, flexShrink: 0, ...row.termStyle }}>
                {children(
                  row.term,
                  {
                    ...definedText(styles.termLabel),
                    ...text,
                    ...definedText(row.termStyle ?? {}),
                  },
                  `${key}-term-${index}`,
                )}
              </View>
              <View style={{ flexGrow: 1, flexBasis: 0, ...row.definitionStyle }}>
                {children(
                  row.definition,
                  {
                    ...definedText(styles.termValue),
                    ...text,
                    ...definedText(row.definitionStyle ?? {}),
                  },
                  `${key}-definition-${index}`,
                )}
              </View>
            </View>
          ))}
        </View>
      );
    case 'list':
      return (
        <View key={key} style={{ ...styles.list, ...own }}>
          {block.items.map((item, index) => {
            const itemText = { ...text, ...definedText(item.style ?? {}) };
            return (
              <View
                key={`${key}-item-${index}`}
                style={{
                  ...styles.listItem,
                  flexDirection: itemText.direction === 'ltr' ? 'row' : 'row-reverse',
                  ...item.style,
                }}
              >
                <Text style={{ ...styles.listMarker, ...itemText }}>
                  {block.ordered ? `${index + 1}.` : '•'}
                </Text>
                <View style={styles.listBody}>
                  {children(item.blocks, itemText, `${key}-item-${index}`)}
                </View>
              </View>
            );
          })}
        </View>
      );
    case 'blockquote':
      return (
        <View key={key} style={{ ...styles.blockquote, ...own }}>
          {children(block.blocks)}
        </View>
      );
    case 'container': {
      const semantic: TextStyle =
        block.tag === 'address'
          ? { fontStyle: 'italic' }
          : block.tag === 'dt'
            ? { fontWeight: 700 }
            : {};
      return (
        <View key={key} style={{ ...(block.tag === 'dd' ? { marginRight: 30 } : {}), ...own }}>
          {children(block.blocks, { ...inherited, ...semantic, ...definedText(own) })}
        </View>
      );
    }
    case 'rule':
      return <View key={key} style={{ ...styles.rule, ...own }} />;
  }
}

export type AgreementPdfDocumentProps = {
  blocks: AgreementPdfBlock[];
  approval: AgreementApproval;
  version: string;
  appOrigin: string;
};

export function AgreementPdfDocument({
  blocks,
  approval,
  version,
  appOrigin,
}: AgreementPdfDocumentProps) {
  return (
    <Document
      title="אישור תנאי חבילה"
      author="KALFA"
      subject={`אישור תנאי חבילה — ${version}`}
      language="he"
    >
      <Page size="A4" wrap style={styles.page}>
        {blocks.map((block, index) => renderBlock(block, appOrigin, `agreement-block-${index}`))}

        <View wrap={false}>
          <Text style={styles.h2}>אישור תנאי החבילה</Text>

          <Text style={styles.meta}>
            אושר על ידי: {approval.approverName}
            {' · '}
            תאריך: {approval.approvedDateText}
            {approval.ip ? ` · IP: ${approval.ip}` : ''}
            {' · '}
            גרסה: {version}
          </Text>

          <Text style={styles.meta}>
            האישור ניתן באתר, בסימון תיבת האישור לאחר שהלקוח קרא את התנאים.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
