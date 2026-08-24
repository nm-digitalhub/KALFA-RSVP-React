import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RelocateExecuteLatchError,
  affectedTemplates,
  createMetaTemplate,
  nextVersionName,
  planTemplateNames,
  planTemplateRowSwitch,
  referencedOldNames,
  rewriteComponents,
  templateSwitchSql,
  templateUrls,
  type MetaTemplate,
} from "./meta-templates";

// Shape copied from the LIVE inventory (2026-08-24): text-only, POSITIONAL,
// full example blocks, one URL button with a {{1}} suffix.
function tpl(name: string, url: string, status = "APPROVED"): MetaTemplate {
  return {
    name,
    status,
    category: "MARKETING",
    language: "he",
    parameter_format: "POSITIONAL",
    components: [
      { type: "BODY", text: "שלום {{1}}", example: { body_text: [["דנה"]] } },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: "לשליחת מתנה", url, example: [url.replace("{{1}}", "3f2a9c1b8d4e")] }],
      },
    ],
  };
}

const OLD = "old.example";
const NEW_ORIGIN = "https://new.example";

describe("template inventory helpers", () => {
  it("templateUrls / affectedTemplates pick only APPROVED templates whose URL button host matches", () => {
    const list = [
      tpl("gift_v1", `https://${OLD}/g/{{1}}`),
      tpl("otp_v1", "https://www.whatsapp.com/otp/{{1}}"),
      tpl("pending_v1", `https://${OLD}/g/{{1}}`, "PENDING"),
      tpl("apex_v1", "https://apex.example/g/{{1}}"),
    ];
    expect(templateUrls(list[0])).toEqual([`https://${OLD}/g/{{1}}`]);
    expect(affectedTemplates(list, OLD).map((t) => t.name)).toEqual(["gift_v1"]);
  });

  it("nextVersionName bumps _vN and skips taken names", () => {
    expect(nextVersionName("kalfa_event_gift_v1", new Set())).toBe("kalfa_event_gift_v2");
    expect(nextVersionName("kalfa_event_gift_v1", new Set(["kalfa_event_gift_v2"]))).toBe("kalfa_event_gift_v3");
    expect(nextVersionName("plain_name", new Set())).toBe("plain_name_v2");
    expect(nextVersionName("kalfa_brit_invite_trad_v4", new Set())).toBe("kalfa_brit_invite_trad_v5");
  });

  it("rewriteComponents re-bases URL buttons (url + example) and leaves everything else byte-identical", () => {
    const src = tpl("gift_v1", `https://${OLD}/g/{{1}}`);
    const out = rewriteComponents(src.components, OLD, NEW_ORIGIN);
    expect(out[0]).toEqual(src.components[0]);
    expect(out[1].buttons?.[0].url).toBe(`${NEW_ORIGIN}/g/{{1}}`);
    expect(out[1].buttons?.[0].example).toEqual([`${NEW_ORIGIN}/g/3f2a9c1b8d4e`]);
    // source untouched
    expect(src.components[1].buttons?.[0].url).toBe(`https://${OLD}/g/{{1}}`);
  });

  it("planTemplateNames recognises an existing successor on the new host (any status) and plans the rest", () => {
    const list = [
      tpl("kalfa_event_gift_v1", `https://${OLD}/g/{{1}}`),
      tpl("kalfa_event_gift_v2", `${NEW_ORIGIN}/g/{{1}}`, "PENDING"),
      tpl("kalfa_event_final_v1", `https://${OLD}/ty/{{1}}`),
    ];
    const plans = planTemplateNames(list, OLD, "new.example");
    expect(plans).toEqual([
      { oldName: "kalfa_event_gift_v1", newName: "kalfa_event_gift_v2", newStatus: "PENDING" },
      { oldName: "kalfa_event_final_v1", newName: "kalfa_event_final_v2", newStatus: null },
    ]);
  });
});

