import { getWorkflowMetadata, RetryableError } from "workflow";
import {
  abortReportEmail,
  processReportEmail,
  ReportEmailRetry,
} from "../lib/server/report-email";

async function sendReportEmailStep(outboxId: string, leaseId: string) {
  "use step";
  console.info("report_email_step", { outboxId, stage: "starting" });
  try {
    const result = await processReportEmail(outboxId, leaseId);
    console.info("report_email_step", { outboxId, stage: result.status });
    return result.status;
  } catch (error) {
    if (error instanceof ReportEmailRetry)
      throw new RetryableError(
        "The report-email request will be retried safely.",
        { retryAfter: error.retryAfterSeconds * 1000 },
      );
    throw new Error("The report-email step could not finish.");
  }
}
sendReportEmailStep.maxRetries = 3;
async function abortReportEmailStep(outboxId: string, leaseId: string) {
  "use step";
  await abortReportEmail(outboxId, leaseId);
}
abortReportEmailStep.maxRetries = 2;
/** Durable arguments and results contain opaque IDs and safe statuses only. */
export async function reportEmailWorkflow(outboxId: string) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  try {
    await sendReportEmailStep(outboxId, workflowRunId);
  } catch {
    await abortReportEmailStep(outboxId, workflowRunId);
  }
}
