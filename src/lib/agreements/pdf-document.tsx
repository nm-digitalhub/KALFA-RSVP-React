import { join } from 'node:path';
import type { ReactNode } from 'react';

import {
  Document,
  Font,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';

import type {
  AgreementPdfBlock,
  AgreementPdfInline,
} from './pdf-html';
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

function absoluteHref(
  href: string,
  appOrigin: string,
): string {
  if (href.startsWith('#')) return href;
  return new URL(href, appOrigin).toString();
}

function renderInline(
  nodes: AgreementPdfInline[],
  appOrigin: string,
): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`;

    switch (node.type) {
      case 'text':
        return node.value;

      case 'break':
        return '\n';

      case 'strong':
        return (
          <Text key={key} style={styles.strong}>
            {renderInline(node.children, appOrigin)}
          </Text>
        );

      case 'em':
        return (
          <Text key={key} style={styles.em}>
            {renderInline(node.children, appOrigin)}
          </Text>
        );

      case 'strike':
        return (
          <Text key={key} style={styles.strike}>
            {renderInline(node.children, appOrigin)}
          </Text>
        );

      case 'todo':
        return (
          <Text key={key} style={styles.todo}>
            {renderInline(node.children, appOrigin)}
          </Text>
        );

      case 'link':
        return (
          <Link
            key={key}
            src={absoluteHref(node.href, appOrigin)}
            style={styles.link}
          >
            {renderInline(node.children, appOrigin)}
          </Link>
        );
    }
  });
}

function AgreementText({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Text
      style={styles.paragraph}
      orphans={2}
      widows={2}
    >
      {children}
    </Text>
  );
}

function renderBlock(
  block: AgreementPdfBlock,
  appOrigin: string,
  key: string,
): ReactNode {
  switch (block.type) {
    case 'heading': {
      const style =
        block.level === 1
          ? styles.h1
          : block.level === 2
            ? styles.h2
            : styles.h3;

      return (
        <Text
          key={key}
          style={style}
          minPresenceAhead={30}
        >
          {renderInline(block.children, appOrigin)}
        </Text>
      );
    }

    case 'paragraph':
      return (
        <AgreementText key={key}>
          {renderInline(block.children, appOrigin)}
        </AgreementText>
      );

    case 'note':
      if (block.variant === 'sub') {
        return (
          <Text key={key} style={styles.sub}>
            {renderInline(block.children, appOrigin)}
          </Text>
        );
      }

      if (block.variant === 'draft') {
        return (
          <Text key={key} style={styles.draft}>
            {renderInline(block.children, appOrigin)}
          </Text>
        );
      }

      return (
        <View key={key} style={styles.intent}>
          <Text style={styles.intentText}>
            {renderInline(block.children, appOrigin)}
          </Text>
        </View>
      );

    case 'terms':
      return (
        <View key={key} style={styles.terms}>
          {block.rows.map((row, index) => (
            <View
              key={`${key}-row-${index}`}
              style={styles.termRow}
            >
              <Text style={styles.termLabel}>
                {renderInline(row.term, appOrigin)}
              </Text>

              <Text style={styles.termValue}>
                {renderInline(row.definition, appOrigin)}
              </Text>
            </View>
          ))}
        </View>
      );

    case 'list':
      return (
        <View key={key} style={styles.list}>
          {block.items.map((item, index) => (
            <View
              key={`${key}-item-${index}`}
              style={styles.listItem}
            >
              <Text style={styles.listMarker}>
                {block.ordered ? `${index + 1}.` : '•'}
              </Text>

              <View style={styles.listBody}>
                {item.blocks.map((child, childIndex) =>
                  renderBlock(
                    child,
                    appOrigin,
                    `${key}-item-${index}-${childIndex}`,
                  ),
                )}
              </View>
            </View>
          ))}
        </View>
      );

    case 'blockquote':
      return (
        <View key={key} style={styles.blockquote}>
          {block.blocks.map((child, index) =>
            renderBlock(
              child,
              appOrigin,
              `${key}-quote-${index}`,
            ),
          )}
        </View>
      );

    case 'rule':
      return <View key={key} style={styles.rule} />;
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
        {blocks.map((block, index) =>
          renderBlock(
            block,
            appOrigin,
            `agreement-block-${index}`,
          ),
        )}

        <View wrap={false}>
          <Text style={styles.h2}>
            אישור תנאי החבילה
          </Text>

          <Text style={styles.meta}>
            אושר על ידי: {approval.approverName}
            {' · '}
            תאריך: {approval.approvedDateText}
            {approval.ip ? ` · IP: ${approval.ip}` : ''}
            {' · '}
            גרסה: {version}
          </Text>

          <Text style={styles.meta}>
            האישור ניתן באתר, בסימון תיבת האישור לאחר שהלקוח
            קרא את התנאים.
          </Text>
        </View>
      </Page>
    </Document>
  );
}