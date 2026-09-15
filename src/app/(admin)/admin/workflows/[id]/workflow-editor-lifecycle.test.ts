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
  it('hydrates SDK global variables when their server prop changes', () => {
    const effect = effectContaining(
      'useStore.setState({ globalVariables: initialGlobalVariables ?? {} })',
    );

    expect(effect).toContain('[initialGlobalVariables]');
    expect(effect).not.toContain('resetExecution()');
    expect(effect).not.toContain('resetPanels()');
  });

  it('resets execution and panels only when the workflow identity changes', () => {
    const effect = effectContaining('resetExecution()');

    expect(effect).toContain('resetPanels()');
    expect(effect).toContain('[workflowId]');
    expect(effect).not.toContain('initialGlobalVariables');
  });
});
