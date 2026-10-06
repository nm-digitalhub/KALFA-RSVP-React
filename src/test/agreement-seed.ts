// The package contract is seeded by a migration as a token-form HTML body. Tests read it from the SQL the owner applied,
// so what they check is the real seed and not a copy of it.
//
// Read with Vite's `?raw`, not `node:fs`: this module is imported by jsdom suites too, where a Node built-in cannot be
// loaded ("No such built-in module: node:" failed two suites in the nightly QA run). The migration is already applied
// and immutable, so naming its file here is stable.
import sql from '../../supabase/migrations/20261004153521_agreement_documents_model.sql?raw';

export const AGREEMENT_MODEL_MIGRATION_FILE = '20261004153521_agreement_documents_model.sql';
export const AGREEMENT_MODEL_SQL: string = sql;
export const PACKAGE_SEED_BODY =
  /\$agreement_body\$([\s\S]*?)\$agreement_body\$/.exec(AGREEMENT_MODEL_SQL)?.[1] ?? '';
