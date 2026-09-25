'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import {
  FormControlWithLabel,
  JsonFormsDispatch,
  optionIs,
  rankWith,
  useJsonForms,
  withJsonFormsControlProps,
  type ControlProps,
  type JsonFormsRendererExtension,
} from '@workflowbuilder/sdk';

import { SUMIT_FOLDER_FORMAT } from '@/lib/workflow/catalogue/ui-formats';

import { loadSumitFoldersAction, loadSumitViewsAction } from '../actions';

// The SUMIT trigger's folder and view, picked from SUMIT's own lists.
//
// ⚠️ THE FIELDS ARE THE EDITOR'S OWN SELECT, NOT OURS. Like the Microsoft
// connection picker (integration-connection-control.tsx), this renderer only
// LOADS the options and then hands each field to the SDK's built-in Select via
// `JsonFormsDispatch`, with a copy of the schema that carries those options.
// So both fields look and behave like every other select in the panel, and
// JsonForms still owns data / path / handleChange. The SDK exports no Select
// or Label component of its own; `FormControlWithLabel` is its primitive for the
// one place this renderer shows text instead of a field.
//
// This is JSON Forms' documented shape for a dependent, API-loaded enum
// (jsonforms.io/docs/tutorial/dynamic-enum): a custom control that fetches the
// options and resets the dependent field when its parent changes.
//
// ON DEMAND: the lists load when this control mounts — i.e. when the owner
// selects a SUMIT trigger node — never when the editor opens, so the editor
// works when SUMIT is unreachable. Until they arrive, a saved choice is shown
// by its id, which is all the diagram stores.

type Item = { id: string; name: string };
type Option = { value: string; label: string };
type ControlUiSchema = ControlProps['uischema'];

const NONE_LABEL = 'ללא — רישום ידני ב-SUMIT';

/** The folder field's uischema without the marker that selected this renderer (else it recurses). */
function delegatedFolderUiSchema(uischema: ControlUiSchema): ControlUiSchema {
  const { format: _format, ...rest } = (uischema.options ?? {}) as Record<string, unknown>;
  return { ...uischema, options: Object.keys(rest).length > 0 ? rest : undefined };
}

/** The view field: the same kind of Select, on the sibling property. */
function viewUiSchema(folderUiSchema: ControlUiSchema): ControlUiSchema {
  const delegated = delegatedFolderUiSchema(folderUiSchema);
  return { ...delegated, scope: delegated.scope.replace(/folderId$/, 'viewId'), label: 'תצוגה' };
}

type SchemaOf = ControlProps['rootSchema'];
/** A field's schema plus the `options` the SDK's Select reads (the node schemas' own convention). */
function withOptions(field: SchemaOf | undefined, options: Option[]): SchemaOf {
  return Object.assign({}, field ?? { type: 'string' as const }, { options });
}

/** Options for a saved id before (or without) the list: shown by id so the field is never blank. */
function withSaved(items: Item[] | null, saved: string): Option[] {
  const options = (items ?? []).map((i) => ({ value: i.id, label: i.name }));
  if (saved && !options.some((o) => o.value === saved)) {
    options.unshift({ value: saved, label: items ? `${saved} (לא נמצא ברשימה)` : saved });
  }
  return options;
}

function SumitFolderControl({ data, handleChange, path, enabled, readonly, uischema, rootSchema, label }: ControlProps) {
  const [folders, setFolders] = useState<Item[] | null>(null);
  // Keyed by folder, so a folder change shows no stale views without a reset in the effect.
  const [viewsFor, setViewsFor] = useState<{ folderId: string; items: Item[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const folderId = typeof data === 'string' ? data : '';
  // The sibling's saved value, from the form's own data (JsonForms hands a
  // control only its own field).
  const formData = useJsonForms().core?.data as Record<string, unknown> | undefined;
  const savedView = typeof formData?.viewId === 'string' ? formData.viewId : '';
  const viewPath = path.replace(/folderId$/, 'viewId');
  const views = viewsFor?.folderId === folderId ? viewsFor.items : null;

  // Folders once per mount; views whenever the folder changes. A CHANGED folder
  // also clears the view — a view id belongs to one folder (dynamic-enum's
  // "dependent" reset). The first run only loads: the saved view must survive.
  const previousFolder = useRef<string | null>(null);
  useEffect(() => {
    startTransition(async () => {
      const res = await loadSumitFoldersAction();
      if (res.ok) setFolders(res.items);
      else setError(res.message);
    });
  }, []);
  useEffect(() => {
    const changed = previousFolder.current !== null && previousFolder.current !== folderId;
    previousFolder.current = folderId;
    if (changed) handleChange(viewPath, '');
    if (!folderId) return;
    startTransition(async () => {
      const res = await loadSumitViewsAction(folderId);
      if (res.ok) setViewsFor({ folderId, items: res.items });
      else setError(res.message);
    });
    // handleChange / viewPath are stable for one node; re-running on them would clear the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  // A copy of the node's schema whose two fields carry the loaded options.
  const schema = useMemo<SchemaOf>(() => {
    const properties = rootSchema.properties ?? {};
    // Object.assign, not a spread: JsonSchema is a 4|7 union and a spread of it
    // does not narrow back to either.
    return Object.assign({}, rootSchema, {
      properties: {
        ...properties,
        folderId: withOptions(properties.folderId, [{ value: '', label: NONE_LABEL }, ...withSaved(folders, folderId)]),
        viewId: withOptions(properties.viewId, withSaved(views, savedView)),
      },
    });
  }, [rootSchema, folders, views, folderId, savedView]);

  if (error && !folders) {
    return (
      <FormControlWithLabel label={typeof label === 'string' ? label : 'תיקייה ב-SUMIT'}>
        <p role="alert" className="text-sm text-destructive">
          {error}. בחרו שוב את הצומת כדי לנסות שוב, או רשמו את הטריגר ידנית ב-SUMIT.
        </p>
      </FormControlWithLabel>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <JsonFormsDispatch
        schema={schema}
        uischema={delegatedFolderUiSchema(uischema)}
        enabled={enabled}
        readonly={readonly}
      />
      {folderId && (
        <JsonFormsDispatch schema={schema} uischema={viewUiSchema(uischema)} enabled={enabled} readonly={readonly} />
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {folderId && (
        <p className="text-xs text-muted-foreground">
          הפילטרים של התצוגה קובעים אילו כרטיסים מפעילים את התהליך, והעמודות שלה — אילו שדות נשלחים.
        </p>
      )}
    </div>
  );
}

export const sumitFolderRenderer: JsonFormsRendererExtension = {
  tester: rankWith(5000, optionIs('format', SUMIT_FOLDER_FORMAT)),
  renderer: withJsonFormsControlProps(SumitFolderControl),
};
