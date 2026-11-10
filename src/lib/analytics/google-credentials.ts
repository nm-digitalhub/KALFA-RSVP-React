import 'server-only';

import { constants } from 'node:fs';
import { access } from 'node:fs/promises';

// The ADC credentials check the GA4 and Search Console config gates share.
// Presence of the env var is not proof the file can be read, so the file is
// actually opened for reading. The path and the file contents are NEVER logged,
// thrown, or returned — callers only ever see the issue code (null = usable).
export async function googleCredentialsIssue(): Promise<
  'missing_credentials_path' | 'credentials_unreadable' | null
> {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!credentialsPath) return 'missing_credentials_path';
  try {
    await access(credentialsPath, constants.R_OK);
  } catch {
    return 'credentials_unreadable';
  }
  return null;
}
