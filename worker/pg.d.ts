// Minimal ambient declaration for the `pg` subset the worker uses. `pg` ships no
// bundled types and @types/pg is not installed; this covers exactly the Pool
// surface `worker/pgboss-meta.ts` needs (query + end). esbuild bundles the real
// module at build time. Scoped to the worker; never imported by the Next app.
declare module 'pg' {
  export class Pool {
    constructor(config?: Record<string, unknown>);
    query(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: Array<Record<string, unknown>> }>;
    end(): Promise<void>;
  }
}
