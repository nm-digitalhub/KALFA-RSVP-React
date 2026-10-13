import { parse, parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

type HtmlNode = DefaultTreeAdapterTypes.ChildNode;
type HtmlElement = DefaultTreeAdapterTypes.Element;
type BorderStyle = 'solid' | 'dashed' | 'dotted';

// Validated renderer-ready values only. Lengths are points; a unitless
// line-height is a multiplier, an absolute line-height is explicitly pt.
export type AgreementPdfStyle = {
  color?: string;
  backgroundColor?: string;
  opacity?: number;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  letterSpacing?: number;
  lineHeight?: number | `${number}pt`;
  textAlign?: 'left' | 'right' | 'center' | 'justify';
  textDecoration?: 'none' | 'underline' | 'line-through' | 'underline line-through';
  textDecorationColor?: string;
  textDecorationStyle?: BorderStyle;
  textIndent?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  verticalAlign?: 'sub' | 'super';
  direction?: 'rtl' | 'ltr';
} & Partial<Record<`${'margin' | 'padding'}${'Top' | 'Right' | 'Bottom' | 'Left'}`, number>> &
  Partial<Record<`border${'Top' | 'Right' | 'Bottom' | 'Left'}Width`, number>> &
  Partial<Record<`border${'Top' | 'Right' | 'Bottom' | 'Left'}Color`, string>> &
  Partial<Record<`border${'Top' | 'Right' | 'Bottom' | 'Left'}Style`, BorderStyle>> &
  Partial<Record<`border${'TopLeft' | 'TopRight' | 'BottomRight' | 'BottomLeft'}Radius`, number>>;
type Styled = { style?: AgreementPdfStyle };
export type AgreementPdfInline = Styled &
  (
    | { type: 'text'; value: string }
    | {
        type:
          | 'strong'
          | 'em'
          | 'strike'
          | 'todo'
          | 'u'
          | 'mark'
          | 'code'
          | 'sub'
          | 'sup'
          | 'small'
          | 'span'
          | 'abbr'
          | 'cite'
          | 'time'
          | 'bdi'
          | 'bdo';
        children: AgreementPdfInline[];
      }
    | { type: 'link'; href: string; children: AgreementPdfInline[] }
    | { type: 'break' }
  );
export type AgreementPdfTermRow = {
  term: AgreementPdfBlock[];
  definition: AgreementPdfBlock[];
  termStyle?: AgreementPdfStyle;
  definitionStyle?: AgreementPdfStyle;
};
export type AgreementPdfListItem = Styled & { blocks: AgreementPdfBlock[] };
export type AgreementPdfBlock = Styled &
  (
    | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: AgreementPdfInline[] }
    | { type: 'paragraph' | 'pre'; children: AgreementPdfInline[]; implicit?: boolean }
    | { type: 'note'; variant: 'sub' | 'intent' | 'draft'; blocks: AgreementPdfBlock[] }
    | { type: 'terms'; rows: AgreementPdfTermRow[] }
    | { type: 'list'; ordered: boolean; items: AgreementPdfListItem[] }
    | { type: 'blockquote'; blocks: AgreementPdfBlock[] }
    | { type: 'container'; tag: string; blocks: AgreementPdfBlock[] }
    | { type: 'rule' }
  );

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
  'h4',
  'h5',
  'h6',
  'p',
  'div',
  'section',
  'article',
  'aside',
  'address',
  'blockquote',
  'hr',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'pre',
]);
const INLINE_TYPES = {
  strong: 'strong',
  b: 'strong',
  em: 'em',
  i: 'em',
  s: 'strike',
  strike: 'strike',
  del: 'strike',
  u: 'u',
  mark: 'mark',
  code: 'code',
  sub: 'sub',
  sup: 'sup',
  small: 'small',
  span: 'span',
  abbr: 'abbr',
  cite: 'cite',
  time: 'time',
  bdi: 'bdi',
  bdo: 'bdo',
} as const;
function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node;
}
function isTextNode(node: HtmlNode): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === '#text';
}
function getAttribute(element: HtmlElement, name: string): string | null {
  return element.attrs.find((attr) => attr.name === name)?.value ?? null;
}
function fail(message: string): never {
  throw new AgreementPdfHtmlError(message);
}
function choice<const T extends string>(value: string, choices: readonly T[]): T {
  const result = choices.find((item) => item === value);
  if (result === undefined) fail(`ערך CSS אינו נתמך: ${value}`);
  return result;
}
function lengthPt(value: string, negative = false): number {
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|pt)?$/.exec(value);
  if (!match || (!match[2] && Number(match[1]) !== 0))
    fail(`אורך CSS אינו נתמך: ${value} (נדרש px או pt)`);
  const result = Number(match[1]) * (match[2] === 'px' ? 0.75 : 1);
  if (!Number.isFinite(result) || (!negative && result < 0)) fail(`אורך CSS אינו תקין: ${value}`);
  return result;
}
const COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  lime: '#00ff00',
  olive: '#808000',
  navy: '#000080',
  teal: '#008080',
  aqua: '#00ffff',
  orange: '#ffa500',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  rebeccapurple: '#663399',
  transparent: '#00000000',
};
function color(value: string): string {
  if (Object.hasOwn(COLORS, value)) return COLORS[value];
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(value)) return value;
  const rgb = /^(rgb|rgba)\(([^()]*)\)$/.exec(value);
  if (rgb) {
    const parts = rgb[2].split(',').map((part) => part.trim());
    if (
      parts.length === (rgb[1] === 'rgb' ? 3 : 4) &&
      parts.every((part) => /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(part))
    ) {
      const numbers = parts.map(Number);
      if (
        numbers.slice(0, 3).every((n) => n <= 255) &&
        (numbers[3] === undefined || numbers[3] <= 1)
      ) {
        return `#${numbers
          .map((n, i) =>
            Math.round(i === 3 ? n * 255 : n)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')}`;
      }
    }
  }
  return fail(`צבע CSS אינו נתמך: ${value}`);
}
function four<T>(values: T[]): [T, T, T, T] {
  if (values.length < 1 || values.length > 4) fail('קיצור CSS חייב להכיל בין ערך אחד לארבעה');
  return [
    values[0],
    values[1] ?? values[0],
    values[2] ?? values[0],
    values[3] ?? values[1] ?? values[0],
  ];
}
const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;
function box(style: AgreementPdfStyle, property: 'margin' | 'padding', value: string) {
  const values = four(value.split(/\s+/).map((v) => lengthPt(v, property === 'margin')));
  SIDES.forEach((side, i) => {
    style[`${property}${side}`] = values[i];
  });
}
function borderWidths(style: AgreementPdfStyle, values: number[]) {
  const expanded = four(values);
  SIDES.forEach((side, i) => {
    style[`border${side}Width`] = expanded[i];
  });
}
function borderColors(style: AgreementPdfStyle, values: string[]) {
  const expanded = four(values);
  SIDES.forEach((side, i) => {
    style[`border${side}Color`] = expanded[i];
  });
}
function borderStyles(style: AgreementPdfStyle, values: BorderStyle[]) {
  const expanded = four(values);
  SIDES.forEach((side, i) => {
    style[`border${side}Style`] = expanded[i];
  });
}
function cssWords(value: string): string[] {
  return value.match(/[^\s()]+\([^()]*\)|[^\s]+/g) ?? [];
}
function declaration(
  style: AgreementPdfStyle,
  property: string,
  value: string,
  block: boolean,
): void {
  switch (property) {
    case 'color':
      style.color = color(value);
      return;
    case 'background-color':
      style.backgroundColor = color(value);
      return;
    case 'opacity':
      if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) || Number(value) > 1)
        fail(`אטימות CSS אינה תקינה: ${value}`);
      style.opacity = Number(value);
      return;
    case 'font-size':
      style.fontSize = lengthPt(value);
      return;
    case 'font-weight':
      if (value === 'normal' || value === 'bold') style.fontWeight = value === 'bold' ? 700 : 400;
      else if (/^[1-9]00$/.test(value)) style.fontWeight = Number(value);
      else fail(`משקל גופן CSS אינו נתמך: ${value}`);
      return;
    case 'font-style':
      style.fontStyle = value === 'oblique' ? 'italic' : choice(value, ['normal', 'italic']);
      return;
    case 'letter-spacing':
      style.letterSpacing = value === 'normal' ? 0 : lengthPt(value, true);
      return;
    case 'line-height':
      if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && Number.isFinite(Number(value)))
        style.lineHeight = Number(value);
      else style.lineHeight = `${lengthPt(value)}pt`;
      return;
    case 'text-align':
      style.textAlign = choice(value, ['left', 'right', 'center', 'justify']);
      return;
    case 'text-decoration': {
      const words = value.split(/\s+/);
      if (words.length === 2 && words.includes('underline') && words.includes('line-through'))
        style.textDecoration = 'underline line-through';
      else style.textDecoration = choice(value, ['none', 'underline', 'line-through']);
      return;
    }
    case 'text-decoration-color':
      style.textDecorationColor = color(value);
      return;
    case 'text-decoration-style':
      style.textDecorationStyle = choice(value, ['solid', 'dashed', 'dotted']);
      return;
    case 'text-indent':
      style.textIndent = lengthPt(value, true);
      return;
    case 'text-transform':
      style.textTransform = choice(value, ['none', 'uppercase', 'lowercase', 'capitalize']);
      return;
    case 'vertical-align':
      style.verticalAlign = choice(value, ['sub', 'super']);
      return;
    case 'direction':
      style.direction = choice(value, ['rtl', 'ltr']);
      return;
  }
  if (block) {
    switch (property) {
      case 'margin':
      case 'padding':
        box(style, property, value);
        return;
      case 'margin-top':
        style.marginTop = lengthPt(value, true);
        return;
      case 'margin-right':
        style.marginRight = lengthPt(value, true);
        return;
      case 'margin-bottom':
        style.marginBottom = lengthPt(value, true);
        return;
      case 'margin-left':
        style.marginLeft = lengthPt(value, true);
        return;
      case 'padding-top':
        style.paddingTop = lengthPt(value);
        return;
      case 'padding-right':
        style.paddingRight = lengthPt(value);
        return;
      case 'padding-bottom':
        style.paddingBottom = lengthPt(value);
        return;
      case 'padding-left':
        style.paddingLeft = lengthPt(value);
        return;
      case 'border-width':
        borderWidths(
          style,
          cssWords(value).map((v) => lengthPt(v)),
        );
        return;
      case 'border-color':
        borderColors(style, cssWords(value).map(color));
        return;
      case 'border-style':
        borderStyles(
          style,
          cssWords(value).map((v) => choice(v, ['solid', 'dashed', 'dotted'])),
        );
        return;
      case 'border-radius': {
        const values = four(cssWords(value).map((v) => lengthPt(v)));
        (['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'] as const).forEach((corner, i) => {
          style[`border${corner}Radius`] = values[i];
        });
        return;
      }
      case 'border': {
        if (value === 'none' || value === '0') {
          borderWidths(style, [0]);
          return;
        }
        // Require all three components; never guess omitted browser defaults.
        const parts = cssWords(value);
        const borderStyle = parts.find((v) => ['solid', 'dashed', 'dotted'].includes(v));
        const width = parts.find((v) => /^(?:\d+(?:\.\d+)?|\.\d+)(px|pt)$/.test(v) || v === '0');
        const borderColor = parts.find((v) => v !== borderStyle && v !== width);
        if (parts.length !== 3 || !borderStyle || !width || !borderColor)
          fail(`קיצור border אינו נתמך: ${value}`);
        borderWidths(style, [lengthPt(width)]);
        borderColors(style, [color(borderColor)]);
        borderStyles(style, [choice(borderStyle, ['solid', 'dashed', 'dotted'])]);
        return;
      }
    }
  }
  fail(`תכונת CSS אינה נתמכת ב-PDF: ${property}`);
}
function attributes(element: HtmlElement, extra: string[] = []): Styled {
  const style: AgreementPdfStyle = {};
  const allowed = new Set(['dir', 'style', 'title', ...extra]);
  for (const attr of element.attrs) {
    if (!allowed.has(attr.name))
      fail(`<${element.tagName}> כולל מאפיין שאינו נתמך ב-PDF: ${attr.name}`);
  }
  const dir = getAttribute(element, 'dir');
  if (dir !== null) style.direction = choice(dir, ['rtl', 'ltr']);
  const css = getAttribute(element, 'style');
  if (css !== null) {
    // Deliberately limited grammar: unsupported declarations are errors,
    // including comments, variables, escapes and !important.
    for (const part of css.split(';')) {
      if (!part.trim()) continue;
      const match = /^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i.exec(part);
      if (!match || !match[2]) fail(`<${element.tagName}> כולל הצהרת CSS שאינה תקינה: ${part}`);
      try {
        declaration(
          style,
          match[1].toLowerCase(),
          match[2].toLowerCase(),
          BLOCK_TAGS.has(element.tagName),
        );
      } catch (error) {
        if (!(error instanceof AgreementPdfHtmlError)) throw error;
        fail(`<${element.tagName}> CSS ${part.trim()}: ${error.message}`);
      }
    }
  }
  return Object.keys(style).length ? { style } : {};
}
function assertClass(element: HtmlElement, allowed: string[]) {
  const cls = getAttribute(element, 'class');
  if (cls && !allowed.includes(cls))
    fail(`<${element.tagName}> כולל class שאינו נתמך ב-PDF: ${cls}`);
}
function assertHref(href: string) {
  if (!href.trim()) fail('<a> בחוזה חייב לכלול href שאינו ריק');
  let url: URL;
  try {
    url = new URL(href, 'https://agreement.invalid');
  } catch {
    return fail(`<a> כולל כתובת שאינה תקינה: ${href}`);
  }
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol))
    fail(`<a> משתמש בפרוטוקול שאינו נתמך ב-PDF: ${url.protocol}`);
}
function trimInlineEdges(nodes: AgreementPdfInline[]): AgreementPdfInline[] {
  const result = [...nodes];
  if (result[0]?.type === 'text')
    result[0] = { ...result[0], value: result[0].value.replace(/^[\t\n\f\r ]+/, '') };
  const last = result.at(-1);
  if (last?.type === 'text')
    result[result.length - 1] = { ...last, value: last.value.replace(/[\t\n\f\r ]+$/, '') };
  return result.filter((node) => node.type !== 'text' || node.value !== '');
}
function parseInlineNode(node: HtmlNode, pre = false): AgreementPdfInline[] {
  if (isTextNode(node))
    return [{ type: 'text', value: pre ? node.value : node.value.replace(/[\t\n\f\r ]+/g, ' ') }];
  if (!isElement(node)) return fail(`נמצא node HTML שאינו נתמך ב-PDF: ${node.nodeName}`);
  const tag = node.tagName;
  if (tag === 'br') return [{ type: 'break', ...attributes(node) }];
  if (tag === 'a') {
    const attrs = attributes(node, ['href', 'target', 'rel']);
    const href = getAttribute(node, 'href') ?? '';
    assertHref(href);
    return [{ type: 'link', href, children: inlineChildren(node, pre, false), ...attrs }];
  }
  const type = Object.hasOwn(INLINE_TYPES, tag)
    ? INLINE_TYPES[tag as keyof typeof INLINE_TYPES]
    : undefined;
  if (!type) return fail(`האלמנט <${tag}> אינו נתמך בתוך טקסט PDF`);
  const attrs = attributes(
    node,
    tag === 'span' ? ['class'] : tag === 'time' || tag === 'del' ? ['datetime', 'cite'] : [],
  );
  const citation = getAttribute(node, 'cite');
  if (citation !== null) assertHref(citation);
  if (tag === 'span') assertClass(node, ['todo']);
  return [
    {
      type: tag === 'span' && getAttribute(node, 'class') === 'todo' ? 'todo' : type,
      children: inlineChildren(node, pre, false),
      ...attrs,
    },
  ];
}
function inlineChildren(element: HtmlElement, pre = false, trim = true): AgreementPdfInline[] {
  const nodes = element.childNodes.flatMap((node) => parseInlineNode(node, pre));
  return trim && !pre ? trimInlineEdges(nodes) : nodes;
}
function parseMixedBlocks(nodes: HtmlNode[]): AgreementPdfBlock[] {
  const blocks: AgreementPdfBlock[] = [];
  let pending: AgreementPdfInline[] = [];
  const flush = () => {
    const children = trimInlineEdges(pending);
    if (children.length) blocks.push({ type: 'paragraph', children, implicit: true });
    pending = [];
  };
  for (const node of nodes) {
    if (isElement(node) && BLOCK_TAGS.has(node.tagName)) {
      flush();
      blocks.push(parseBlock(node));
    } else pending.push(...parseInlineNode(node));
  }
  flush();
  return blocks;
}
function elementChildren(element: HtmlElement): HtmlNode[] {
  return element.childNodes.filter((node) => !isTextNode(node) || node.value.trim() !== '');
}
function parseBlock(element: HtmlElement): AgreementPdfBlock {
  const tag = element.tagName;
  const attrs = attributes(element, tag === 'div' || tag === 'dl' ? ['class'] : []);
  if (/^h[1-6]$/.test(tag))
    return {
      type: 'heading',
      level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6,
      children: inlineChildren(element),
      ...attrs,
    };
  if (tag === 'p' || tag === 'pre')
    return {
      type: tag === 'p' ? 'paragraph' : 'pre',
      children: inlineChildren(element, tag === 'pre'),
      ...attrs,
    };
  if (tag === 'hr') return { type: 'rule', ...attrs };
  if (tag === 'div') {
    assertClass(element, ['sub', 'intent', 'draft']);
    const cls = getAttribute(element, 'class');
    if (cls === 'sub' || cls === 'intent' || cls === 'draft')
      return { type: 'note', variant: cls, blocks: parseMixedBlocks(element.childNodes), ...attrs };
  }
  if (tag === 'dl') {
    assertClass(element, ['terms']);
    if (getAttribute(element, 'class') === 'terms') {
      const children = elementChildren(element);
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
        )
          fail('<dl class="terms"> חייב להכיל זוגות dt/dd לפי הסדר');
        rows.push({
          term: parseMixedBlocks(term.childNodes),
          definition: parseMixedBlocks(definition.childNodes),
          termStyle: attributes(term).style,
          definitionStyle: attributes(definition).style,
        });
      }
      return { type: 'terms', rows, ...attrs };
    }
  }
  if (tag === 'ul' || tag === 'ol') {
    const items = elementChildren(element).map((child) => {
      if (!isElement(child) || child.tagName !== 'li')
        return fail(`<${tag}> יכול להכיל רק <li> ברמת הבן הישירה`);
      return { blocks: parseMixedBlocks(child.childNodes), ...attributes(child) };
    });
    return { type: 'list', ordered: tag === 'ol', items, ...attrs };
  }
  if (tag === 'blockquote')
    return { type: 'blockquote', blocks: parseMixedBlocks(element.childNodes), ...attrs };
  return { type: 'container', tag, blocks: parseMixedBlocks(element.childNodes), ...attrs };
}
export function parseAgreementPdfHtml(html: string): AgreementPdfBlock[] {
  // Fragment parsing drops html/head/body attributes. Inspect those in a full
  // parse too, so a handler or unsupported style cannot disappear before the
  // compatibility gate sees it. The input contract is a body fragment.
  const document = parse(html);
  const root = document.childNodes.find((node) => isElement(node) && node.tagName === 'html');
  if (root && isElement(root)) {
    for (const wrapper of [root, ...root.childNodes.filter(isElement)]) {
      if (wrapper.attrs.length) {
        fail(
          `<${wrapper.tagName}> כולל מאפייני מעטפת שאינם נתמכים ב-PDF: ${wrapper.attrs.map((attr) => attr.name).join(', ')}`,
        );
      }
    }
  }
  return parseMixedBlocks(parseFragment(html).childNodes);
}
export function findAgreementPdfCompatibilityIssues(html: string): string[] {
  try {
    parseAgreementPdfHtml(html);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : 'נוסח החוזה אינו ניתן להמרה ל-PDF'];
  }
}
