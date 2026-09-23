// The source files the source-scan tests read, found on disk rather than
// named one by one.
//
// ⚠️ WHY THIS EXISTS. Several tests guard what a step handler IMPORTS — no
// SUMIT client, no child process, a `requireGuestContext` call per guest node —
// and they used to read `steps/index.ts` by path. Once handlers move to
// `nodes/<name>/runtime.ts`, such a test keeps passing while guarding a file the
// handlers no longer live in; its only anti-no-op was "the file is longer than
// 1000 characters", which a shrunken registry still is. These helpers read
// EVERY server-side node file, and `assertCoversEveryNodeFolder` fails the
// moment a node folder exists that the scan did not include.
//
// Test-support only: it reads the filesystem, and nothing on a server path
// imports it.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW_DIR = join(process.cwd(), 'src/lib/workflow');
const NODES_DIR = join(WORKFLOW_DIR, 'nodes');

export type SourceFile = { path: string; source: string };

function read(path: string): SourceFile {
  return { path: path.slice(process.cwd().length + 1), source: readFileSync(path, 'utf8') };
}

/** Every folder under `nodes/`. Empty before the first node moves. */
export function nodeFolders(): string[] {
  if (!existsSync(NODES_DIR)) return [];
  return readdirSync(NODES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Every non-test `.ts`/`.tsx` file under `dir`, recursively, sorted. */
function codeFilesUnder(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return codeFilesUnder(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
}

/**
 * The step sources a server-side guarantee is checked against: every non-test
 * file in `steps/`, and EVERY non-test code file in every node folder,
 * recursively.
 *
 * ⚠️ ALL OF THE FOLDER, NOT A LIST OF NAMES. A fixed list (`definition.ts`,
 * `runtime.ts`, `match.ts`) let a helper next to them — `outcome.ts`, a future
 * `helper.ts` — import a SUMIT client or spawn a process unseen. The editor
 * files are read too; the scans look for things no editor file has reason to
 * contain, so including them costs nothing and closes the gap.
 */
export function serverStepSources(): SourceFile[] {
  const stepsDir = join(WORKFLOW_DIR, 'steps');
  const steps = readdirSync(stepsDir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort()
    .map((name) => read(join(stepsDir, name)));

  const nodes = nodeFolders().flatMap((folder) => codeFilesUnder(join(NODES_DIR, folder)).map(read));

  return [...steps, ...nodes];
}

/**
 * Each node folder's palette file (`nodes/<name>/<name>.ts`), the editor-side
 * counterpart of the entries still inline in `catalogue/schemas.ts`.
 */
export function nodePaletteSources(): SourceFile[] {
  return nodeFolders()
    .map((folder) => join(NODES_DIR, folder, `${folder}.ts`))
    .filter((path) => existsSync(path))
    .map(read);
}

/**
 * The anti-no-op every scan runs: the registry and the shared module are in the
 * set, and so is the `runtime.ts` of every node folder on disk. A node folder
 * whose handler the scan missed fails here instead of passing silently.
 */
export function assertCoversEveryNodeFolder(files: SourceFile[]): string[] {
  const paths = new Set(files.map((file) => file.path));
  const missing: string[] = [];
  for (const required of ['src/lib/workflow/steps/index.ts', 'src/lib/workflow/steps/shared.ts']) {
    if (!paths.has(required)) missing.push(required);
  }
  for (const folder of nodeFolders()) {
    const runtime = `src/lib/workflow/nodes/${folder}/runtime.ts`;
    if (!paths.has(runtime)) missing.push(runtime);
  }
  return missing;
}
