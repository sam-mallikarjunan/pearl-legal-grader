import { createHmac } from "node:crypto";
import {
  accountRecord,
  accountUuid,
  AccountDataError,
} from "../account/validation";
import {
  calibrationDataset,
  calibrationSummary,
  parseCalibrationWeights,
  type CalibrationSource,
  type CalibrationWeights,
} from "../calibration";
import { accountRpc } from "./account-db";
import { getActiveConfig } from "./config-store";

if (typeof window !== "undefined")
  throw new Error("Calibration source records must remain on the server.");
export class CalibrationUnavailable extends Error {
  readonly code = "calibration_unavailable";
  readonly status = 503;
  constructor() {
    super(
      "Calibration evidence is temporarily unavailable. Existing grades and configuration are unchanged.",
    );
    this.name = "CalibrationUnavailable";
  }
}
interface CalibrationDependencies {
  rpc: typeof accountRpc;
  activeConfig: typeof getActiveConfig;
  pseudonym: (id: string) => string;
  now?: () => Date;
}
export function calibrationWorkspaceKey(id: string): string {
  const secret = process.env.SCAN_HASH_SECRET;
  if (!accountUuid(id) || !secret || secret.length < 32)
    throw new CalibrationUnavailable();
  return createHmac("sha256", secret)
    .update(`grader-outcome-calibration:v1:${id}`)
    .digest("hex");
}
export function parseCalibrationExperiment(body: unknown): {
  expectedReleaseId: string;
  weights: CalibrationWeights;
} {
  if (
    !accountRecord(body) ||
    Object.keys(body).length !== 2 ||
    typeof body.expectedReleaseId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(body.expectedReleaseId)
  )
    throw new AccountDataError(
      "invalid_calibration_experiment",
      "Choose the current release and six finite module weights. This comparison never publishes a scoring change.",
    );
  const weights = parseCalibrationWeights(body.weights);
  if (!weights)
    throw new AccountDataError(
      "invalid_calibration_weights",
      "Provide all six module weights between 0.1 and 100; unsupported fields are not accepted.",
    );
  return { expectedReleaseId: body.expectedReleaseId, weights };
}
export function createCalibrationStore(d: CalibrationDependencies) {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    try {
      return await d.rpc(name, args);
    } catch (error) {
      if (accountRecord(error) && error.code === "calibration_release_changed")
        throw new AccountDataError(
          "calibration_release_changed",
          "The scoring release changed. Refresh to use a consistent version.",
          409,
        );
      throw new CalibrationUnavailable();
    }
  };
  return {
    async summary(experiment?: {
      expectedReleaseId: string;
      weights: CalibrationWeights;
    }) {
      const active = await d.activeConfig();
      if (experiment && experiment.expectedReleaseId !== active.release.id)
        throw new AccountDataError(
          "calibration_release_changed",
          "The scoring release changed. Refresh before comparing a candidate.",
          409,
        );
      const candidates: CalibrationSource[] = [];
      let after: string | null = null,
        truncated = false;
      for (let page = 0; page < 100; page++) {
        const rows = await rpc("grader_outcome_research_source_page", {
          p_release_id: active.release.id,
          p_after: after,
          p_limit: 2,
        });
        if (!Array.isArray(rows) || rows.length > 2)
          throw new CalibrationUnavailable();
        for (const row of rows) {
          if (
            !accountRecord(row) ||
            !accountUuid(row.workspaceId) ||
            row.benchmarking !== true ||
            row.outcomeResearch !== true ||
            !Array.isArray(row.periods) ||
            row.periods.length > 24 ||
            !Array.isArray(row.baselines) ||
            row.baselines.length > 24 ||
            row.baselines.some(
              (b) =>
                !accountRecord(b) ||
                !accountUuid(b.id) ||
                typeof b.savedAt !== "string" ||
                !Number.isFinite(Date.parse(b.savedAt)) ||
                !accountRecord(b.report),
            )
          )
            throw new CalibrationUnavailable();
          if (after && row.workspaceId <= after)
            throw new CalibrationUnavailable();
          candidates.push(row as unknown as CalibrationSource);
          after = row.workspaceId;
        }
        if (rows.length < 2) break;
        if (page === 99) truncated = true;
      }
      let permitted = new Set<string>();
      if (candidates.length) {
        const current = await rpc("grader_outcome_research_current_consent", {
          p_workspace_ids: candidates.map((c) => c.workspaceId),
        });
        if (
          !Array.isArray(current) ||
          current.length > candidates.length ||
          current.some((id) => !accountUuid(id)) ||
          new Set(current).size !== current.length ||
          current.some(
            (id) =>
              !candidates.some((candidate) => candidate.workspaceId === id),
          )
        )
          throw new CalibrationUnavailable();
        permitted = new Set(current);
      }
      const latest = await d.activeConfig();
      if (
        latest.release.id !== active.release.id ||
        latest.contentHash !== active.contentHash
      )
        throw new AccountDataError(
          "calibration_release_changed",
          "The scoring release changed during analysis. Refresh to use one consistent release.",
          409,
        );
      const projected = calibrationDataset(
        candidates.filter((c) => permitted.has(c.workspaceId)),
        active.release,
        d.pseudonym,
        d.now?.() ?? new Date(),
        truncated,
      );
      return calibrationSummary(projected, active.release, experiment?.weights);
    },
  };
}
export const calibrationStore = () =>
  createCalibrationStore({
    rpc: accountRpc,
    activeConfig: getActiveConfig,
    pseudonym: calibrationWorkspaceKey,
  });
