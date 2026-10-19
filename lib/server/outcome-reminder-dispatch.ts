import { start } from "workflow/api";
import { outcomeReminderWorkflow } from "../../workflows/outcome-reminder";
import {
  reserveDueOutcomeReminders,
  releaseOutcomeReminderDispatch,
} from "./outcome-reminder-store";
export async function startOutcomeReminder(id: string) {
  try {
    await start(outcomeReminderWorkflow, [id]);
    return true;
  } catch {
    await releaseOutcomeReminderDispatch(id).catch(() => {});
    return false;
  }
}
export async function dispatchOutcomeReminders() {
  const ids = await reserveDueOutcomeReminders();
  let queued = 0;
  for (const id of ids) if (await startOutcomeReminder(id)) queued++;
  return { queued, deferred: ids.length - queued, maxBatch: 10 };
}
