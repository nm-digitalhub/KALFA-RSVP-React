// Hand-maintained override layer over the generated Supabase types.
//
// `./types.generated.ts` is pure generator output (`npm run gen:types`) and is
// never edited. This module is what the application imports: it deep-merges
// corrections the generator cannot express onto the generated `Database`, then
// re-exports the same helper surface (`Json`, `Tables`, `TablesInsert`,
// `TablesUpdate`, `Enums`, `CompositeTypes`, `Constants`) — so importers are
// unchanged and the pattern follows the official docs
// (https://supabase.com/docs/guides/api/rest/generating-types → "Helper types
// for tables and joins": database-generated.types.ts + MergeDeep override).
//
// What is overridden and why — every entry below was verified against the LIVE
// pg_proc source (2026-08-25), not inferred:
//
// Postgres cannot declare a function argument NOT NULL, so `supabase gen types`
// types every argument WITHOUT a default as required non-null `string`. The
// three RPCs below deliberately accept NULL for specific arguments (their
// bodies branch on `is null` / `IS NOT DISTINCT FROM` / `coalesce`), and the
// callers pass null on purpose. Before this layer each call site carried an
// `as string` cast that silenced the compiler — the override restores the true
// contract so a caller passing `undefined` (a genuine bug: PostgREST would drop
// the key and the RPC would fail on a missing argument) is still rejected.
//
// Adding an override: confirm against `pg_get_functiondef()` on the linked DB
// first, add the narrowest possible entry, and document the SQL evidence here.
// Regenerating (`npm run gen:types`) never touches this file; `npm run
// types:check` compares only the generated file.

import type { MergeDeep } from 'type-fest';
import type { Database as DatabaseGenerated } from './types.generated';

export type { Json } from './types.generated';
export { Constants } from './types.generated';

export type Database = MergeDeep<
  DatabaseGenerated,
  {
    public: {
      Functions: {
        // p_next_wake_at timestamptz, no default; body: `if p_next_wake_at is not null`.
        fleet_goal_progress: { Args: { p_next_wake_at: string | null } };
        // CAS params compared with `IS NOT DISTINCT FROM` — NULL means "expect no plan yet".
        record_step_plan: {
          Args: { p_expected_plan_rev: string | null; p_expected_planned_at: string | null };
        };
        // p_job_id: `is null` / `is not null` branches; p_terminal_status: `coalesce(p_terminal_status, …)`.
        resolve_outreach_step: { Args: { p_job_id: string | null; p_terminal_status: string | null } };
      };
    };
  }
>;

// ── Helper types ─────────────────────────────────────────────────────────────
// Copied verbatim from the generator's trailer (types.generated.ts, after the
// `Database` type) so they resolve against the MERGED `Database` above rather
// than the raw one. If a future generator version changes this block, re-copy
// it here — `npx tsc --noEmit` flags any incompatibility.

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

