/**
 * Relocation wizard — Meta WhatsApp template versioning (Stage B1/B2/G2).
 *
 * The URL-button base of an APPROVED template is baked on Meta's side (live
 * inventory 2026-08-24: 21 approved templates carry the current origin, all
 * text-only, all POSITIONAL, all with full `example` blocks). Moving origin
 * therefore means submitting NEW versions — never editing or deleting the
 * approved ones (owner rule: submit in addition, `_vN+1`), waiting for
 * Meta's review, and then switching the app's DB references
 * (message_templates.name + the components.variants / media_variants /
 * media_variant name maps) to the approved new names.
 *
 * Contract (same as external.ts): mutating functions check the
 * RELOCATE_EXECUTE latch; tokens travel in headers only; nothing here logs a
 * credential. Endpoints live-doc-verified 2026-08-24:
 *   POST /{WABA_ID}/message_templates  {name, language, category,
 *        parameter_format, components}          (Business Management API)
 *   GET  /{WABA_ID}/message_templates?fields=name,status,category,language,
 *        parameter_format,components&limit=200   (paged via paging.next)
 * URL button shape: {type:"URL", text, url:"https://…/{{1}}", example:["…"]}.
 */

export class RelocateExecuteLatchError extends Error {
  constructor() {
    super("execute latch is off — set RELOCATE_EXECUTE=1 to allow external mutations");
    this.name = "RelocateExecuteLatchError";
  }
}

function assertExecuteLatch(): void {
  if (process.env.RELOCATE_EXECUTE !== "1") throw new RelocateExecuteLatchError();
}

const GRAPH = "https://graph.facebook.com/v23.0";
const TIMEOUT_MS = 15_000;

export interface MetaCreds {
  wabaId: string;
  accessToken: string;
}

export interface MetaTemplateButton {
  type: string;
  text?: string;
  url?: string;
  example?: string[];
  [key: string]: unknown;
}

export interface MetaTemplateComponent {
  type: string;
  format?: string;
  text?: string;
  example?: unknown;
  buttons?: MetaTemplateButton[];
  [key: string]: unknown;
}

export interface MetaTemplate {
  id?: string;
  name: string;
  status: string;
  category: string;
  language: string;
  parameter_format?: string;
  components: MetaTemplateComponent[];
}

/* ------------------------------------------------------------------------- *
 * Pure helpers (exported for tests)
 * ------------------------------------------------------------------------- */

/** URL-button URLs of a template (only URL buttons carry an origin). */
export function templateUrls(t: Pick<MetaTemplate, "components">): string[] {
  return (t.components ?? [])
    .filter((c) => c.type === "BUTTONS")
    .flatMap((c) => c.buttons ?? [])
    .filter((b) => b.type === "URL" && typeof b.url === "string")
    .map((b) => b.url as string);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url.replace(/\{\{\d+\}\}/g, "x")).hostname;
  } catch {
    return null;
  }
}

/** APPROVED templates whose URL buttons point at `host`. */
export function affectedTemplates(templates: MetaTemplate[], host: string): MetaTemplate[] {
  return templates.filter(
    (t) => t.status === "APPROVED" && templateUrls(t).some((u) => hostOf(u) === host),
  );
}

/** `foo_v1` → `foo_v2`; `foo` → `foo_v2`; skips names already taken. */
export function nextVersionName(name: string, taken: ReadonlySet<string>): string {
  const m = name.match(/^(.*)_v(\d+)$/);
  const base = m ? m[1] : name;
  let n = m ? Number(m[2]) + 1 : 2;
  let candidate = `${base}_v${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base}_v${n}`;
  }
  return candidate;
}

function rewriteUrl(url: string, oldHost: string, newOrigin: string): string {
  const oldOrigin = `https://${oldHost}`;
  return url.startsWith(oldOrigin) ? `${newOrigin}${url.slice(oldOrigin.length)}` : url;
}

/** Deep-copies the components with every URL button (url + example) re-based
 * onto `newOrigin`. Everything else (BODY text + example, FOOTER, HEADER,
 * QUICK_REPLY buttons) is carried verbatim so the review sees the same
 * template with a new link base. */
export function rewriteComponents(
  components: MetaTemplateComponent[],
  oldHost: string,
  newOrigin: string,
): MetaTemplateComponent[] {
  return components.map((c) => {
    if (c.type !== "BUTTONS" || !Array.isArray(c.buttons)) return structuredClone(c);
    return {
      ...structuredClone(c),
      buttons: c.buttons.map((b) => {
        if (b.type !== "URL" || typeof b.url !== "string") return structuredClone(b);
        return {
          ...structuredClone(b),
          url: rewriteUrl(b.url, oldHost, newOrigin),
          example: Array.isArray(b.example)
            ? b.example.map((e) => rewriteUrl(e, oldHost, newOrigin))
            : b.example,
        };
      }),
    };
  });
}

export interface TemplateNamePlan {
  oldName: string;
  newName: string;
  /** Live status of `newName` when it already exists on the WABA; null = not
   * yet submitted. */
  newStatus: string | null;
}

/** Old→new name plan, recomputed from the LIVE inventory every time (no
 * state-file dependency): a successor already carrying the new host is
 * recognised whatever its status; otherwise the next free `_vN` is planned. */
