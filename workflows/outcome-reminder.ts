import { getWorkflowMetadata, RetryableError } from "workflow";
import {
  abortOutcomeReminder,
  processOutcomeReminder,
  ReportingReminderRetry,
} from "../lib/server/outcome-reminder-store";
async function sendStep(id: string, lease: string) {
  "use step";
  console.info("outcome_reminder_step", { outboxId: id, stage: "starting" });
  try {
    const v = await processOutcomeReminder(id, lease);
    console.info("outcome_reminder_step", { outboxId: id, stage: v.status });
    return v.status;
  } catch (e) {
    if (e instanceof ReportingReminderRetry)
      throw new RetryableError(
        "The same reporting reminder will retry safely.",
        { retryAfter: e.retryAfterSeconds * 1000 },
      );
    throw new Error("Reporting reminder step could not finish.");
  }
}
sendStep.maxRetries = 3;
async function abortStep(id: string, lease: string) {
  "use step";
  console.info("outcome_reminder_step", { outboxId: id, stage: "aborting" });
  await abortOutcomeReminder(id, lease);
}
abortStep.maxRetries = 2;
export async function outcomeReminderWorkflow(id: string) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  try {
    await sendStep(id, workflowRunId);
  } catch {
    await abortStep(id, workflowRunId);
  }
}
