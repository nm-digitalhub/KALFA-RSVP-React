import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// `callback_requests.full_name` is NOT NULL, so every writer that has only a
// phone number stores a STAND-IN. `mtg/ctx` then takes the first token as a
// first name — correct for "דנה כהן", and nonsense for a stand-in.
//
// ⚠️ MEASURED: session 8429772552 on 2026-09-14 was dispatched with
// `dynamic_variables.lead_name = "מתקשר"`, and the agent's waypoint 1 says
// verbatim `שאל "מדבר/ת עם {{lead_name}}?"` — so a real person was asked
// "am I speaking with caller?".
//
// This pins the set against the literals actually present in the writers. A new
// writer inventing a fourth stand-in reintroduces the bug silently, and nothing
// else in the suite would notice: the ctx route would simply speak it aloud.

const CTX_ROUTE = 'src/app/api/voximplant/mtg/ctx/[token]/route.ts';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('callback_requests placeholder names', () => {
  it('⚠️ every stand-in a writer stores is known to the ctx route', () => {
    const ctx = read(CTX_ROUTE);
    const writers = [read('src/lib/data/console-calls.ts'), read('src/lib/workflow/guest-actions.ts')];

    // The literals as their writers spell them, verbatim.
    const placeholders = ['מתקשר לא מזוהה', 'מבקש/ת "התקשרו אליי עכשיו"', 'אורח'];

    for (const p of placeholders) {
      expect(
        writers.some((w) => w.includes(p)),
        `${p} is no longer written by any writer — remove it from the ctx route too`,
      ).toBe(true);
      expect(ctx, `${p} is written but the ctx route does not know it`).toContain(p);
    }
  });

  it('⚠️ the ctx route matches them EXACTLY, never by prefix', () => {
    // A prefix or `includes` test would blank a real person called אורח, and a
    // caller whose name genuinely starts with those letters.
    const ctx = read(CTX_ROUTE);
    expect(ctx).toContain('PLACEHOLDER_NAMES.has(rawName)');
    expect(ctx).not.toMatch(/PLACEHOLDER_NAMES[^\n]*(startsWith|includes)\(/);
  });

  it('⚠️ an unknown name still yields an empty lead_name, not a fake one', () => {
    // The agent has a rule for an empty field — "שדה ריק פירושו שאין לך את
    // המידע הזה — אל תמציא" — and now a branch for it. Handing it a stand-in
    // bypasses both.
    const ctx = read(CTX_ROUTE);
    expect(ctx).toMatch(/PLACEHOLDER_NAMES\.has\(rawName\) \? '' :/);
  });
});

describe('the Meeting-Confirm opening is rendered on the server', () => {
  const agent = JSON.parse(read('agent_configs/KALFA-Meeting-Confirm.json')) as {
    conversation_config: { agent: { first_message: string; prompt: { prompt: string } } };
  };
  const firstMessage = agent.conversation_config.agent.first_message;
  const prompt = agent.conversation_config.agent.prompt.prompt;
  const ctx = read(CTX_ROUTE);

  it('⚠️ the raw name is NEVER spliced into the first message', () => {
    // `first_message` is a static string with no conditionals: an empty
    // `lead_name` would make it say "…השיחה מוקלטת — מדבר עם ?". The opening
    // question now arrives whole, already chosen, in {{opening_line}}.
    expect(firstMessage).not.toContain('{{lead_name}}');
    expect(firstMessage).toContain('{{opening_line}}');
    // The recording notice is a legal requirement and must survive any rewrite.
    // Owner-set wording, 2026-09-14 — pinned in full, because a rewrite that
    // drops "לצורך תיעוד ובקרת השירות" silently narrows the disclosure.
    expect(firstMessage).toContain('כל השיחות מוקלטות לצורך תיעוד ובַּקָּרַת השירות');
    // ⚠️ The niqqud on בַּקָּרַת is not decoration: unpointed "בקרת השירות" reads
    // just as well as בִּקֹּרֶת ("criticism of the service"). Stripping it changes
    // what a caller is told, so the pin includes the marks.
    expect(firstMessage).toContain('בַּקָּרַת');
  });

  it('⚠️ opening_line is built from the BLANKED name, not the raw one', () => {
    // This is what makes the placeholder fix hold end-to-end: if the opening
    // were built from `rawName`, "מדבר/ת עם מתקשר?" would be back — spoken
    // from first_message, where no guardrail can intercept it.
    expect(ctx).toMatch(/const openingLine = leadName\s*\n?\s*\?/);
    expect(ctx).toContain('`מדבר/ת עם ${leadName}?`');
  });

  it('⚠️ the no-name opening states the reason for the call', () => {
    // The person did not ask for a callback — they tried to reach us. The
    // agent skipped this sentence in BOTH calls while it lived in the prompt
    // (conv_9301…, conv_8601…), which is why it moved here.
    expect(ctx).toContain('התקשרת אלינו קודם ולא הצלחנו לענות');
  });

  it('⚠️ the prompt does not re-ask what first_message already asked', () => {
    // A leftover "שאל מדבר/ת עם…" in waypoint 1 would double the question.
    expect(prompt).not.toContain('שאל בפשטות "מדבר/ת עם');
    expect(prompt).toContain('משפט הפתיחה כבר נאמר');
  });

  it('⚠️ never says "your request" to someone who requested nothing', () => {
    expect(prompt).toContain('אל תאמר "בקשה שלך" למי שלא ביקש דבר');
  });

  it('⚠️ forbids substituting a title for the missing name', () => {
    // Blanking it server-side is not enough on its own: an LLM with no name
    // will reach for "אדוני" or "לקוח" unless told not to.
    expect(prompt).toContain('אסור להחליף אותו בתואר');
    for (const title of ['מתקשר', 'אורח', 'לקוח', 'אדוני']) {
      expect(prompt, title).toContain(title);
    }
  });

  it('⚠️ the spoken date/time variables carry their own preposition', () => {
    // MEASURED 2026-09-14: the agent read "16:03"/"16:18" aloud because the ctx
    // route sent display digits. The route now sends Hebrew words that already
    // begin with "ב"/"היום", so a template "ל…"/"בשעה …" would produce
    // "להיום" and "בשעה בארבע".
    expect(prompt).not.toContain('ל{{scheduled_when_spoken}}');
    expect(prompt).not.toContain('בשעה {{scheduled_time_spoken}}');
    expect(ctx).toContain('formatIsraelRelativeSpokenDate(ctx.request.scheduled_at)');
    expect(ctx).toContain('formatIsraelSpokenClock(ctx.request.scheduled_at)');
  });
});

describe('the MeetingConfirm scenario forwards the opening', () => {
  const scenario = read('voxfiles/applications/kalfa-rsvp.kalfarsvp.voximplant.com/scenarios/src/MeetingConfirmAgent.voxengine.js');

  it('⚠️ injects opening_line, or first_message renders a literal {{opening_line}}', () => {
    expect(scenario).toContain('opening_line: state.openingLine');
    expect(scenario).toContain("state.openingLine = ctx.opening_line || ''");
  });
});
