import { getWorkflowMetadata } from "workflow";
import { inspectWebsite } from "../lib/server/website-inspect";
import { runSandboxLighthouse } from "../lib/server/lighthouse";
import { runMobilePerformance } from "../lib/server/pagespeed";
import {
  claimScan,
  completeScan,
  failScan,
  updateScanProgress,
} from "../lib/server/scan-store";

async function inspectScanStep(scanId: string, leaseId: string) {
  "use step";
  const claim = await claimScan(scanId, leaseId);
  if (!claim) return;
  const result = await inspectWebsite(
    claim.url,
    async (progress) => {
      await updateScanProgress(scanId, leaseId, progress.stage);
    },
    {
      performanceProvider: process.env.PAGESPEED_API_KEY
        ? runMobilePerformance
        : runSandboxLighthouse,
    },
  );
  await completeScan(scanId, leaseId, result);
}
inspectScanStep.maxRetries = 1;

async function failScanStep(scanId: string, leaseId: string) {
  "use step";
  await failScan(
    scanId,
    leaseId,
    "The website check could not finish. No failing grade was assigned. Please try again later.",
  );
}
failScanStep.maxRetries = 2;

/** Only opaque IDs enter durable run input; browser capability tokens never do. */
export async function websiteScanWorkflow(scanId: string) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  try {
    await inspectScanStep(scanId, workflowRunId);
  } catch {
    await failScanStep(scanId, workflowRunId);
  }
}
