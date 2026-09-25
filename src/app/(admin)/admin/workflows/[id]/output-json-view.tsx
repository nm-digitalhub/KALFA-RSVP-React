'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';

import JsonView from '@uiw/react-json-view';
import { darkTheme } from '@uiw/react-json-view/dark';
import { lightTheme } from '@uiw/react-json-view/light';

import { outputPaths, referenceFor } from './output-paths';

// A step's output, shown as a tree — and a way to take a field from it into the
// workflow.
//
// THE SPLIT (owner, 25.9):
//   - `flat` turns the output into paths and values (`output-paths.ts`) — the
//     same `.0` paths `resolveTemplate` walks and the variable picker offers;
//   - `@uiw/react-json-view` draws them: names, values, objects, arrays;
//   - this file joins the two: a field NAME is a button, and clicking it copies
//     `{{nodes.<step>.<path>}}` — the exact text a text field stores — so it can
//     be pasted into the next step.
//
// ⚠️ COPY, NOT INSERT. The SDK exposes no API to write into another node's text
// field (its mention input is not exported — see the chip-label patch notes), so
// the reference goes to the clipboard and the author pastes it. Pasted into a
// field it renders as the same chip `{{` would have made.
//
// ⚠️ ONLY LEAVES ARE OFFERED. A reference to an object resolves to text like
// "[object Object]" in a message; `flat`'s leaf paths are exactly the fields a
// template can print.
//
// `dir="ltr"`: keys, braces and quotes must not be mirrored by the RTL panel
// around it (the phone screenshot of 25.9). Hebrew VALUES still read correctly —
// the browser's bidi algorithm handles a Hebrew run inside LTR text.

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const readDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

export function OutputJsonView({ nodeId, value }: { nodeId: string; value: unknown }) {
  // The SDK stamps html[data-theme] itself (see highlighting.css); follow it.
  const dark = useSyncExternalStore(subscribeTheme, readDark, () => false);
  const leaves = useMemo(() => outputPaths(value), [value]);
  const [copied, setCopied] = useState<string | null>(null);

  if (value === null || typeof value !== 'object') {
    return (
      <pre dir="ltr" className="rounded-md bg-muted p-2 text-start text-xs whitespace-pre-wrap wrap-anywhere">
        {JSON.stringify(value)}
      </pre>
    );
  }

  const copy = (path: string) => {
    const reference = referenceFor(nodeId, path);
    void navigator.clipboard?.writeText(reference).then(
      () => setCopied(reference),
      () => setCopied(null),
    );
  };

  return (
    <div className="space-y-1">
      <div dir="ltr" className="overflow-x-auto rounded-md text-start text-xs">
        <JsonView
          value={value as object}
          collapsed={2}
          displayDataTypes={false}
          enableClipboard={false}
          // Hebrew values are the whole point; never cut them to 30 characters.
          shortenTextAfterLength={0}
          style={{ ...(dark ? darkTheme : lightTheme), fontSize: '0.75rem', padding: '0.5rem' }}
        >
          <JsonView.KeyName
            render={({ children, ...props }, { keys }) => {
              const path = (keys ?? []).join('.');
              if (!leaves.has(path)) return <span {...props}>{children}</span>;
              return (
                <button
                  type="button"
                  {...(props as object)}
                  className="cursor-pointer underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-2"
                  title={`העתקת ${referenceFor(nodeId, path)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    copy(path);
                  }}
                >
                  {children}
                </button>
              );
            }}
          />
        </JsonView>
      </div>
      <p className="text-xs text-muted-foreground" role="status">
        {copied ? (
          <>
            הועתק <code dir="ltr">{copied}</code> — הדביקו בשדה של צעד מאוחר יותר.
          </>
        ) : (
          'לחיצה על שם שדה מעתיקה את ההפניה אליו, להדבקה בצעד הבא.'
        )}
      </p>
    </div>
  );
}
