// A WhatsApp template as a guest would see it, filled with the example values
// submitted to Meta with it (Meta requires one per variable; the mirror keeps
// them in `components`). PURE: the admin screen renders it, no send reads it.
// A variable without an example stays visible as {{n}} — never guessed.

import { metaComponents, type MetaTemplateComponent } from '@/lib/whatsapp/template-route';

type HeaderFormat = NonNullable<MetaTemplateComponent['format']>;
type ButtonType = NonNullable<NonNullable<MetaTemplateComponent['buttons']>[number]['type']>;

export type TemplatePreview = {
  /** A text header is shown filled; any other format (image, video, document, location) by its kind. */
  header: { kind: 'text'; text: string } | { kind: Exclude<HeaderFormat, 'TEXT'> } | null;
  body: string;
  footer: string | null;
  buttons: Array<{ type: ButtonType | null; text: string }>;
};

const VARIABLE = /\{\{\s*([^}\s]+)\s*\}\}/g;

function fill(text: string, examples: readonly string[] | undefined): string {
  return text.replace(VARIABLE, (whole, name: string) => {
    const n = Number(name);
    const value = Number.isInteger(n) && n >= 1 ? examples?.[n - 1] : undefined;
    return value ?? whole;
  });
}

export function templatePreview(components: unknown): TemplatePreview {
  const preview: TemplatePreview = { header: null, body: '', footer: null, buttons: [] };
  for (const c of metaComponents(components)) {
    if (c.type === 'HEADER') {
      if (c.format && c.format !== 'TEXT') preview.header = { kind: c.format };
      else if (c.text) preview.header = { kind: 'text', text: fill(c.text, c.example?.header_text) };
    } else if (c.type === 'BODY') {
      preview.body = fill(c.text ?? '', c.example?.body_text?.[0]);
    } else if (c.type === 'FOOTER') {
      preview.footer = c.text ?? null;
    } else if (c.type === 'BUTTONS') {
      preview.buttons = (c.buttons ?? []).map((b) => ({ type: b.type ?? null, text: b.text ?? '' }));
    }
  }
  return preview;
}
