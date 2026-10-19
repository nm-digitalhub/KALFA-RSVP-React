import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT = fileURLToPath(
  new URL(
    '../src/lib/auth/platform-permission-keys.generated.ts',
    import.meta.url,
  ),
);

const CHECK = process.argv.includes('--check');

const SQL = `
  SELECT COALESCE(
    json_agg(key ORDER BY key),
    '[]'::json
  )::text
  FROM public.platform_permission_definitions;
`;

function readPermissionKeys() {
  const output = execFileSync(
    'psql',
    [
      '-X',
      '-w',
      '-A',
      '-t',
      '-v', 'ON_ERROR_STOP=1',
      '-h', '127.0.0.1',
      '-p', '54322',
      '-U', 'postgres',
      '-d', 'postgres',
      '-c', SQL,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PGPASSWORD:
          process.env.LOCAL_SUPABASE_DB_PASSWORD ?? 'postgres',
        PGSSLMODE: 'disable',
        PGOPTIONS: [
          process.env.PGOPTIONS,
          '-c default_transaction_read_only=on',
        ].filter(Boolean).join(' '),
      },
    },
  );

  const keys = JSON.parse(output.trim());

  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('Permission catalogue is empty or invalid');
  }

  if (!keys.every(
    key =>
      typeof key === 'string' &&
      /^[a-z][a-z0-9_.]*$/.test(key),
  )) {
    throw new Error('Invalid permission key in database');
  }

  if (new Set(keys).size !== keys.length) {
    throw new Error('Duplicate permission keys');
  }

  return keys;
}

function generateSource(keys) {
  return [
    '// AUTO-GENERATED FILE. DO NOT EDIT.',
    '// Source: public.platform_permission_definitions',
    '// Generate: npm run gen:permissions',
    '// Verify: npm run check:permissions:generated',
    '',
    'export const PLATFORM_PERMISSION_KEYS = [',
    ...keys.map(key => `  ${JSON.stringify(key)},`),
    '] as const;',
    '',
    'export type PlatformPermissionKey =',
    '  (typeof PLATFORM_PERMISSION_KEYS)[number];',
    '',
    'const permissionKeySet: ReadonlySet<string> =',
    '  new Set(PLATFORM_PERMISSION_KEYS);',
    '',
    'export function isPlatformPermissionKey(',
    '  value: string,',
    '): value is PlatformPermissionKey {',
    '  return permissionKeySet.has(value);',
    '}',
    '',
  ].join('\n');
}

const keys = readPermissionKeys();
const source = generateSource(keys);

if (CHECK) {
  if (
    !existsSync(OUTPUT) ||
    readFileSync(OUTPUT, 'utf8') !== source
  ) {
    console.error(
      'Permission keys are out of sync with local Supabase.',
    );
    process.exit(1);
  }

  console.log(`Verified ${keys.length} permission keys.`);
} else {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, source, 'utf8');

  console.log(`Generated ${keys.length} permission keys.`);
  console.log(OUTPUT);
}
