import { requirePlatformOwner } from '@/lib/auth/dal';
import { PageHeading } from '../_components';
import { getProcessesProbe, getSystemProbe, getDeployProbe, getHttpProbe } from '@/lib/ops/agent-client';
import { getJobHealth, getDbHealth, QUEUE_EXPECTED_MAX_MINUTES } from '@/lib/ops/db-health';
import { getAppHealthSummary } from '@/lib/ops/app-health';
import { getIntegrationsStatus } from '@/lib/ops/integrations';
import { getWebhookHealth } from '@/lib/data/admin/webhook-inbox';
import { listAllExchangeConnectionsForDebug } from '@/lib/data/exchange-connections';
import { computeOverallStatus } from '@/lib/ops/summary';
import {
  SummaryCard,
  DeployPanel,
  ProcessesPanel,
  DatabasePanel,
  JobsPanel,
  IntegrationsPanel,
  ExchangePanel,
  AppErrorsPanel,
} from './_panels';
import { AutoRefreshToggle } from './_auto-refresh-toggle';

export const metadata = { title: 'Debug Mode' };

// Force-dynamic: this page reads live process/DB/sidecar state on every
// request — it must never be statically optimized or cached.
export const dynamic = 'force-dynamic';

// Read-only diagnostics page unifying Frontend (ops_errors), Database
// (ops_job_health / ops_db_health RPCs), and Server Health (the
// kalfa-ops-agent sidecar) behind a single admin screen. Gated to the
// PLATFORM OWNER specifically — a narrower bar than the manage_settings
// permission the other diagnostic pages (webhooks/alerts/fleet) use, because
// this page surfaces raw server internals (process names, ports, file
// paths). See the approved plan for the full design and its verified
// evidence.
//
// Every data source is awaited via Promise.allSettled and rendered
// independently — a dead sidecar or a failed query degrades its own panel
// only, never the whole page (see _panels.tsx's UnavailableAlert).
export default async function DebugPage() {
  await requirePlatformOwner();

  const [
    processesR,
    systemR,
    deployR,
    httpR,
    jobHealthR,
    dbHealthR,
    appHealthR,
    webhookHealthR,
    exchangeConnsR,
  ] = await Promise.allSettled([
    getProcessesProbe(),
    getSystemProbe(),
    getDeployProbe(),
    getHttpProbe(),
    getJobHealth(),
    getDbHealth(),
    getAppHealthSummary(),
    getWebhookHealth().catch(() => null),
    listAllExchangeConnectionsForDebug(),
  ]);

  const processes = processesR.status === 'fulfilled' ? processesR.value : null;
  const system = systemR.status === 'fulfilled' ? systemR.value : null;
  const deploy = deployR.status === 'fulfilled' ? deployR.value : null;
  const http = httpR.status === 'fulfilled' ? httpR.value : null;

  const jobHealthResult = jobHealthR.status === 'fulfilled' ? jobHealthR.value : null;
  const jobHealth = jobHealthResult?.ok ? jobHealthResult.data : null;
  const jobHealthReason = jobHealthResult && !jobHealthResult.ok ? jobHealthResult.reason : null;

  const dbHealthResult = dbHealthR.status === 'fulfilled' ? dbHealthR.value : null;
  const dbHealth = dbHealthResult?.ok ? dbHealthResult.data : null;
  const dbHealthReason = dbHealthResult && !dbHealthResult.ok ? dbHealthResult.reason : null;

  const appHealth = appHealthR.status === 'fulfilled' ? appHealthR.value : null;
  const webhookHealth = webhookHealthR.status === 'fulfilled' ? webhookHealthR.value : null;

  const exchangeConnections = exchangeConnsR.status === 'fulfilled' ? exchangeConnsR.value : null;
  const exchangeReason =
    exchangeConnsR.status === 'rejected'
      ? exchangeConnsR.reason instanceof Error
        ? exchangeConnsR.reason.message
        : 'שגיאה לא ידועה'
      : null;

  // Integrations composes from jobHealth (already fetched above) but needs
  // its own config-presence reads — never a live provider call (see
  // integrations.ts header). Runs after the settle above so it can reuse
  // jobHealth without a second RPC round trip when available.
  let integrations: Awaited<ReturnType<typeof getIntegrationsStatus>> | null = null;
  let integrationsReason: string | null = null;
  try {
    integrations = await getIntegrationsStatus(jobHealth ?? []);
  } catch (err) {
    integrationsReason = err instanceof Error ? err.message : 'שגיאה לא ידועה';
  }

  const overall = computeOverallStatus({
    processes,
    system,
    jobHealth,
    dbHealth,
    errorCountLast1h: appHealth?.errorCounts.last1h ?? null,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <PageHeading>Debug Mode</PageHeading>
        <AutoRefreshToggle />
      </div>

      <SummaryCard status={overall} />

      <DeployPanel result={deploy} />

      <ProcessesPanel processes={processes} system={system} http={http} />

      <DatabasePanel result={dbHealth} reason={dbHealthReason} />

      <JobsPanel
        jobHealth={jobHealth}
        reason={jobHealthReason}
        expectedMinutes={QUEUE_EXPECTED_MAX_MINUTES}
        webhookUnprocessed={webhookHealth?.unprocessedCount ?? null}
      />

      {appHealth && <AppErrorsPanel counts={appHealth.errorCounts} recent={appHealth.recentErrors} />}

      <IntegrationsPanel items={integrations} reason={integrationsReason} />

      <ExchangePanel connections={exchangeConnections} reason={exchangeReason} />
    </div>
  );
}
