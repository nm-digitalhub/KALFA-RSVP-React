import {
  parseFragment,
  type DefaultTreeAdapterTypes,
} from 'parse5';

type HtmlNode = DefaultTreeAdapterTypes.ChildNode;
type HtmlElement = DefaultTreeAdapterTypes.Element;

export type AgreementPdfInline =
  | {
      type: 'text';
      value: string;
    }
  | {
      type: 'strong';
      children: AgreementPdfInline[];
    }
  | {
      type: 'em';
      children: AgreementPdfInline[];
    }
  | {
      type: 'strike';
      children: AgreementPdfInline[];
    }
  | {
      type: 'todo';
      children: AgreementPdfInline[];
    }
  | {
      type: 'link';
      href: string;
      children: AgreementPdfInline[];
    }
  | {
      type: 'break';
    };

export type AgreementPdfTermRow = {
  term: AgreementPdfInline[];
  definition: AgreementPdfInline[];
};

export type AgreementPdfListItem = {
  blocks: AgreementPdfBlock[];
};

export type AgreementPdfBlock =
  | {
      type: 'heading';
      level: 1 | 2 | 3;
      children: AgreementPdfInline[];
    }
  | {
      type: 'paragraph';
      children: AgreementPdfInline[];
    }
  | {
      type: 'note';
      variant: 'sub' | 'intent' | 'draft';
      children: AgreementPdfInline[];
    }
  | {
      type: 'terms';
      rows: AgreementPdfTermRow[];
    }
  | {
      type: 'list';
      ordered: boolean;
      items: AgreementPdfListItem[];
    }
  | {
      type: 'blockquote';
      blocks: AgreementPdfBlock[];
    }
  | {
      type: 'rule';
    };

export class AgreementPdfHtmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgreementPdfHtmlError';
  }
}

const BLOCK_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'p',
  'div',
  'dl',
  'ul',
  'ol',
  'blockquote',
  'hr',
]);

function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node;
}

function isTextNode(
  node: HtmlNode,
): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === '#text';
}

function elementLabel(element: HtmlElement): string {
  const cls = getAttribute(element, 'class');
  return cls ? `<${element.tagName} class="${cls}">` : `<${element.tagName}>`;
}

function getAttribute(
  element: HtmlElement,
  name: string,
): string | null {
  return element.attrs.find((attr) => attr.name === name)?.value ?? null;
}

function assertAttributes(
  element: HtmlElement,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  const unsupported = element.attrs
    .map((attr) => attr.name)
    .filter((name) => !allowedSet.has(name));

  if (unsupported.length > 0) {
    throw new AgreementPdfHtmlError(
      `${elementLabel(element)} כולל מאפיינים שאינם נתמכים ב-PDF: ${unsupported.join(', ')}`,
    );
  }
}

function collapseText(value: string): string {
  return value.replace(/\s+/g, ' ');
}

function trimInlineEdges(
  input: AgreementPdfInline[],
): AgreementPdfInline[] {
  const result = [...input];

  if (result[0]?.type === 'text') {
    result[0] = {
      ...result[0],
      value: result[0].value.replace(/^\s+/, ''),
    };
  }

  const lastIndex = result.length - 1;
  if (result[lastIndex]?.type === 'text') {
    const last = result[lastIndex];
    result[lastIndex] = {
      ...last,
      value: last.value.replace(/\s+$/, ''),
    };
  }

  return result.filter(
    (node) => node.type !== 'text' || node.value !== '',
  );
}

function inlineHasVisibleContent(
  nodes: AgreementPdfInline[],
): boolean {
  return nodes.some((node) => {
    if (node.type === 'break') return true;
    if (node.type === 'text') return node.value.trim() !== '';
    return inlineHasVisibleContent(node.children);
  });
}

function assertHref(href: string): void {
  if (href === '') {
    throw new AgreementPdfHtmlError(
      '<a> בחוזה חייב לכלול href שאינו ריק',
    );
  }

  if (
    href.startsWith('/') ||
    href.startsWith('#') ||
    href.startsWith('./') ||
    href.startsWith('../')
  ) {
    return;
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new AgreementPdfHtmlError(
      `<a> כולל כתובת שאינה תקינה: ${href}`,
    );
  }

  if (
    url.protocol !== 'http:' &&
    url.protocol !== 'https:' &&
    url.protocol !== 'mailto:' &&
    url.protocol !== 'tel:'
  ) {
    throw new AgreementPdfHtmlError(
      `<a> משתמש בפרוטוקול שאינו נתמך ב-PDF: ${url.protocol}`,
    );
  }
}

function parseInlineNode(
  node: HtmlNode,
): AgreementPdfInline[] {
  if (isTextNode(node)) {
    const value = collapseText(node.value);
    return value === '' ? [] : [{ type: 'text', value }];
  }

  if (!isElement(node)) {
    throw new AgreementPdfHtmlError(
      `נמצא node HTML שאינו נתמך ב-PDF: ${node.nodeName}`,
    );
  }

  const tag = node.tagName;

  switch (tag) {
    case 'strong':
    case 'b':
      assertAttributes(node, []);
      return [
        {
          type: 'strong',
          children: parseInlineChildren(node),
        },
      ];

    case 'em':
    case 'i':
      assertAttributes(node, []);
      return [
        {
          type: 'em',
          children: parseInlineChildren(node),
        },
      ];

    case 's':
    case 'del':
    case 'strike':
      assertAttributes(node, []);
      return [
        {
          type: 'strike',
          children: parseInlineChildren(node),
        },
      ];

    case 'br':
      assertAttributes(node, []);
      return [{ type: 'break' }];

    case 'span': {
      assertAttributes(node, ['class']);
      const cls = getAttribute(node, 'class');

      if (cls !== 'todo') {
        throw new AgreementPdfHtmlError(
          `${elementLabel(node)} אינו span נתמך ב-PDF`,
        );
      }

      return [
        {
          type: 'todo',
          children: parseInlineChildren(node),
        },
      ];
    }

    case 'a': {
      assertAttributes(node, ['href', 'target', 'rel']);

      const href = getAttribute(node, 'href') ?? '';
      assertHref(href);

      return [
        {
          type: 'link',
          href,
          children: parseInlineChildren(node),
        },
      ];
    }

    default:
      throw new AgreementPdfHtmlError(
        `האלמנט <${tag}> אינו נתמך בתוך טקסט PDF`,
      );
  }
}

