import { defineTransformer } from 'orval';

// Corrections applied to SUMIT's own OpenAPI document (openapi/sumit.openapi.json) before Orval generates the client.
// The vendor file is never edited: it stays byte-for-byte what SUMIT published, and every difference between it and
// what the live API does is written down HERE, once, for all 84 operations.
//
// Each correction was measured, not assumed (see docs/sumit-response-capture-and-audit.md §7 and the read-only live
// checks of 6.10.2026):
//   1. Credentials travel in the body of every request, so the generated functions must not ask the caller for them;
//      the mutator (src/lib/sumit/mutator.ts) adds them in one place.
//   2. Enums are declared as labels ("Order (8)", "CreditCard (1)", "Success (0)") but the live API sends and takes
//      NUMBERS; a label as a request value is answered with a TechnicalError. SUMIT's help article for DocumentType
//      says the same and lists 0..22.
//   3. getpdf answers with a PDF, and the spec only says "OK".
//   4. The spec repeats the same body under four JSON media types; keeping one makes the generated Content-Type
//      application/json, which is what the live API has always been called with.
//
// Multipart operations (the Creditguy tokenize calls, which carry flat `Credentials.CompanyID` fields) are left as
// they are: the mutator refuses them, and the application does not use them.

type Node = Record<string, unknown>;

const LABEL = /^(\w+) \((\d+)\)$/;
const GETPDF = '/accounting/documents/getpdf/';
const JSON_TYPE = 'application/json';

function walk(value: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
  } else if (value && typeof value === 'object') {
    visit(value as Node);
    Object.values(value as Node).forEach((item) => walk(item, visit));
  }
}

function dropCredentials(schemas: Record<string, unknown>): void {
  for (const schema of Object.values(schemas)) {
    const node = schema as { properties?: Node; required?: string[] };
    if (!node.properties || !('Credentials' in node.properties)) continue;
    delete node.properties.Credentials;
    node.required = node.required?.filter((name) => name !== 'Credentials');
    if (node.required?.length === 0) delete node.required;
  }
}

function numberEnums(root: unknown): void {
  walk(root, (node) => {
    const values = node.enum;
    if (!Array.isArray(values) || values.length === 0 || !values.every((v) => typeof v === 'string' && LABEL.test(v))) return;
    const parts = values.map((v) => LABEL.exec(v as string) as RegExpExecArray);
    node.enum = parts.map((p) => Number(p[2]));
    node['x-enumNames'] = parts.map((p) => p[1]);
    node.type = Array.isArray(node.type) ? node.type.map((t) => (t === 'string' ? 'integer' : t)) : 'integer';
  });
}

function keepOneJsonMediaType(content: Node | undefined): Node | undefined {
  return content?.[JSON_TYPE] ? { [JSON_TYPE]: content[JSON_TYPE] } : content;
}

export default defineTransformer((spec) => {
  const out = structuredClone(spec);

  dropCredentials(out.components?.schemas ?? {});
  numberEnums(out);

  for (const [path, item] of Object.entries(out.paths ?? {})) {
    for (const operation of Object.values(item ?? {})) {
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;
      const op = operation as { requestBody?: { content?: Node }; responses?: Record<string, { content?: Node }> };
      if (op.requestBody) op.requestBody.content = keepOneJsonMediaType(op.requestBody.content);
      if (path === GETPDF) {
        op.responses = { ...op.responses, '200': { ...op.responses?.['200'], content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } } };
        continue;
      }
      for (const response of Object.values(op.responses ?? {})) response.content = keepOneJsonMediaType(response.content);
    }
  }
  return out;
});
