'use client';

import { useState, useSyncExternalStore } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';

import { Button } from '@/components/ui/button';
import {
  AGREEMENT_CSS,
  findUnknownTokens,
  missingPackageTokens,
  perResultTokensIn,
  type AgreementModel,
} from '@/lib/agreements/template';
import { cn } from '@/lib/utils';

import {
  canEditVisually,
  contractExtensions,
  serializeContractHtml,
} from './contract-editor-extensions';

// The contract body field of the admin form. A visual editor (TipTap) when the body survives a round trip through it
// unchanged; otherwise the plain HTML field, so that opening a contract can never rewrite it. Either way the form
// receives the body as ONE field, `name`, holding the contract HTML ('' = no custom body).

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';

type Mode = 'pending' | 'visual' | 'html';

// canEditVisually builds an editor, so the answer is remembered per body.
const modeCache = new Map<string, Exclude<Mode, 'pending'>>();
function modeFor(html: string): Exclude<Mode, 'pending'> {
  let mode = modeCache.get(html);
  if (!mode) {
    mode = canEditVisually(html) ? 'visual' : 'html';
    modeCache.set(html, mode);
  }
  return mode;
}
const subscribeNothing = () => () => {};

export function ContractBodyEditor({
  name,
  initialHtml,
  tokens,
  model,
}: {
  name: string;
  initialHtml: string;
  /** Every token the body may use (built-in and admin-config), for the insert buttons and the typo check. */
  tokens: readonly string[];
  model: AgreementModel;
}) {
  // The check needs the browser (DOMParser): the server renders the 'pending' state and the client takes over.
  const mode = useSyncExternalStore<Mode>(subscribeNothing, () => modeFor(initialHtml), () => 'pending');

  if (mode === 'pending') {
    // Submitting before the editor is ready must save the body unchanged, so the field is there from the start.
    return (
      <div>
        <input type="hidden" name={name} value={initialHtml} />
        <p className="text-sm text-muted-foreground" role="status">
          טוען את העורך…
        </p>
      </div>
    );
  }
  return mode === 'visual' ? (
    <VisualEditor name={name} initialHtml={initialHtml} tokens={tokens} model={model} />
  ) : (
    <HtmlEditor name={name} initialHtml={initialHtml} tokens={tokens} model={model} />
  );
}

function TokenWarnings({
  html,
  tokens,
  model,
}: {
  html: string;
  tokens: readonly string[];
  model: AgreementModel;
}) {
  const unknown = findUnknownTokens(html, tokens);
  const missing = model === 'package' ? missingPackageTokens(html) : [];
  const quoted = model === 'package' ? perResultTokensIn(html) : [];
  if (unknown.length === 0 && missing.length === 0 && quoted.length === 0) return null;
  return (
    <div role="status" className="space-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
      {unknown.length > 0 ? (
        <p>
          תחליפים שאינם מוכרים (יוצגו ללקוח כמו שהם, והאישור יידחה):{' '}
          {unknown.map((t) => (
            <code key={t} className="me-1">{`{{${t}}}`}</code>
          ))}
        </p>
      ) : null}
      {missing.length > 0 ? (
        <p>
          חוזה החבילה חייב לכלול:{' '}
          {missing.map((t) => (
            <code key={t} className="me-1">{`{{${t}}}`}</code>
          ))}
        </p>
      ) : null}
      {quoted.length > 0 ? (
        <p>
          חוזה החבילה אינו יכול לצטט נתוני חיוב לפי תוצאה (בחבילה הם מוצגים כ-₪0.00):{' '}
          {quoted.map((t) => (
            <code key={t} className="me-1">{`{{${t}}}`}</code>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function VisualEditor({
  name,
  initialHtml,
  tokens,
  model,
}: {
  name: string;
  initialHtml: string;
  tokens: readonly string[];
  model: AgreementModel;
}) {
  const [html, setHtml] = useState(initialHtml);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: contractExtensions(),
    content: initialHtml,
    editorProps: {
      attributes: {
        // RTL by the container, not by the editor's textDirection option (which would write dir into the contract).
        dir: 'rtl',
        'aria-label': 'נוסח החוזה',
        'aria-multiline': 'true',
        role: 'textbox',
        class: cn(
          'agreement-doc min-h-72 rounded-md border border-border bg-white p-4 outline-none',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        ),
      },
    },
    onUpdate: ({ editor: ed }) => setHtml(serializeContractHtml(ed)),
  });

  const active = useEditorState({
    editor,
    selector: ({ editor: ed }) =>
      ed
        ? {
            bold: ed.isActive('bold'),
            h2: ed.isActive('heading', { level: 2 }),
            h3: ed.isActive('heading', { level: 3 }),
            list: ed.isActive('bulletList'),
            note: ed.isActive('contractNote'),
            canUndo: ed.can().undo(),
            canRedo: ed.can().redo(),
          }
        : null,
  });

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={html} />
      <style dangerouslySetInnerHTML={{ __html: AGREEMENT_CSS }} />
      <div role="toolbar" aria-label="עיצוב הנוסח" className="flex flex-wrap gap-1.5">
        <ToolButton label="מודגש" pressed={active?.bold ?? false} onClick={() => editor?.chain().focus().toggleBold().run()} />
        <ToolButton label="כותרת" pressed={active?.h2 ?? false} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolButton label="כותרת משנה" pressed={active?.h3 ?? false} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} />
        <ToolButton label="רשימה" pressed={active?.list ?? false} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
        <ToolButton
          label="תיבת הדגשה"
          pressed={active?.note ?? false}
          onClick={() =>
            active?.note
              ? editor?.chain().focus().setParagraph().run()
              : editor?.chain().focus().setNode('contractNote', { class: 'intent' }).run()
          }
        />
        <ToolButton label="בטל" disabled={!active?.canUndo} onClick={() => editor?.chain().focus().undo().run()} />
        <ToolButton label="בצע שוב" disabled={!active?.canRedo} onClick={() => editor?.chain().focus().redo().run()} />
      </div>
      <EditorContent editor={editor} />
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">הוספת תחליף במקום הסמן (מוחלף בערך אמיתי בעת ההצגה):</p>
        <div className="flex flex-wrap gap-1">
          {tokens.map((t) => (
            <Button
              key={t}
              type="button"
              variant="outline"
              size="xs"
              dir="ltr"
              className="font-mono"
              onClick={() => editor?.chain().focus().insertContent(`{{${t}}}`).run()}
            >{`{{${t}}}`}</Button>
          ))}
        </div>
      </div>
      <TokenWarnings html={html} tokens={tokens} model={model} />
    </div>
  );
}

function ToolButton({
  label,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={pressed ? 'secondary' : 'outline'}
      aria-pressed={pressed === undefined ? undefined : pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

// The fallback: a body the visual editor cannot reproduce exactly is edited as HTML.
function HtmlEditor({
  name,
  initialHtml,
  tokens,
  model,
}: {
  name: string;
  initialHtml: string;
  tokens: readonly string[];
  model: AgreementModel;
}) {
  const [html, setHtml] = useState(initialHtml);
  return (
    <div className="space-y-2">
      <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
        הנוסח הזה כולל מבנה שהעורך החזותי אינו שומר במדויק, ולכן הוא נערך כ-HTML.
      </p>
      <textarea
        name={name}
        rows={14}
        value={html}
        onChange={(e) => setHtml(e.target.value)}
        dir="ltr"
        aria-label="נוסח החוזה (HTML)"
        className={`${inputClass} font-mono`}
      />
      <TokenWarnings html={html} tokens={tokens} model={model} />
    </div>
  );
}
