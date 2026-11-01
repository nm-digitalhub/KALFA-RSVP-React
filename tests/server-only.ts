import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The app's server modules import 'server-only', a marker package: under the "react-server" export condition (how
// the server resolves it) it is an empty module, under any other it throws. A test that runs server code in its own
// process — the package-activation worker in event-setup.spec.ts — resolves it the way the server does, through a
// Node module hook (node:module registerHooks, which covers require and import alike). Import this file before
// the server module.
const EMPTY = pathToFileURL(join(process.cwd(), 'node_modules', 'server-only', 'empty.js')).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: EMPTY, format: 'commonjs', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
