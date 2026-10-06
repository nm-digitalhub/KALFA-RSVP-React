import 'server-only';

import { WhatsAppClient } from '@kapso/whatsapp-cloud-api';

import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

export function createWhatsAppManagementClient(accessToken: string) {
  const normalizedAccessToken = accessToken.trim();
  if (!normalizedAccessToken) {
    throw new Error('WhatsApp access token is required');
  }

  return new WhatsAppClient({
    accessToken: normalizedAccessToken,
    graphVersion: GRAPH_API_VERSION,
  });
}
