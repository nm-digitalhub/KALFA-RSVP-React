import 'server-only';

import { PACKAGE_ACTIVATION_RETRY, packageActivationJobId, QUEUES, type PackageActivationJob } from '@/lib/queue/queues';
import { getWebJobSender } from '@/lib/queue/web-sender';

// Queue the start of a paid package (design D23), right after its payment is recorded as succeeded. The job id is
// derived from the payment, so the same payment reported twice (the buyer's browser and CardCom's webhook) queues one
// job; pg-boss ignores a send whose id already exists.
//
// Never throws: the payment is already recorded and nothing here may affect it. A failure is logged with ids only; the
// payment orphan sweep finds a paid campaign that is still waiting and queues it again.
export async function enqueuePackageActivation(job: PackageActivationJob): Promise<boolean> {
  try {
    const boss = await getWebJobSender();
    await boss.send(QUEUES.packageActivation, job, { id: packageActivationJobId(job.operationId), ...PACKAGE_ACTIVATION_RETRY });
    return true;
  } catch (err) {
    console.error('[package-activation] could not queue the start of a paid package (the sweep will retry)', {
      campaignId: job.campaignId,
      operationId: job.operationId,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
