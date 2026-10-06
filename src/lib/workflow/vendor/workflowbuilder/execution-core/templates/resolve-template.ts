// Resolves `{{namespace.path}}` references (e.g. `{{nodes.writer-1.response}}`)
// against the execution context.
//
// Three forms are supported. Plain references throw on missing values; the two
// modifiers let template authors opt into a safe fallback explicitly:
//
//   {{nodes.x.response}}                  → throws on missing  (explicit/strict)
//   {{nodes.x.response?}}                 → ''                  (safe-navigation)
//   {{nodes.x.response | default:'tbd'}}  → 'tbd'               (custom fallback)
//
// Keeping plain `{{x.y}}` strict is deliberate: a typo in a prompt template
// should fail loudly during development. The safe forms are an opt-in for
// authors who genuinely expect a value to be absent some of the time.
import type { ExecutionContext } from '../execution-context';

// Two-stage parse: the OUTER regex catches anything that *looks* like a
// template reference (a `{{namespace.…}}` block with a dot — the marker of
// authoring intent). The INNER regex validates the body against the actual
// grammar. If the inner parse fails, we throw a `Malformed template reference`
// error rather than silently leaking the broken token into the resolved
// string — e.g. `{{nodes.foo?bar}}` would otherwise pass through literally
// into an LLM prompt, which is the worst kind of silent failure for a
// flow-authoring tool.
//
// `{{}}`, `{{ }}`, `{{x}}` (no dot) are NOT caught by the outer regex — they
// do not declare a namespace path, so we treat them as plain text.
//
// The body matcher `(?:[^}]|\}(?!\}))*` allows single `}` (e.g. inside a
// default value: `default:'a } b'`) but stops at `}}`, the actual delimiter.
const OUTER_TEMPLATE_REGEX = /\{\{\s*\w+\.(?:[^}]|\}(?!\}))*\}\}/g;

// Anatomy of the inner parse regex (anchored to the whole token):
//   ^\{\{                  opening delimiter
//   \s*                    tolerate whitespace inside the braces
//   (?<namespace>\w+)      nodes | trigger | variables | global
//   \.
//   (?<path>[\w.-]+?)      dot-path: word chars, '.', '-' (kebab slugs).
//                          Anything outside this class is a typo and falls
//                          through to the 'Malformed template reference'
//                          branch rather than silently passing as an
//                          unresolvable key.
//   \s*
//   (?:                    optional modifier
//     (?<safe>\?)          '?' safe-navigation marker, OR
//     |
//     \|\s*default\s*:\s*'(?<default>[^']*)'   single-quoted default (no nested ')
//   )?
//   \s*
//   \}\}$                  closing delimiter
//
// DIVERGENCE FROM UPSTREAM, and the only one in this file: the groups are
// NUMBERED, not named. Upstream writes `(?<namespace>\w+)` and reads
// `exec(...).groups`, which needs `target: ES2018`; this project targets
// ES2017, and `tsc` rejects a named group outright (TS1503) rather than
// downlevelling it.
//
// That single incompatibility is the whole reason this file was left
// un-vendored when the rest of execution-core came across, and the reason
// stuck long after it stopped being a real obstacle. Converting four named
// groups to positions is mechanical and behaviour-preserving — an unmatched
// optional group is `undefined` either way — so the grammar below is upstream's
// exactly, character for character, minus the names.
//
//   1 namespace   nodes | trigger | variables | global
//   2 path        dot-path
//   3 safe        the '?' marker, or undefined
//   4 default     the single-quoted default, or undefined
const PARSE_REGEX =
  /^\{\{\s*(\w+)\.([\w.-]+?)\s*(?:(\?)|\|\s*default\s*:\s*'([^']*)')?\s*\}\}$/;

/**
 * The one namespace this resolver deliberately does NOT resolve.
 *
 * KALFA DIVERGENCE (the second in this file; the first is the numbered groups).
 *
 * `{{secrets.<NAME>}}` names an API key. If it were resolved here it would be
 * substituted into the node's config — and that resolved config is handed to the
 * handler, whose result is written to the step ledger, while sibling values reach
 * the dry-run trace and the editor's log panel. `redact.ts` cannot catch it:
 * that module matches on KEY names, and the key on a header row is `value`.
 *
 * So the token is passed through UNTOUCHED and resolved at the last possible
 * moment, inside the outbound port, against the process environment — by which
 * point the only thing that can see the value is the socket. The port refuses to
 * send any `{{secrets.…}}` it could not resolve, so a passthrough can never
 * leave the building as literal text either.
 *
 * Returning the match rather than throwing is what makes that possible: every
 * other unknown namespace still throws, which is the loud failure the strict
 * grammar exists for.
 */
const DEFERRED_NAMESPACE = 'secrets';

/**
 * ⚠️ OFF BY DEFAULT, and that default is the security property.
 *
 * `references.test.ts` pins exactly why: "Passing it through would put
 * `{{secrets.token}}` in a guest's message." A deferral that applied everywhere
 * would turn `{{secrets.API_KEY}}` in a WhatsApp body into literal text sent to
 * a real person — showing them a secret NAME and telling the owner nothing went
 * wrong. Strict-everywhere is the behaviour that has always been correct.
 *
 * So the caller opts in, per field, and today exactly one does: the header rows
 * of `action.webhook`, which are the only values that reach code able to
 * substitute them. Everywhere else an unknown namespace still throws.
 */
export type ResolveTemplateOptions = { deferSecrets?: boolean };

export function resolveTemplate(
  template: string,
  context: ExecutionContext,
  options: ResolveTemplateOptions = {},
): string {
  return template.replaceAll(OUTER_TEMPLATE_REGEX, (match) => {
    const parsed = PARSE_REGEX.exec(match);
    if (!parsed) {
      throw new Error(`Malformed template reference: ${match}`);
    }
    const [, namespace, path, safe, defaultValue] = parsed;

    // BEFORE resolveNamespace, which throws on it as unknown — which is exactly
    // what must still happen when the caller did not opt in.
    if (namespace === DEFERRED_NAMESPACE && options.deferSecrets) return match;

    const source = resolveNamespace(namespace!, context, match);
    const value = getNestedValue(source, path!);

    if (value === undefined) {
      if (safe === '?') return '';
      if (defaultValue !== undefined) return defaultValue;
      throw new Error(`Unresolved template reference: ${match}`);
    }

    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

function resolveNamespace(namespace: string, context: ExecutionContext, match: string): unknown {
  switch (namespace) {
    case 'nodes': {
      return context.nodeOutputs;
    }
    case 'trigger': {
      return context.triggerPayload;
    }
    case 'variables': {
      return context.variables;
    }
    case 'global': {
      return context.global;
    }
    default: {
      throw new Error(`Unresolved template reference: ${match} (unknown namespace "${namespace}")`);
    }
  }
}

function getNestedValue(object: unknown, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = object;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}
