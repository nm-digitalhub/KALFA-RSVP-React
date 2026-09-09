// The four reference namespaces, end to end through the real runner.
//
// Written because the execution layer was believed to be incomplete long after
// it was working — a stale comment in run-workflow.ts claimed the resolver was
// "deliberately not vendored" while `resolve-template.ts` sat two directories
// away, imported and running on every node. A comment cannot be trusted to say
// whether a feature is wired. These can.
//
// `variables` gets the most attention here because it is the namespace that was
// genuinely empty, and because it is the only one an owner cannot forge.
import { describe, expect, it } from 'vitest';

import { dryRunWorkflow } from '../engine/dry-run';

type Props = Record<string, unknown>;

function node(id: string, type: string, properties: Props = {}) {
  return { id, type: 'node', position: { x: 0, y: 0 }, data: { type, icon: 'Lightning', properties } };
}

function edge(id: string, source: string, target: string) {
  return { id, source, target, sourceHandle: null };
}

/** A trigger and a send that quotes `value`. */
function quoting(
  value: string,
  opts: { globalVariables?: Record<string, unknown>; errorPolicy?: string } = {},
) {
  return {
    name: 'בדיקה',
    layoutDirection: 'DOWN',
    ...(opts.globalVariables ? { globalVariables: opts.globalVariables } : {}),
    nodes: [
      node('t', 'trigger.whatsapp_inbound'),
      node('say', 'action.send_whatsapp', {
        body: value,
        // 'continue' by default so a resolution result is what the assertion
        // sees. The failure cases below ask for 'fail' explicitly — otherwise
        // the policy absorbs the throw and the run reports completed, which is
        // correct behaviour and useless as a test of the throw.
        errorPolicy: opts.errorPolicy ?? 'continue',
      }),
    ],
    edges: [edge('e1', 't', 'say')],
  };
}

/**
 * One entry of the editor's variables panel, in the shape it actually persists.
 *
 * Spelled out rather than abbreviated because the first version of this test
 * passed `{ name, value }` and the diagram failed to parse — `editorDiagramSchema`
 * requires all five fields, and the value an owner types lands in
 * `defaultValue`, not `value`.
 */
function globalVar(id: string, name: string, defaultValue: string) {
  return { [id]: { id, name, type: 'string', defaultValue, description: '' } };
}

function run(definition: unknown) {
  return dryRunWorkflow({
    workflowId: 'wf-ref',
    storedDefinition: definition,
    allNodeIds: ['t', 'say'],
    scenario: { messageText: 'כן', buttonPayload: '', guestCase: 'one' },
  });
}

/** The text that would have reached the guest, unwrapped from the effect line. */
function sentBody(effects: { kind: string; description: string }[]): string {
  const sent = effects.find((e) => e.kind === 'send_whatsapp');
  return sent?.description.replace(/^היה שולח לאורח בוואטסאפ: "/, '').replace(/"$/, '') ?? '';
}

describe('every namespace resolves against real runtime data', () => {
  it('trigger', async () => {
    const result = await run(quoting('שלום {{trigger.guest_name}}'));
    expect(sentBody(result.effects)).toBe('שלום דנה');
  });

  it('nodes', async () => {
    const result = await run({
      name: 'בדיקה',
      layoutDirection: 'DOWN',
      nodes: [
        node('t', 'trigger.whatsapp_inbound'),
        node('v', 'logic.set_value', { value: 'ערך-מחושב' }),
        node('say', 'action.send_whatsapp', {
          body: 'קיבלנו {{nodes.v.value}}',
          errorPolicy: 'continue',
        }),
      ],
      edges: [edge('e1', 't', 'v'), edge('e2', 'v', 'say')],
    });
    expect(sentBody(result.effects)).toBe('קיבלנו ערך-מחושב');
  });

  it('global — the owner’s variables panel reaches the runner', async () => {
    // The panel persists `globalVariables` keyed by an internal id; the adapter
    // re-keys by NAME, because `{{global.<name>}}` is how a reference spells it
    // and the panel's own id never appears in a template.
    const result = await run(
      quoting('נתראה ב{{global.venue}}', {
        globalVariables: globalVar('var-1', 'venue', 'אולמי הגן'),
      }),
    );
    expect(sentBody(result.effects)).toBe('נתראה באולמי הגן');
  });

  it('variables — the server-injected bag, which used to be empty', async () => {
    // The finding that prompted this file: `variables` was hard-coded to `{}`,
    // so the one namespace an owner CANNOT forge carried nothing.
    const result = await run(quoting('אשרו כאן: {{variables.app_url}}/r'));
    expect(sentBody(result.effects)).toBe('אשרו כאן: https://dry-run.example/r');
  });

  it('variables carries run_id and workflow_id, and the caller cannot override them', async () => {
    // Added by `runWorkflow` itself rather than accepted from its caller: it
    // already knows both, and a caller free to supply its own could put a
    // different run's id into a team alert.
    const result = await run(quoting('{{variables.workflow_id}}/{{variables.run_id}}'));
    expect(sentBody(result.effects)).toBe('wf-ref/dry-run');
  });
});

describe('a reference the context cannot satisfy', () => {
  it('fails the run loudly, naming the token', async () => {
    const result = await run(quoting('שלום {{trigger.no_such_field}}', { errorPolicy: 'fail' }));

    expect(result.outcome.status).not.toBe('completed');
    const failed = result.steps.find((s) => s.status === 'failed');
    // The token itself, not a generic "template error" — this message is the
    // only thing standing between an owner and a silent wrong send.
    expect(failed?.errorMessage).toContain('{{trigger.no_such_field}}');
    expect(result.effects).toEqual([]);
  });

  it('resolves to empty with safe navigation (`?`)', async () => {
    const result = await run(quoting('שלום {{trigger.no_such_field?}}!'));
    expect(sentBody(result.effects)).toBe('שלום !');
  });

  it('resolves to the fallback with `| default`', async () => {
    const result = await run(quoting("שלום {{trigger.no_such_field | default:'אורח יקר'}}"));
    expect(sentBody(result.effects)).toBe('שלום אורח יקר');
  });

  it('rejects an unknown namespace rather than passing it through', async () => {
    // Passing it through would put `{{secrets.token}}` in a guest's message.
    const result = await run(quoting('{{secrets.token}}', { errorPolicy: 'fail' }));
    expect(result.outcome.status).not.toBe('completed');
    expect(result.effects).toEqual([]);
  });
});

describe("Meta's positional placeholders are not template references", () => {
  it('leaves {{1}} untouched', async () => {
    // 85 of these live in approved WhatsApp templates. The outer regex requires
    // a dot, so a bare number cannot match — pinned here because a "small"
    // regex tidy-up would silently corrupt every approved template.
    const result = await run(quoting('שלום {{1}}, האירוע ב-{{2}}'));
    expect(sentBody(result.effects)).toBe('שלום {{1}}, האירוע ב-{{2}}');
  });
});