function parseInlineNodes(
  nodes: HtmlNode[],
  trimEdges = true,
): AgreementPdfInline[] {
  const result = nodes.flatMap(parseInlineNode);
  return trimEdges ? trimInlineEdges(result) : result;
}

function parseInlineChildren(
  element: HtmlElement,
): AgreementPdfInline[] {
  return parseInlineNodes(element.childNodes);
}

function parseMixedBlocks(
  nodes: HtmlNode[],
): AgreementPdfBlock[] {
  const blocks: AgreementPdfBlock[] = [];
  let pendingInline: AgreementPdfInline[] = [];

  const flushInline = () => {
    const content = trimInlineEdges(pendingInline);

    if (inlineHasVisibleContent(content)) {
      blocks.push({
        type: 'paragraph',
        children: content,
      });
    }

    pendingInline = [];
  };

  for (const node of nodes) {
    if (isElement(node) && BLOCK_TAGS.has(node.tagName)) {
      flushInline();
      blocks.push(parseBlock(node));
      continue;
    }

    pendingInline.push(...parseInlineNode(node));
  }

  flushInline();

  return blocks;
}

function parseTerms(element: HtmlElement): AgreementPdfBlock {
  assertAttributes(element, ['class']);

  if (getAttribute(element, 'class') !== 'terms') {
    throw new AgreementPdfHtmlError(
      '<dl> בחוזה חייב להיות class="terms"',
    );
  }

  const children = element.childNodes.filter((node) => {
    return !isTextNode(node) || node.value.trim() !== '';
  });

  const rows: AgreementPdfTermRow[] = [];

  for (let index = 0; index < children.length; index += 2) {
    const term = children[index];
    const definition = children[index + 1];

    if (
      !term ||
      !definition ||
      !isElement(term) ||
      !isElement(definition) ||
      term.tagName !== 'dt' ||
      definition.tagName !== 'dd'
    ) {
      throw new AgreementPdfHtmlError(
        '<dl class="terms"> חייב להכיל זוגות dt/dd לפי הסדר',
      );
    }

    assertAttributes(term, []);
    assertAttributes(definition, []);

    rows.push({
      term: parseInlineChildren(term),
      definition: parseInlineChildren(definition),
    });
  }

  return {
    type: 'terms',
    rows,
  };
}

function parseList(
  element: HtmlElement,
  ordered: boolean,
): AgreementPdfBlock {
  assertAttributes(element, []);

  const items: AgreementPdfListItem[] = [];

  for (const child of element.childNodes) {
    if (isTextNode(child) && child.value.trim() === '') {
      continue;
    }

    if (!isElement(child) || child.tagName !== 'li') {
      throw new AgreementPdfHtmlError(
        `<${element.tagName}> יכול להכיל רק <li> ברמת הבן הישירה`,
      );
    }

    assertAttributes(child, []);

    const blocks = parseMixedBlocks(child.childNodes);

    items.push({
      blocks:
        blocks.length > 0
          ? blocks
          : [{ type: 'paragraph', children: [] }],
    });
  }

  return {
    type: 'list',
    ordered,
    items,
  };
}

function parseBlock(element: HtmlElement): AgreementPdfBlock {
  switch (element.tagName) {
    case 'h1':
    case 'h2':
    case 'h3':
      assertAttributes(element, []);
      return {
        type: 'heading',
        level: Number(element.tagName.slice(1)) as 1 | 2 | 3,
        children: parseInlineChildren(element),
      };

    case 'p':
      assertAttributes(element, []);
      return {
        type: 'paragraph',
        children: parseInlineChildren(element),
      };

    case 'div': {
      assertAttributes(element, ['class']);

      const cls = getAttribute(element, 'class');

      if (
        cls !== 'sub' &&
        cls !== 'intent' &&
        cls !== 'draft'
      ) {
        throw new AgreementPdfHtmlError(
          `${elementLabel(element)} אינו div נתמך בחוזה PDF`,
        );
      }

      return {
        type: 'note',
        variant: cls,
        children: parseInlineChildren(element),
      };
    }

    case 'dl':
      return parseTerms(element);

    case 'ul':
      return parseList(element, false);

    case 'ol':
      return parseList(element, true);

    case 'blockquote':
      assertAttributes(element, []);
      return {
        type: 'blockquote',
        blocks: parseMixedBlocks(element.childNodes),
      };

    case 'hr':
      assertAttributes(element, []);
      return {
        type: 'rule',
      };

    default:
      throw new AgreementPdfHtmlError(
        `האלמנט <${element.tagName}> אינו נתמך בחוזה PDF`,
      );
  }
}

export function parseAgreementPdfHtml(
  html: string,
): AgreementPdfBlock[] {
  const fragment = parseFragment(html);
  return parseMixedBlocks(fragment.childNodes);
}

export function findAgreementPdfCompatibilityIssues(
  html: string,
): string[] {
  try {
    parseAgreementPdfHtml(html);
    return [];
  } catch (error) {
    return [
      error instanceof Error
        ? error.message
        : 'נוסח החוזה אינו ניתן להמרה ל-PDF',
    ];
  }
}