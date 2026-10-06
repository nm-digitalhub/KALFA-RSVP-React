import { Editor, Node, type Extensions } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';

// The visual editor for the contract body. The contract is HTML with a few structures a rich-text schema does not
// know — the terms table (<dl class="terms">), the highlighted box (<div class="intent">) and the sub-title
// (<div class="sub">) — and TipTap silently DROPS what its schema does not know. So those three structures are
// defined here, each recognised on the way in (parseHTML) and written back exactly (renderHTML), and
// canEditVisually() proves, for a given body, that loading it into the editor and reading it back loses nothing.
// A body that fails that proof is edited as plain HTML instead (see ContractBodyEditor), never rewritten silently.
//
// Right-to-left is the editor's DOM attribute, NOT the editor's `textDirection` option: that option writes a dir
// attribute onto every node of the document and so would change the contract HTML that gets saved.

const TERMS_LIST_CLASS = 'terms';
const NOTE_CLASSES = ['sub', 'intent'] as const;
export type ContractNoteClass = (typeof NOTE_CLASSES)[number];

const classAttribute = {
  default: null as string | null,
  parseHTML: (el: HTMLElement) => el.getAttribute('class'),
  renderHTML: (attrs: Record<string, unknown>) => (typeof attrs.class === 'string' ? { class: attrs.class } : {}),
};

export const TermsTerm = Node.create({
  name: 'termsTerm',
  content: 'inline*',
  parseHTML: () => [{ tag: 'dt' }],
  renderHTML: () => ['dt', 0],
});

export const TermsDefinition = Node.create({
  name: 'termsDefinition',
  content: 'inline*',
  parseHTML: () => [{ tag: 'dd' }],
  renderHTML: () => ['dd', 0],
});

export const TermsList = Node.create({
  name: 'termsList',
  group: 'block',
  content: '(termsTerm | termsDefinition)+',
  addAttributes: () => ({ class: classAttribute }),
  parseHTML: () => [{ tag: 'dl' }],
  renderHTML: ({ HTMLAttributes }) => ['dl', HTMLAttributes, 0],
});

// <div class="sub"> and <div class="intent"> only; any other <div> is not recognised, which the lossless check reports.
export const ContractNote = Node.create({
  name: 'contractNote',
  group: 'block',
  content: 'inline*',
  addAttributes: () => ({ class: { ...classAttribute, default: 'intent' as string | null } }),
  parseHTML: () => [
    {
      tag: 'div',
      getAttrs: (el) => {
        const cls = (el as HTMLElement).getAttribute('class');
        return cls !== null && (NOTE_CLASSES as readonly string[]).includes(cls) ? { class: cls } : false;
      },
    },
  ],
  renderHTML: ({ HTMLAttributes }) => ['div', HTMLAttributes, 0],
});

export const TERMS_LIST_DEFAULT_CLASS = TERMS_LIST_CLASS;

export function contractExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      code: false,
      codeBlock: false,
      // No rel/target/class of the editor's own: a link is written exactly as it was loaded.
      link: { openOnClick: false, autolink: false, linkOnPaste: false, HTMLAttributes: { target: null, rel: null, class: null } },
    }),
    TermsList,
    TermsTerm,
    TermsDefinition,
    ContractNote,
  ];
}

// The editor wraps the text of every list item in a <p>; the contract writes <li>text</li> and its stylesheet gives <p>
// a margin, so the wrapper would change how the list looks. A list item whose only child is a plain <p> is unwrapped
// on the way out; the editor accepts the unwrapped form on the way in.
function unwrapListItemParagraphs(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const li of doc.body.querySelectorAll('li')) {
    const only = li.children.length === 1 && li.childNodes.length === 1 ? li.children[0] : null;
    if (only?.tagName === 'P' && only.attributes.length === 0) only.replaceWith(...only.childNodes);
  }
  return doc.body.innerHTML;
}

// The contract HTML the editor currently holds: '' for an empty editor (an empty body means "no custom body"),
// otherwise the document with the list-item wrappers removed.
export function serializeContractHtml(editor: Editor): string {
  return editor.isEmpty ? '' : unwrapListItemParagraphs(editor.getHTML());
}

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HR', 'LI', 'OL', 'P', 'SECTION', 'UL', 'BODY',
]);
const isBlock = (n: Node_ | null): boolean => n !== null && n.nodeType === 1 && BLOCK_TAGS.has((n as Element).tagName);
type Node_ = globalThis.Node;

// The HTML in a canonical form for COMPARISON only: parsed and re-serialised (so attribute quoting and entity spelling
// stop mattering), whitespace runs collapsed, and the layout whitespace between and around blocks removed. Whitespace
// inside running text is kept (collapsed), because that is content.
export function normalizeContractHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (el: Element) => {
    for (const child of [...el.childNodes]) {
      if (child.nodeType === 3) child.textContent = (child.textContent ?? '').replace(/\s+/g, ' ');
      else if (child.nodeType === 1) walk(child as Element);
    }
    // Whitespace at the start or end of a line (next to a <br>) is not rendered, and the editor drops it.
    for (const child of [...el.childNodes]) {
      if (child.nodeType !== 3) continue;
      const afterBreak = (child.previousSibling as Element | null)?.tagName === 'BR';
      const beforeBreak = (child.nextSibling as Element | null)?.tagName === 'BR';
      if (afterBreak) child.textContent = (child.textContent ?? '').replace(/^\s+/, '');
      if (beforeBreak) child.textContent = (child.textContent ?? '').replace(/\s+$/, '');
    }
    for (const child of [...el.childNodes]) {
      if (child.nodeType === 3 && (child.textContent ?? '') === '') child.remove();
      else if (child.nodeType === 3 && (child.textContent ?? '').trim() === '') {
        const edgeOfBlock = isBlock(el) && (child === el.firstChild || child === el.lastChild);
        if (edgeOfBlock || isBlock(child.previousSibling) || isBlock(child.nextSibling)) child.remove();
      }
    }
    if (isBlock(el)) {
      const first = el.firstChild;
      const last = el.lastChild;
      if (first?.nodeType === 3) first.textContent = (first.textContent ?? '').replace(/^\s+/, '');
      if (last?.nodeType === 3) last.textContent = (last.textContent ?? '').replace(/\s+$/, '');
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

// True when the visual editor reproduces `html` exactly (up to the whitespace normalised above). The editor's own
// content check is not enough for this — its documentation warns that it does not detect every loss — so the proof is
// the round trip itself.
export function canEditVisually(html: string): boolean {
  if (html.trim() === '') return true; // nothing to lose: the starting point of a new body
  const editor = new Editor({ extensions: contractExtensions(), content: html });
  try {
    return normalizeContractHtml(serializeContractHtml(editor)) === normalizeContractHtml(html);
  } finally {
    editor.destroy();
  }
}
