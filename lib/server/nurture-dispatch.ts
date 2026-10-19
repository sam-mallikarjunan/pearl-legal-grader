import { start } from "workflow/api";
import { nurtureEmailWorkflow } from "../../workflows/nurture";
import {
  recordNurtureWorkflow,
  releaseNurtureDispatch,
  reserveNurtureBatch,
} from "./nurture-store";
/** Both scheduler and explicit operator retries share the same atomic, capped due-work reservation. */
export async function dispatchDueNurture() {
  const ids = await reserveNurtureBatch();
  let queued = 0,
    deferred = 0;
  for (const id of ids) {
    try {
      const run = await start(nurtureEmailWorkflow, [id]);
      await recordNurtureWorkflow(id, run.runId).catch(() => {});
      queued++;
    } catch {
      await releaseNurtureDispatch(id).catch(() => {});
      deferred++;
    }
  }
  return { queued, deferred, maxBatch: 20 };
}
