'use client';

import { Icon, getStoreDataForIntegration, openModal } from '@workflowbuilder/sdk';

import { TEMPLATE_KEYS } from '@/lib/workflow/catalogue/schemas';
import { CALLBACK_TOPICS } from '@/lib/workflow/catalogue/types';
import { scrubForExport, type RemovedBinding } from '@/lib/workflow/portability';

// Replaces the SDK's own "Export" menu item, and the reason is not cosmetic.
//
// ⚠️ THE VENDOR'S EXPORT SHOWS THE RAW DIAGRAM. Read from the shipped bundle:
//
//   function iO() {
//     const t = useMemo(() => JSON.stringify(N1(), null, 2), []);   // N1 === getStoreDataForIntegration
//     …  <CodeEditor value={t} isDisabled /> … <Button onClick={copy}>
//   }
//
// `getStoreDataForIntegration()` returns node `properties` exactly as stored, so
// that copyable text box currently contains, for anyone who opens the menu:
//
//   trigger.webhook.token            the trigger's whole credential — the field's
//                                    own label calls it a password
//   action.webhook.url / headers     a webhook URL and headers, which may hold a
//                                    key an owner typed literally
//   action.microsoft_send_email.connectionId, and the four voice-call ids
//
// This is not a hypothetical: `dry-run.ts` already refuses to PRINT header values
// for exactly this reason, and an exported blob travels further than a screenshot.
//
// WHY REPLACE RATHER THAN WRAP. The vendor item's `onClick` is a closure over its
// own modal; there is no seam at which a decorator could filter what that modal
// renders. The smallest honest change is to open the same kind of modal with the
// scrubbed payload instead.
//
// ⚠️ NOT A NEW FEATURE. The modal, the code editor, the copy button and the
// matching Import flow all ship in the SDK. What is added here is the one thing
// it cannot know: which of OUR properties point into THIS installation.

/**
 * Whether a catalogue key means the same thing wherever the workflow lands.
 *
 * ⚠️ `purposeKey` IS NEVER PORTABLE, AND THAT IS A MEASURED FACT RATHER THAN
 * CAUTION. `listDialableVoicePurposes()` filters `!p.isBuiltin`, so every purpose
 * the editor can offer an author is one this installation created — the three
 * seeded `is_builtin` rows belong to the campaign engine and are not selectable
 * here. A key from this field therefore names a row that exists nowhere else.
 *
 * The other two are closed lists compiled into the app, so every installation
 * running this code has all of them.
 */
function isPortableCatalogueValue(property: string, value: string): boolean {
  if (property === 'messageKey') return TEMPLATE_KEYS.includes(value);
  if (property === 'topic') return (CALLBACK_TOPICS as readonly string[]).includes(value);
  return false;
}

const BINDING_REASON: Record<RemovedBinding['binding'], string> = {
  identifier: 'מזהה של ההתקנה הזו — יש לבחור מחדש ביעד',
  secret: 'סוד — יש להזין מחדש ביעד',
  catalogue: 'ערך שקיים רק כאן — יש לבחור מחדש ביעד',
};

function RemovedList({ removed }: { removed: RemovedBinding[] }) {
  if (removed.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="font-medium">
        הוסרו {removed.length} ערכים שאינם עוברים בין התקנות:
      </p>
      <ul className="list-disc space-y-0.5 pe-5">
        {removed.map((item) => (
          <li key={`${item.nodeId}.${item.property}`}>
            <span className="font-medium">{item.nodeLabel || item.nodeType}</span>
            {' — '}
            <code>{item.property}</code>
            {': '}
            {BINDING_REASON[item.binding]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExportContents() {
  // Built once, at open. The modal is read-only and the canvas cannot change
  // underneath it, so recomputing on every render would only cost work.
  const envelope = scrubForExport(getStoreDataForIntegration(), isPortableCatalogueValue);
  const text = JSON.stringify(envelope, null, 2);

  return (
    <div className="flex flex-col gap-3">
      <RemovedList removed={envelope.removed} />
      <textarea
        readOnly
        dir="ltr"
        value={text}
        rows={16}
        className="w-full rounded-md border bg-muted/40 p-2 font-mono text-xs"
        aria-label="תוכן הייצוא"
      />
      <button
        type="button"
        className="self-start rounded-md border px-3 py-1.5 text-sm"
        onClick={() => void navigator.clipboard?.writeText(text)}
      >
        העתקה
      </button>
    </div>
  );
}

export function openScrubbedExport(): void {
  openModal({
    title: 'ייצוא התהליך',
    icon: <Icon name="Export" />,
    content: <ExportContents />,
  });
}

/**
 * The vendor's Export item, identified so it can be dropped.
 *
 * By ICON NAME rather than by label: the label is a translated string
 * (`importExport.export`) and would stop matching the moment the editor language
 * changes, while the icon is written into the bundle as `name: "Export"`.
 *
 * Fail-closed rather than best-effort: `export-diagram.test.ts` asserts the
 * vendor still produces exactly one item this matches, so an SDK upgrade that
 * renames it fails the build instead of quietly shipping both exports — ours and
 * the one that leaks.
 */
export function isVendorExportItem(item: unknown): boolean {
  if (typeof item !== 'object' || item === null) return false;
  const icon = (item as { icon?: { props?: { name?: unknown } } }).icon;
  return icon?.props?.name === 'Export';
}
