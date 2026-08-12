import 'server-only';

import { z } from 'zod';

// Typed, soft-failing client for the kalfa-ops-agent sidecar
// (ops/probe-server.mjs — see that file's header for what it is and why it
// is NOT part of the .claude/fleet/ agent system). Loopback-only, bearer-auth,
// four fixed GET routes. Every call resolves to a {ok:true,data} / {ok:false}
// union — a dead or slow sidecar must never throw and take the whole debug
// page down with it (see plan §8: "כישלון-רך").

const UPSTREAM = process.env.OPS_AGENT_UPSTREAM ?? 'http://127.0.0.1:3012';
const TOKEN = process.env.OPS_AGENT_TOKEN;
const FETCH_TIMEOUT_MS = 4_000;

export type SoftResult<T> = { ok: true; data: T } | { ok: false; reason: string };

const processEntrySchema = z.object({
  name: z.string(),
  status: z.string(),
  restarts: z.number(),
  unstable: z.number(),
  memMB: z.number().nullable(),
  cpu: z.number().nullable(),
  uptimeSec: z.number().nullable(),
  cwd: z.string().nullable(),
  script: z.string().nullable(),
});

export const processesSchema = z.object({
  pm2: z.array(processEntrySchema),
  declared: z.array(z.string()),
  undeclared: z.array(z.string()),
  missing: z.array(z.string()),
});
export type ProcessesProbe = z.infer<typeof processesSchema>;

export const systemSchema = z.object({
  disk: z
    .object({ fs: z.string(), type: z.string(), sizeGB: z.number(), usedGB: z.number(), availGB: z.number(), pct: z.number().nullable() })
    .nullable(),
  mem: z
    .object({
      totalMB: z.number().nullable(),
      availMB: z.number().nullable(),
      pct: z.number().nullable(),
      swapUsedMB: z.number().nullable(),
      swapTotalMB: z.number().nullable(),
      swapPct: z.number().nullable(),
    })
    .nullable(),
  swapActivity: z
    .object({ pswpinPerSec: z.number(), pswpoutPerSec: z.number(), sampledAt: z.string() })
    .nullable(),
  load: z.tuple([z.number(), z.number(), z.number()]),
  uptimeSec: z.number(),
  nodeVersion: z.string(),
  puppeteerCache: z.object({ chrome: z.boolean(), headlessShell: z.boolean() }),
  logsDirBytes: z.object({ fleetDrafts: z.number().nullable(), pm2Logs: z.number().nullable() }),
});
export type SystemProbe = z.infer<typeof systemSchema>;

export const deploySchema = z.object({
  deployId: z.string().nullable(),
  buildId: z.string().nullable(),
  gitHead: z.string().nullable(),
  gitOriginMain: z.string().nullable(),
  ahead: z.number().nullable(),
  behind: z.number().nullable(),
  dirtyFiles: z.number(),
  localMigrationsCount: z.number().nullable(),
});
export type DeployProbe = z.infer<typeof deploySchema>;

const httpTargetSchema = z.object({ code: z.number().nullable(), ms: z.number() });
export const httpSchema = z.object({ origin: httpTargetSchema, edge: httpTargetSchema });
export type HttpProbe = z.infer<typeof httpSchema>;

async function callProbe<T>(path: string, schema: z.ZodType<T>): Promise<SoftResult<T>> {
  if (!TOKEN) return { ok: false, reason: 'OPS_AGENT_TOKEN not configured' };
  try {
    const res = await fetch(`${UPSTREAM}${path}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, reason: `sidecar responded ${res.status}` };
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) return { ok: false, reason: 'sidecar response failed validation' };
    return { ok: true, data: parsed.data };
  } catch {
    // Sidecar down / timed out / network error — never throw into a page render.
    return { ok: false, reason: 'sidecar unreachable' };
  }
}

export const getProcessesProbe = () => callProbe('/probe/processes', processesSchema);
export const getSystemProbe = () => callProbe('/probe/system', systemSchema);
export const getDeployProbe = () => callProbe('/probe/deploy', deploySchema);
export const getHttpProbe = () => callProbe('/probe/http', httpSchema);
