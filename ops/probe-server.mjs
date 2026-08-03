// kalfa-ops-agent — loopback-only sidecar for KALFA's admin Debug Mode page.
//
// NOT related to the .claude/fleet/ agent system (kalfa-fleet PM2 process,
// scheduler.mjs, role prompts) — "agent" here is the standard infra-monitoring
// sense (Datadog Agent, CloudWatch Agent), a plain HTTP probe server with no
// Claude/LLM involvement. File named probe-server.mjs specifically to avoid
// that confusion; the PM2 process name kalfa-ops-agent stays distinguishable
// from kalfa-fleet in `pm2 jlist`.
//
// The Next.js server process (kalfa-beta) must never shell out — every system
// probe (pm2, df, git, du) runs HERE instead, in its own small PM2 process,
// via execFile with a fixed argument list (see probes.mjs), never a shell
// string. Plain ESM, no build step: the worker's esbuild bundle already broke
// once from `import.meta.url` going undefined inside a CJS bundle, so this
// process intentionally has nothing to bundle.
//
// Auth: static bearer token, OPS_AGENT_TOKEN — read from .env.local via
// `node --env-file=.env.local` (see ecosystem.config.cjs's kalfa-ops-agent
// entry), the same mechanism kalfa-pgboss-ui already uses for its own env
// file. Shared with the Next.js side (kalfa-beta already loads .env.local
// natively at `next start` boot), so no separate secret file to keep in sync.
// Bind: 127.0.0.1 only. The only path in is src/app/(admin)/admin/debug/*,
// itself gated by requirePlatformOwner() server-side before any request ever
// reaches this process.

import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

import { probeProcesses, probeSystem, probeDeploy, probeHttp } from './probes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PORT = Number(process.env.OPS_AGENT_PORT ?? 3012);
const HOST = '127.0.0.1';

const TOKEN = process.env.OPS_AGENT_TOKEN;
if (!TOKEN) {
  throw new Error(
    'kalfa-ops-agent: OPS_AGENT_TOKEN is not set — expected in .env.local, loaded via --env-file',
  );
}

function timingSafeTokenEqual(candidate) {
  const a = Buffer.from(candidate);
  const b = Buffer.from(TOKEN);
  // timingSafeEqual throws on length mismatch rather than returning false —
  // guard explicitly so an attacker can't distinguish "wrong length" from
  // "wrong content" by timing, and so we never hit the throw path at all.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorized(req) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) return false;
  return timingSafeTokenEqual(header.slice('Bearer '.length));
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// Fixed route table — no path parameters, nothing derived from the request
// beyond `req.url` matching one of these exact strings.
const ROUTES = {
  '/probe/processes': () => probeProcesses(REPO_ROOT),
  '/probe/system': () => probeSystem(REPO_ROOT),
  '/probe/deploy': () => probeDeploy(REPO_ROOT),
  '/probe/http': () => probeHttp(),
};

const server = createServer((req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  if (!authorized(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  const handler = ROUTES[req.url ?? ''];
  if (!handler) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  handler().then(
    (result) => sendJson(res, 200, result),
    (err) => sendJson(res, 500, { error: err instanceof Error ? err.message : 'probe failed' }),
  );
});

server.listen(PORT, HOST, () => {
  console.log(`kalfa-ops-agent listening on ${HOST}:${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
