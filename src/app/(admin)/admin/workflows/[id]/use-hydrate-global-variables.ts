import { useStore, type IntegrationDataFormat } from "@workflowbuilder/sdk";
import { useEffect } from "react";

type GlobalVariables = IntegrationDataFormat["globalVariables"];

/**
 * The server's global variables as a string, for use as an effect dependency.
 *
 * An RSC refresh hands the editor a NEW object even when nothing changed, and
 * keying the hydration on that identity overwrote edits the owner had not yet
 * saved. Equal content gives an equal string, so React skips the effect.
 * The column is jsonb, which stores keys in one canonical order, so the same
 * content always serialises the same way.
 */
export function globalVariablesKey(value: GlobalVariables | undefined): string {
  return JSON.stringify(value ?? {});
}

export function parseGlobalVariablesKey(key: string): GlobalVariables {
  return JSON.parse(key) as GlobalVariables;
}

/**
 * Writes the server's global variables into the SDK store.
 *
 * Root 2.3.0 does not expose globalVariables as an initial-data prop. Its
 * internal integration layer supports them, but Root does not forward them, so
 * they are written to the store here.
 *
 * ⚠️ KEYED ON CONTENT AND WORKFLOW, NOT ON THE PROP'S IDENTITY. An RSC refresh
 * (the OAuth popup's `router.refresh()`, for one) rebuilds this object with the
 * same content, and re-setting the store then wiped globals the owner had
 * edited but not yet saved; the next auto-save persisted the old ones. Now it
 * re-hydrates only when the saved content differs, or when another workflow
 * opens: Root's remount keeps the previous workflow's globals in the store.
 */
export function useHydrateGlobalVariables(
  workflowId: string,
  initialGlobalVariables: GlobalVariables | undefined,
): void {
  const globalVariablesJson = globalVariablesKey(initialGlobalVariables);
  useEffect(() => {
    useStore.setState({
      globalVariables: parseGlobalVariablesKey(globalVariablesJson),
    });
  }, [workflowId, globalVariablesJson]);
}