export function planTemplateNames(
  templates: MetaTemplate[],
  oldHost: string,
  newHost: string,
): TemplateNamePlan[] {
  const taken = new Set(templates.map((t) => t.name));
  const byName = new Map(templates.map((t) => [t.name, t]));
  return affectedTemplates(templates, oldHost).map((t) => {
    const base = (t.name.match(/^(.*)_v\d+$/) ?? [null, t.name])[1] as string;
    const successor = templates.find(
      (s) =>
        s.name !== t.name &&
        s.name.startsWith(`${base}_v`) &&
        templateUrls(s).some((u) => hostOf(u) === newHost),
    );
    if (successor) {
      return { oldName: t.name, newName: successor.name, newStatus: successor.status };
    }
    const newName = nextVersionName(t.name, taken);
    taken.add(newName);
    return { oldName: t.name, newName, newStatus: byName.get(newName)?.status ?? null };
  });
}

export interface TemplateRow {
  message_key: string;
  name: string;
  components: unknown;
}

export interface TemplateRowUpdate {
  message_key: string;
  name: string;
  components: unknown;
  /** Which old names this update retires (for the report). */
  switched: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** DB switch plan: replaces every reference to an old name whose successor is
 * APPROVED — the row's own `name` and the per-event-type name maps inside
 * `components` (variants / media_variants / media_variant). Rows with nothing
 * to switch are omitted; a successor that is not yet approved leaves its old
 * name in place (the old button keeps working through the Stage E 301). */
export function planTemplateRowSwitch(
  rows: TemplateRow[],
  plans: TemplateNamePlan[],
): TemplateRowUpdate[] {
  const approvedMap = new Map(
    plans.filter((p) => p.newStatus === "APPROVED").map((p) => [p.oldName, p.newName]),
  );
  const updates: TemplateRowUpdate[] = [];
  for (const row of rows) {
    const switched: string[] = [];
    const swap = (name: unknown): unknown => {
      if (typeof name === "string" && approvedMap.has(name)) {
        switched.push(name);
        return approvedMap.get(name);
      }
      return name;
    };
    const name = swap(row.name) as string;
    let components = row.components;
    if (isRecord(components)) {
      const next: Record<string, unknown> = { ...components };
      for (const key of ["variants", "media_variants"]) {
        const map = next[key];
        if (isRecord(map)) {
          next[key] = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, swap(v)]));
        }
      }
      if ("media_variant" in next) next.media_variant = swap(next.media_variant);
      components = next;
    }
    if (switched.length > 0) updates.push({ message_key: row.message_key, name, components, switched });
  }
  return updates;
}

/** Old names still referenced anywhere in the DB rows (name or name maps). */
export function referencedOldNames(rows: TemplateRow[], plans: TemplateNamePlan[]): string[] {
  const old = new Set(plans.map((p) => p.oldName));
  const found = new Set<string>();
  const visit = (v: unknown): void => {
    if (typeof v === "string") {
      if (old.has(v)) found.add(v);
    } else if (isRecord(v)) {
      Object.values(v).forEach(visit);
    }
  };
  for (const row of rows) {
    visit(row.name);
    const c = row.components;
    if (isRecord(c)) {
      visit(c.variants);
      visit(c.media_variants);
      visit(c.media_variant);
    }
  }
  return [...found];
}

/** SQL string literal — single quotes doubled; used for values the wizard
 * itself built from validated template names / JSON. */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function templateSwitchSql(update: TemplateRowUpdate): string {
  const components =
    update.components === null || update.components === undefined
      ? "NULL"
      : `${sqlLiteral(JSON.stringify(update.components))}::jsonb`;
  return `UPDATE message_templates SET name = ${sqlLiteral(update.name)}, components = ${components} WHERE message_key = ${sqlLiteral(update.message_key)}`;
}

/* ------------------------------------------------------------------------- *
 * Graph API (read + latched create)
 * ------------------------------------------------------------------------- */

export async function listMetaTemplates(creds: MetaCreds): Promise<MetaTemplate[]> {
  const out: MetaTemplate[] = [];
  let url: string | null =
    `${GRAPH}/${creds.wabaId}/message_templates?fields=name,status,category,language,parameter_format,components&limit=200`;
  let guard = 0;
  while (url && guard < 20) {
    guard += 1;
    const res: Response = await fetch(url, {
      headers: { authorization: `Bearer ${creds.accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Meta template list failed: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: MetaTemplate[]; paging?: { next?: string } };
    out.push(...(body.data ?? []));
    // paging.next already carries the access token as a query param on Meta's
    // side; we still send the header and never print the URL.
    url = body.paging?.next ?? null;
  }
  return out;
}

/** MUTATING. Submits one new template version for review. */
export async function createMetaTemplate(
  creds: MetaCreds,
  template: Pick<MetaTemplate, "name" | "language" | "category" | "parameter_format" | "components">,
): Promise<{ ok: boolean; detail: string; id?: string; status?: string }> {
  assertExecuteLatch();
  try {
    const res = await fetch(`${GRAPH}/${creds.wabaId}/message_templates`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${creds.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: template.name,
        language: template.language,
        category: template.category,
        ...(template.parameter_format ? { parameter_format: template.parameter_format } : {}),
        components: template.components,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      error?: { message?: string; error_user_msg?: string };
    };
    if (!res.ok) {
      const msg = body.error?.error_user_msg ?? body.error?.message ?? `HTTP ${res.status}`;
      return { ok: false, detail: msg.slice(0, 200) };
    }
    return { ok: true, detail: `submitted ${template.name} (${body.status ?? "PENDING"})`, id: body.id, status: body.status };
  } catch (err) {
    const e = err as Error;
    return { ok: false, detail: e?.name === "TimeoutError" ? "timeout" : (e?.message ?? "transport error").slice(0, 200) };
  }
}
