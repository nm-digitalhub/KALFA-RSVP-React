import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const EDITOR = readFileSync(
  join(
    process.cwd(),
    'src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx',
  ),
  'utf8',
);

function effectContaining(statement: string): string {
  const effects = [
    ...EDITOR.matchAll(
      /useEffect\(\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*(\[[^\]]*\])\s*\);/g,
    ),
  ];

  const match = effects.find((effect) => effect[1]?.includes(statement));

  expect(
    match,
    `expected to find a useEffect containing ${statement}`,
  ).toBeDefined();

  return match![0];
}

describe('WorkflowEditor lifecycle invariants', () => {
  // The behaviour itself — identical content does not re-set the store, changed
  // content or a changed workflow does — is exercised at runtime in
  // use-hydrate-global-variables.test.tsx. This only pins that the editor uses it.
  it('hydrates SDK global variables through the content-keyed hook', () => {
    expect(EDITOR).toContain(
      'useHydrateGlobalVariables(workflowId, initialGlobalVariables);',
    );
    expect(EDITOR).not.toMatch(/\[initialGlobalVariables\]/);
  });

  it('resets execution and panels only when the workflow identity changes', () => {
    const effect = effectContaining('resetExecution()');

    expect(effect).toContain('resetPanels()');
    expect(effect).toContain('[workflowId]');
    expect(effect).not.toContain('initialGlobalVariables');
  });

  // The SDK keys its save context, auto-save effect and beforeunload listener on
  // `onDataSave`'s identity, so the handler must not be rebuilt inline in JSX.
  it('passes a memoised integration object, never an inline save handler', () => {
    expect(EDITOR).toContain('integration={integration}');
    expect(EDITOR).not.toMatch(/integration=\{\{/);
    expect(EDITOR).toMatch(
      /const integration = useMemo\([\s\S]*?makeSaveHandler\(workflowId, saveAction\)[\s\S]*?\[workflowId, saveAction\],?\s*\)/,
    );
  });
});
