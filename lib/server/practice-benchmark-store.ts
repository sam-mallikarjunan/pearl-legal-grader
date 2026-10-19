import { createHmac } from "node:crypto";
import { accountRecord, accountUuid } from "../account/validation";
import { type CalibrationSource } from "../calibration";
import {
  practiceBenchmarkDataset,
  practiceBenchmarkSummary,
} from "../practice-benchmarks";
import {
  PRACTICE_BENCHMARK_MINIMUM,
  PRACTICE_MAPPING_RELEASES,
} from "../practice-benchmark-types";
import { accountRpc } from "./account-db";
import { configurationHash, getActiveConfig } from "./config-store";
import { researchStore } from "./research-store";
if (typeof window !== "undefined")
  throw new Error("Practice benchmark source data is server-only.");
export class PracticeBenchmarksUnavailable extends Error {
  constructor() {
    super("Practice comparisons are temporarily unavailable.");
    this.name = "PracticeBenchmarksUnavailable";
  }
}
interface Dependencies {
  rpc: typeof accountRpc;
  activeConfig: typeof getActiveConfig;
  counts: () => Promise<{ benchmarkingConsent: number }>;
  pseudonym: (id: string) => string;
  now?: () => Date;
}
function workspaceKey(id: string) {
  const secret = process.env.SCAN_HASH_SECRET;
  if (!accountUuid(id) || !secret || secret.length < 32)
    throw new PracticeBenchmarksUnavailable();
  return createHmac("sha256", secret)
    .update(`grader-practice-benchmarks:v1:${id}`)
    .digest("hex");
}
/** Uses existing service-only dual-consent RPC authority. No new persistence, scope or permission. */
export function createPracticeBenchmarkStore(d: Dependencies) {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    try {
      const value = await d.rpc(name, args);
      if (accountRecord(value) && typeof value.error === "string")
        throw new PracticeBenchmarksUnavailable();
      return value;
    } catch {
      throw new PracticeBenchmarksUnavailable();
    }
  };
  return {
    async summary() {
      const active = await d.activeConfig(),
        now = d.now?.() ?? new Date();
      if (
        !active.available ||
        active.release.status !== "approved" ||
        configurationHash(active.release) !== active.contentHash
      )
        throw new PracticeBenchmarksUnavailable();
      if (!PRACTICE_MAPPING_RELEASES.includes(active.release.id))
        return practiceBenchmarkSummary(
          { observations: [], incomplete: false },
          active.release.id,
          now,
        );
      // Private upper bound only; never publish consent counts or treat them as eligible observations.
      const counts = await d.counts();
      if (
        !Number.isSafeInteger(counts.benchmarkingConsent) ||
        counts.benchmarkingConsent < 0
      )
        throw new PracticeBenchmarksUnavailable();
      if (counts.benchmarkingConsent < PRACTICE_BENCHMARK_MINIMUM)
        return practiceBenchmarkSummary(
          { observations: [], incomplete: false },
          active.release.id,
          now,
        );
      const candidates: CalibrationSource[] = [];
      let after: string | null = null,
        incomplete = false;
      for (let page = 0; page < 100; page++) {
        const rows = await rpc("grader_outcome_research_source_page", {
          p_release_id: active.release.id,
          p_after: after,
          p_limit: 2,
        });
        if (!Array.isArray(rows) || rows.length > 2)
          throw new PracticeBenchmarksUnavailable();
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
            !Array.isArray(row.plans) ||
            row.plans.length > 36 ||
            row.baselines.some(
              (b) =>
                !accountRecord(b) ||
                !accountUuid(b.id) ||
                typeof b.savedAt !== "string" ||
                !Number.isFinite(Date.parse(b.savedAt)) ||
                !accountRecord(b.report),
            ) ||
            (after !== null && row.workspaceId <= after)
          )
            throw new PracticeBenchmarksUnavailable();
          candidates.push(row as unknown as CalibrationSource);
          after = row.workspaceId;
        }
        if (rows.length < 2) break;
        if (page === 99) incomplete = true;
      }
      // An incomplete extract is never a convenience sample, even when an early page crosses a threshold.
      if (incomplete)
        return practiceBenchmarkSummary(
          { observations: [], incomplete: true },
          active.release.id,
          now,
        );
      const allowed = new Set<string>();
      if (candidates.length) {
        const current = await rpc("grader_outcome_research_current_consent", {
          p_workspace_ids: candidates.map((c) => c.workspaceId),
        });
        const ids = new Set(candidates.map((c) => c.workspaceId));
        if (
          !Array.isArray(current) ||
          current.length > candidates.length ||
          new Set(current).size !== current.length ||
          current.some((id) => !accountUuid(id) || !ids.has(id))
        )
          throw new PracticeBenchmarksUnavailable();
        for (const id of current) allowed.add(id);
      }
      const latest = await d.activeConfig();
      if (
        !latest.available ||
        latest.release.status !== "approved" ||
        latest.release.id !== active.release.id ||
        latest.contentHash !== active.contentHash ||
        configurationHash(latest.release) !== latest.contentHash
      )
        throw new PracticeBenchmarksUnavailable();
      return practiceBenchmarkSummary(
        practiceBenchmarkDataset(
          candidates.filter((c) => allowed.has(c.workspaceId)),
          active.release,
          d.pseudonym,
          now,
        ),
        active.release.id,
        now,
      );
    },
  };
}
export const practiceBenchmarkStore = () =>
  createPracticeBenchmarkStore({
    rpc: accountRpc,
    activeConfig: getActiveConfig,
    counts: () => researchStore().counts(),
    pseudonym: workspaceKey,
  });
