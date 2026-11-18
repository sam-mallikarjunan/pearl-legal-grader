import type { CloudActionProgress } from "./account/types";
import { canonicalJson } from "./account/validation";
import type { PreviewStore, SavedAssessment } from "./storage";

/** A device report and its account copy can have separately edited progress. */
export function accountProgressDiffers(
  store: PreviewStore,
  report: SavedAssessment,
  accountProgress: readonly CloudActionProgress[],
): boolean {
  if (!store.assessments.some((entry) => entry.id === report.id)) return false;
  const cloud = new Map(
    accountProgress.map((progress) => [progress.actionId, progress]),
  );
  return report.assessment.actions.some((action) => {
    const key = `${report.id}:${action.id}`;
    const saved = cloud.get(action.id);
    return (
      canonicalJson({
        state: store.actionStates[key] ?? "todo",
        details: store.actionProgress?.[key],
      }) !==
      canonicalJson({ state: saved?.state ?? "todo", details: saved?.details })
    );
  });
}

/** Return new maps. Account progress replaces device progress only after an explicit choice. */
export function mergeAccountProgress(
  store: PreviewStore,
  report: SavedAssessment,
  accountProgress: readonly CloudActionProgress[],
  useAccountProgress = false,
): Pick<PreviewStore, "actionStates" | "actionProgress"> {
  const actionStates = { ...store.actionStates };
  const actionProgress = { ...store.actionProgress };
  const cloud = new Map(
    accountProgress.map((progress) => [progress.actionId, progress]),
  );
  for (const action of report.assessment.actions) {
    const key = `${report.id}:${action.id}`;
    const hasDeviceProgress =
      actionStates[key] !== undefined || actionProgress[key] !== undefined;
    if (!useAccountProgress && hasDeviceProgress) continue;
    const saved = cloud.get(action.id);
    actionStates[key] = saved?.state ?? "todo";
    delete actionProgress[key];
    if (saved?.details) actionProgress[key] = structuredClone(saved.details);
  }
  return { actionStates, actionProgress };
}
