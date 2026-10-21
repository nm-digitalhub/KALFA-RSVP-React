import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// worker/main.ts starts pg-boss when it is imported and does not export these
// functions, so its three database connections are checked STRUCTURALLY, one
// dedicated assertion per connection site: the constructor call in each named
// function must take its port from the shared rule (supabaseDbPort). Nothing is
// imported from the worker and nothing connects.
const source = ts.createSourceFile(
  "main.ts",
  readFileSync(join(process.cwd(), "worker/main.ts"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);

function fn(name: string): ts.FunctionDeclaration {
  const found = source.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (!found) throw new Error(`worker/main.ts: function ${name} not found`);
  return found;
}

function constructions(node: ts.Node, ctor: string): ts.NewExpression[] {
  const out: ts.NewExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isNewExpression(n) && n.expression.getText(source) === ctor) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

function portOf(e: ts.NewExpression): string | null {
  const arg = e.arguments?.[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
  const port = arg.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(source) === "port");
  return port ? port.initializer.getText(source) : null;
}

describe("worker/main.ts — each database connection takes its port through supabaseDbPort", () => {
  it("imports supabaseDbPort from the shared rule", () => {
    const imp = source.statements.find(
      (s): s is ts.ImportDeclaration =>
        ts.isImportDeclaration(s) && (s.moduleSpecifier as ts.StringLiteral).text === "@/lib/relocation/env-validation",
    );
    expect(imp?.importClause?.getText(source)).toMatch(/\bsupabaseDbPort\b/);
  });

  it.each([
    ["withCallbackSchedulingLock", "PgClient", "the callback-scheduling lock"],
    ["startCallbackWorkListener", "PgClient", "the LISTEN client"],
    ["main", "PgBoss", "the pg-boss queue connection"],
  ])("%s: %s (%s) uses port: supabaseDbPort(process.env)", (name, ctor) => {
    const sites = constructions(fn(name), ctor);
    expect(sites, `${name}: exactly one new ${ctor}(...)`).toHaveLength(1);
    expect(portOf(sites[0]), `${name}: port of new ${ctor}`).toBe("supabaseDbPort(process.env)");
  });
});
