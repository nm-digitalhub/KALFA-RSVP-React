import { flatten } from 'flat';

// The leaf paths of a step's output, flattened by `flat` into the same `.0`
// form `resolveTemplate` walks — the fields a template can print. Only paths the
// template grammar accepts (`[\w.-]`) are returned; a key with a space or a
// quote could never be referenced.

const SAFE_PATH = /^[\w.-]+$/;

export function outputPaths(output: unknown): Set<string> {
  if (output === null || typeof output !== 'object') return new Set();
  const flat = flatten<unknown, Record<string, unknown>>(output);
  return new Set(
    Object.entries(flat)
      // `flat` keeps an empty {} / [] as one leaf: there is nothing to print in it.
      .filter(([, value]) => value === null || typeof value !== 'object')
      .map(([path]) => path)
      .filter((path) => SAFE_PATH.test(path)),
  );
}

/** The text a workflow field stores for a reference to `path` in step `nodeId`. */
export function referenceFor(nodeId: string, path: string): string {
  return `{{nodes.${nodeId}.${path}}}`;
}
