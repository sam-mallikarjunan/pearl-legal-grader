import { getWorkflowMetadata, RetryableError } from "workflow";
import {
  abortNurtureEmail,
  NurtureRetry,
  processNurtureEmail,
} from "../lib/server/nurture-store";
async function sendNurtureStep(id: string, lease: string) {
  "use step";
  console.info("nurture_email_step", { outboxId: id, stage: "starting" });
  try {
    const result = await processNurtureEmail(id, lease);
    console.info("nurture_email_step", { outboxId: id, stage: result.status });
    return result.status;
  } catch (error) {
    if (error instanceof NurtureRetry)
      throw new RetryableError("The educational email will retry safely.", {
        retryAfter: error.retryAfterSeconds * 1000,
      });
    throw new Error("The educational email step could not finish.");
  }
}
sendNurtureStep.maxRetries = 3;
async function abortNurtureStep(id: string, lease: string) {
  "use step";
  console.info("nurture_email_step", { outboxId: id, stage: "aborting" });
  await abortNurtureEmail(id, lease);
}
abortNurtureStep.maxRetries = 2;
/** Durable state never contains addresses, content, report answers, credentials or unsubscribe capabilities. */
export async function nurtureEmailWorkflow(id: string) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  try {
    await sendNurtureStep(id, workflowRunId);
  } catch {
    await abortNurtureStep(id, workflowRunId);
  }
}