describe("DB switch plan", () => {
  const rows = [
    { message_key: "gift", name: "kalfa_event_gift_v1", components: null },
    {
      message_key: "event_day_pay",
      name: "kalfa_event_dayofpay_util_v1",
      components: {
        variants: { brit: "kalfa_brit_dayofpay_util_v1", wedding: "kalfa_wedding_dayofpay_util_v1" },
        param_contract: { brit: "event_day_pay" },
      },
    },
    {
      message_key: "invite",
      name: "kalfa_event_invite_v2",
      components: { media_variant: "kalfa_event_invite_media_v1", rsvp_quick_reply: { brit: true } },
    },
  ];
  const plans = [
    { oldName: "kalfa_event_gift_v1", newName: "kalfa_event_gift_v2", newStatus: "APPROVED" },
    { oldName: "kalfa_event_dayofpay_util_v1", newName: "kalfa_event_dayofpay_util_v2", newStatus: "APPROVED" },
    { oldName: "kalfa_brit_dayofpay_util_v1", newName: "kalfa_brit_dayofpay_util_v2", newStatus: "PENDING" },
    { oldName: "kalfa_wedding_dayofpay_util_v1", newName: "kalfa_wedding_dayofpay_util_v2", newStatus: "APPROVED" },
  ];

  it("switches only APPROVED successors — in the row name and inside the name maps — and leaves the rest", () => {
    const updates = planTemplateRowSwitch(rows, plans);
    expect(updates.map((u) => u.message_key)).toEqual(["gift", "event_day_pay"]);
    expect(updates[0].name).toBe("kalfa_event_gift_v2");
    expect(updates[1].name).toBe("kalfa_event_dayofpay_util_v2");
    expect(updates[1].components).toEqual({
      variants: { brit: "kalfa_brit_dayofpay_util_v1", wedding: "kalfa_wedding_dayofpay_util_v2" },
      param_contract: { brit: "event_day_pay" },
    });
    expect(updates[1].switched.sort()).toEqual(["kalfa_event_dayofpay_util_v1", "kalfa_wedding_dayofpay_util_v1"]);
  });

  it("referencedOldNames reports what the DB still points at", () => {
    expect(referencedOldNames(rows, plans).sort()).toEqual([
      "kalfa_brit_dayofpay_util_v1",
      "kalfa_event_dayofpay_util_v1",
      "kalfa_event_gift_v1",
      "kalfa_wedding_dayofpay_util_v1",
    ]);
  });

  it("templateSwitchSql quotes safely and writes jsonb", () => {
    const sql = templateSwitchSql({
      message_key: "it's",
      name: "x_v2",
      components: { variants: { brit: "y_v2" } },
      switched: [],
    });
    expect(sql).toBe(
      `UPDATE message_templates SET name = 'x_v2', components = '{"variants":{"brit":"y_v2"}}'::jsonb WHERE message_key = 'it''s'`,
    );
    expect(templateSwitchSql({ message_key: "k", name: "n", components: null, switched: [] })).toContain("components = NULL");
  });
});

describe("createMetaTemplate latch", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.RELOCATE_EXECUTE;
    delete process.env.RELOCATE_EXECUTE;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.RELOCATE_EXECUTE;
    else process.env.RELOCATE_EXECUTE = saved;
    vi.unstubAllGlobals();
  });

  it("refuses to POST without RELOCATE_EXECUTE=1", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      createMetaTemplate({ wabaId: "1", accessToken: "t" }, tpl("a_v2", `${NEW_ORIGIN}/g/{{1}}`)),
    ).rejects.toBeInstanceOf(RelocateExecuteLatchError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the create body with the token in the header only", async () => {
    process.env.RELOCATE_EXECUTE = "1";
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ id: "123", status: "PENDING" }) };
      }),
    );
    const res = await createMetaTemplate({ wabaId: "W", accessToken: "SECRET" }, tpl("a_v2", `${NEW_ORIGIN}/g/{{1}}`));
    expect(res.ok).toBe(true);
    expect(calls[0].url).toBe("https://graph.facebook.com/v23.0/W/message_templates");
    expect(calls[0].url).not.toContain("SECRET");
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ name: "a_v2", language: "he", category: "MARKETING", parameter_format: "POSITIONAL" });
    expect(Array.isArray(body.components)).toBe(true);
  });
});
