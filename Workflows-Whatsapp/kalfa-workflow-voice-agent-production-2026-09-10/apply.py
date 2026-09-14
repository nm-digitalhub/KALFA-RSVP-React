#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

EXPECTED_BLOBS = {
    'src/lib/workflow/catalogue/types.ts': '2bf93d7e541d6d5ef24c7847db7d83def4db1470',
    'src/lib/workflow/catalogue/nodes.ts': '69f2056f4f6c77192f4642044d9cd9d328cb0fff',
    'src/lib/workflow/catalogue/schemas.ts': '8de188ba01f2eb590c5c81905cdaf99361a7c90a',
    'src/lib/workflow/catalogue/templates.ts': 'c4de34a0ff931ed64424aa4d4c162333fc676859',
    'src/lib/workflow/engine/ports.ts': '68b49c85ced0838b0261b2d5ccfd81b29795191d',
    'src/lib/workflow/engine/activity-runner.ts': '6d2e4af25eca1e2b169449a6307ce60a7d5495f7',
    'src/lib/workflow/engine/dry-run.ts': '7a0382e727cc9d910c6ad2c6cb898305722689c2',
    'src/lib/workflow/guest-actions.ts': '8165a7a48914816e41a5c034a5b557f274d12bc4',
    'src/lib/workflow/steps/index.ts': 'dd6071c5b7e3c9429b40b2ccc22d608f7b90d64a',
}

OLD_PREVIEW_MARKERS = (
    "'ai.generate_answer'",
    "'data.load_knowledge'",
    "'action.append_conversation_log'",
)


def git(*args: str) -> str:
    return subprocess.check_output(['git', *args], text=True).strip()


def replace_once(text: str, old: str, new: str, path: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected exactly one anchor, found {count}: {old[:80]!r}')
    return text.replace(old, new, 1)


def insert_before(text: str, anchor: str, addition: str, path: str) -> str:
    return replace_once(text, anchor, addition + anchor, path)


def blob(path: Path) -> str:
    return git('hash-object', str(path))


def ensure_repo(root: Path) -> None:
    try:
        top = Path(git('rev-parse', '--show-toplevel')).resolve()
    except Exception as exc:
        raise RuntimeError('run this installer from inside the KALFA git repository') from exc
    if top != root.resolve():
        raise RuntimeError(f'run from repository root: {top}')
    branch = git('branch', '--show-current')
    if branch != 'feat/admin-integrations-consolidation':
        raise RuntimeError(f'expected branch feat/admin-integrations-consolidation, found {branch}')


def verify_baseline(root: Path) -> None:
    errors: list[str] = []
    for rel, expected in EXPECTED_BLOBS.items():
        p = root / rel
        if not p.is_file():
            errors.append(f'missing {rel}')
            continue
        text = p.read_text(encoding='utf-8')
        if any(marker in text for marker in OLD_PREVIEW_MARKERS):
            errors.append(f'{rel}: old preview AI overlay is present; do not layer the production patch on top of it')
            continue
        actual = blob(p)
        if actual != expected:
            errors.append(f'{rel}: expected blob {expected}, found {actual}')
    target = root / 'src/lib/workflow/voice-agent-actions.ts'
    if target.exists():
        errors.append(f'{target.relative_to(root)} already exists')
    if errors:
        raise RuntimeError('baseline verification failed:\n- ' + '\n- '.join(errors))


def patch_types(text: str, path: str) -> str:
    text = replace_once(
        text,
        "  'action.send_whatsapp',\n  'action.notify_team',",
        "  'action.send_whatsapp',\n  'action.start_rsvp_ai_callback',\n  'action.notify_team',",
        path,
    )
    text = insert_before(
        text,
        '// An internal alert to the KALFA team',
        "// Starts the existing RSVP voice agent through KALFA's production dispatcher.\n"
        "// Agent/provider/model/knowledge configuration deliberately lives outside the diagram.\n"
        "export type StartRsvpAiCallbackConfig = Record<string, unknown>;\n\n",
        path,
    )
    text = replace_once(
        text,
        "  | { type: 'action.send_whatsapp'; config: SendWhatsappConfig }\n  | { type: 'action.notify_team'; config: NotifyTeamConfig }",
        "  | { type: 'action.send_whatsapp'; config: SendWhatsappConfig }\n"
        "  | { type: 'action.start_rsvp_ai_callback'; config: StartRsvpAiCallbackConfig }\n"
        "  | { type: 'action.notify_team'; config: NotifyTeamConfig }",
        path,
    )
    return text


def patch_nodes(text: str, path: str) -> str:
    return replace_once(
        text,
        "  { type: 'action.send_whatsapp', isTrigger: false },\n  { type: 'action.notify_team', isTrigger: false },",
        "  { type: 'action.send_whatsapp', isTrigger: false },\n"
        "  { type: 'action.start_rsvp_ai_callback', isTrigger: false },\n"
        "  { type: 'action.notify_team', isTrigger: false },",
        path,
    )


def patch_ports(text: str, path: str) -> str:
    anchor = "  getGuestsForContact(\n"
    addition = """  /**
   * Start the existing production RSVP voice agent for the contact that owns
   * this workflow run. Optional only so recording/test ports that predate the
   * node fail closed rather than gaining any network capability implicitly.
   */
  startRsvpAiCallback?(input: {
    runId: string;
    nodeId: string;
    eventId: string;
    contactId: string;
  }): Promise<{
    ok: boolean;
    status: string;
    reason?: string;
    attemptId?: string;
    callSessionHistoryId?: number;
  }>;

"""
    return insert_before(text, anchor, addition, path)


def patch_guest_actions(text: str, path: str) -> str:
    text = replace_once(
        text,
        "import { sendWhatsAppText } from '@/lib/whatsapp/client';\n\nimport type { GuestActionsPort } from './engine/ports';",
        "import { sendWhatsAppText } from '@/lib/whatsapp/client';\n\n"
        "import type { GuestActionsPort } from './engine/ports';\n"
        "import { dispatchWorkflowRsvpAiCallback } from './voice-agent-actions';",
        path,
    )
    text = replace_once(
        text,
        "  return {\n    async getGuestsForContact(eventId, contactId) {",
        "  return {\n"
        "    async startRsvpAiCallback(input) {\n"
        "      return dispatchWorkflowRsvpAiCallback(input);\n"
        "    },\n\n"
        "    async getGuestsForContact(eventId, contactId) {",
        path,
    )
    return text


def patch_steps(text: str, path: str) -> str:
    text = replace_once(
        text,
        "export type StepContext = {\n  trigger: WorkflowTriggerPayload;",
        "export type StepContext = {\n  runId: string;\n  nodeId: string;\n  trigger: WorkflowTriggerPayload;",
        path,
    )
    marker = "// ---------------------------------------------------------------------------\n// action.send_whatsapp\n// ---------------------------------------------------------------------------\n"
    handler = """// ---------------------------------------------------------------------------
// action.start_rsvp_ai_callback
// ---------------------------------------------------------------------------

const startRsvpAiCallback: StepHandler = async (_config, ctx) => {
  const dispatch = ctx.deps.guests.startRsvpAiCallback;
  if (!dispatch) {
    throw new PermanentNodeExecutionError(
      'voice_agent_not_wired',
      'צומת סוכן הקול אינו מחובר למימוש השרת.',
    );
  }

  const outcome = await dispatch({
    runId: ctx.runId,
    nodeId: ctx.nodeId,
    eventId: ctx.trigger.eventId,
    contactId: ctx.trigger.contactId,
  });

  if (!outcome.ok) {
    throw new PermanentNodeExecutionError(
      'voice_agent_dispatch_refused',
      `הפעלת שיחת הסוכן נדחתה (${outcome.reason ?? outcome.status}).`,
    );
  }

  return {
    output: {
      started: true,
      status: outcome.status,
      ...(outcome.attemptId ? { attemptId: outcome.attemptId } : {}),
      ...(outcome.callSessionHistoryId !== undefined
        ? { callSessionHistoryId: outcome.callSessionHistoryId }
        : {}),
    },
  };
};

"""
    text = insert_before(text, marker, handler, path)
    text = replace_once(
        text,
        "  'action.send_whatsapp': sendWhatsapp,\n  'action.notify_team': notifyTeam,",
        "  'action.send_whatsapp': sendWhatsapp,\n"
        "  'action.start_rsvp_ai_callback': startRsvpAiCallback,\n"
        "  'action.notify_team': notifyTeam,",
        path,
    )
    return text


def patch_activity_runner(text: str, path: str) -> str:
    return replace_once(
        text,
        "        const result = await handler(config, { trigger, deps: { guests, alerts } });",
        "        const result = await handler(config, {\n"
        "          runId,\n"
        "          nodeId: node.id,\n"
        "          trigger,\n"
        "          deps: { guests, alerts },\n"
        "        });",
        path,
    )


def patch_dry_run(text: str, path: str) -> str:
    text = replace_once(
        text,
        "  kind: 'submit_rsvp' | 'send_whatsapp' | 'notify_team';",
        "  kind: 'submit_rsvp' | 'send_whatsapp' | 'notify_team' | 'start_rsvp_ai_callback';",
        path,
    )
    text = replace_once(
        text,
        "  const guests: GuestActionsPort = {\n    async getGuestsForContact() {",
        "  const guests: GuestActionsPort = {\n"
        "    async startRsvpAiCallback() {\n"
        "      effects.push({\n"
        "        kind: 'start_rsvp_ai_callback',\n"
        "        description: 'היה מפעיל שיחה חוזרת באמצעות סוכן RSVP הקולי הקיים.',\n"
        "      });\n"
        "      return { ok: true, status: 'dry_run' };\n"
        "    },\n\n"
        "    async getGuestsForContact() {",
        path,
    )
    return text


def patch_schemas(text: str, path: str) -> str:
    marker = "// ---------------------------------------------------------------------------\n// The palette\n// ---------------------------------------------------------------------------\n"
    schema = """// ---------------------------------------------------------------------------
// action.start_rsvp_ai_callback
// ---------------------------------------------------------------------------

const startRsvpAiCallbackSchema = {
  type: 'object',
  required: ['label', 'description'],
  properties: {
    ...sharedProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;
const startRsvpAiCallbackScope = getScope<typeof startRsvpAiCallbackSchema>;
const startRsvpAiCallbackUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: startRsvpAiCallbackScope('properties.label'), label: 'שם הצעד' },
    {
      type: 'Label',
      text: 'מפעיל את סוכן RSVP הקולי הקיים דרך Voximplant ו-ElevenLabs. המודל, מאגר הידע והכלים מוגדרים בסוכן ואינם נשמרים בתהליך.',
    },
    {
      type: 'Label',
      text: 'השיחה אסינכרונית. הצעד מחזיר את תוצאת ההפעלה; ניתוח השיחה נשמר לאחר מכן דרך ה-webhook הקיים של ElevenLabs.',
    },
    {
      type: 'Select',
      scope: startRsvpAiCallbackScope('properties.errorPolicy'),
      label: 'אם הפעלת השיחה נכשלת',
    },
    statusControl(startRsvpAiCallbackScope('properties.status')),
  ],
};

"""
    text = insert_before(text, marker, schema, path)
    palette_anchor = "  {\n    type: 'action.notify_team' satisfies KalfaNodeType,"
    palette = """  {
    type: 'action.start_rsvp_ai_callback' satisfies KalfaNodeType,
    templateType: NodeType.DecisionNode,
    label: 'הפעלת סוכן RSVP קולי',
    description: 'מפעיל שיחה חוזרת באמצעות סוכן ה-RSVP הקולי הקיים',
    icon: 'PhoneCall',
    schema: startRsvpAiCallbackSchema,
    uischema: startRsvpAiCallbackUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        started: { type: 'boolean', label: 'הופעלה' },
        status: { type: 'string', label: 'סטטוס הפעלה' },
        reason: { type: 'string', label: 'סיבה' },
        attemptId: { type: 'string', label: 'מזהה ניסיון שיחה' },
        callSessionHistoryId: { type: 'number', label: 'מזהה שיחת Voximplant' },
      },
    },
    defaultPropertiesData: {
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'הפעלת סוכן RSVP קולי',
      description: 'מפעיל שיחה חוזרת באמצעות סוכן ה-RSVP הקולי הקיים',
      errorPolicy: errorPolicyOptions.fail.value,
    },
  },
"""
    return insert_before(text, palette_anchor, palette, path)


def patch_templates(text: str, path: str) -> str:
    marker = "/**\n * Built at MODULE SCOPE"
    diagram = """// ---------------------------------------------------------------------------
// Template 3 — guest-initiated RSVP voice callback
// ---------------------------------------------------------------------------

const rsvpAiVoiceCallback: DiagramModel = {
  name: 'בקשת שיחה עם סוכן RSVP קולי',
  layoutDirection: 'RIGHT',
  diagram: {
    nodes: [
      {
        id: 'voice-trigger',
        type: 'start-node',
        position: { x: 0, y: 120 },
        data: {
          segments: [],
          type: 'trigger.whatsapp_inbound',
          icon: 'WhatsappLogo',
          properties: {
            label: 'בקשת שיחה נכנסת',
            description: 'מתחיל רק כשהודעת האורח מכילה את מילת ההפעלה',
            keyword: 'שיחה',
          },
        },
      },
      {
        id: 'voice-agent-call',
        type: 'decision-node',
        position: { x: 420, y: 120 },
        data: {
          segments: [],
          type: 'action.start_rsvp_ai_callback',
          icon: 'PhoneCall',
          properties: {
            label: 'הפעלת סוכן RSVP קולי',
            description: 'מפעיל שיחה חוזרת דרך Voximplant אל סוכן ה-RSVP הקיים ב-ElevenLabs',
            status: 'active',
            errorPolicy: 'fail',
            decisionBranches: [
              { id: 'ok', sourceHandle: 'source:inner:ok', label: 'הצליח' },
              { id: 'error', sourceHandle: 'source:inner:error', label: 'נכשל' },
            ],
          },
        },
      },
    ],
    edges: [
      {
        id: 'voice-e1',
        source: 'voice-trigger',
        sourceHandle: SOURCE,
        target: 'voice-agent-call',
        targetHandle: TARGET,
        type: 'labelEdge',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

"""
    text = insert_before(text, marker, diagram, path)
    end = """  {
    id: 2,
    name: 'אישור הגעה עם תשובה לאורח',
    value: rsvpWithReply,
    icon: 'WhatsappLogo',
  },
];"""
    repl = """  {
    id: 2,
    name: 'אישור הגעה עם תשובה לאורח',
    value: rsvpWithReply,
    icon: 'WhatsappLogo',
  },
  {
    id: 3,
    name: 'בקשת שיחה עם סוכן RSVP קולי',
    value: rsvpAiVoiceCallback,
    icon: 'PhoneCall',
  },
];"""
    return replace_once(text, end, repl, path)


def main() -> int:
    root = Path.cwd()
    ensure_repo(root)
    verify_baseline(root)

    transforms = {
        'src/lib/workflow/catalogue/types.ts': patch_types,
        'src/lib/workflow/catalogue/nodes.ts': patch_nodes,
        'src/lib/workflow/catalogue/schemas.ts': patch_schemas,
        'src/lib/workflow/catalogue/templates.ts': patch_templates,
        'src/lib/workflow/engine/ports.ts': patch_ports,
        'src/lib/workflow/engine/activity-runner.ts': patch_activity_runner,
        'src/lib/workflow/engine/dry-run.ts': patch_dry_run,
        'src/lib/workflow/guest-actions.ts': patch_guest_actions,
        'src/lib/workflow/steps/index.ts': patch_steps,
    }

    pending: dict[Path, str] = {}
    for rel, transform in transforms.items():
        p = root / rel
        pending[p] = transform(p.read_text(encoding='utf-8'), rel)

    source = Path(__file__).resolve().with_name('voice-agent-actions.ts')
    if not source.is_file():
        raise RuntimeError('package file voice-agent-actions.ts is missing')
    pending[root / 'src/lib/workflow/voice-agent-actions.ts'] = source.read_text(encoding='utf-8')

    # All transformations succeeded before the first write.
    for p, content in pending.items():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding='utf-8')

    print('[OK] production RSVP voice-agent workflow wiring applied')
    print('[OK] no provider/model/KB credentials were added to workflow diagrams')
    print('[OK] no production call was placed by the installer')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f'[X] {exc}', file=sys.stderr)
        raise SystemExit(1)
