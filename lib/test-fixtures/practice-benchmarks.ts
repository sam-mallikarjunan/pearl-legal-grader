import { createHash } from "node:crypto";
import { DEFAULT_RELEASE } from "../catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "../demo";
import { assessPractice } from "../scoring";
import type { CalibrationSource } from "../calibration";
import type { PracticeBenchmarkObservation } from "../practice-benchmarks";
import { PRACTICE_MAPPING_VERSION } from "../practice-benchmark-types";
import { DOMAIN_IDS } from "../types";
export const PRACTICE_FIXTURE_NOW = new Date("2026-10-19T12:00:00.000Z");
export const practiceFixtureUuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const practiceFixtureKey = (id: string) =>
  createHash("sha256").update(id).digest("hex");
export function practiceSourceFixture(n = 1): CalibrationSource {
  return {
    workspaceId: practiceFixtureUuid(n),
    benchmarking: true,
    outcomeResearch: true,
    plans: [],
    periods: [
      {
        id: practiceFixtureUuid(1000 + n),
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        source: "self_reported",
        currency: "USD",
        baselineReportId: practiceFixtureUuid(2000 + n),
        inquiries: 100,
        contacted: 80,
        booked: 50,
        attended: 30,
        clients: 20,
        leadSpendMinor: null,
        cohortBilledMinor: 10000,
        cohortCollectedMinor: 8000,
        adminHours: 60,
      },
    ],
    baselines: [
      {
        id: practiceFixtureUuid(2000 + n),
        savedAt: "2026-08-31T12:30:00.000Z",
        contentHash: "a".repeat(64),
        report: {
          id: practiceFixtureUuid(3000 + n),
          practiceId: practiceFixtureUuid(4000 + n),
          createdAt: "2026-08-31T12:00:00.000Z",
          label: "PRIVATE OWNER LABEL",
          isSample: false,
          assessment: structuredClone(
            assessPractice({
              context: {
                ...SAMPLE_CONTEXT,
                practiceArea: "Family law",
                jurisdiction: "PRIVATE LOCATION",
              },
              answers: SAMPLE_ANSWERS,
              controls: SAMPLE_CONTROLS,
              release: DEFAULT_RELEASE,
            }),
          ),
        },
      },
    ],
  };
}
export function practiceObservationFixtures(
  n: number,
): PracticeBenchmarkObservation[] {
  return Array.from({ length: n }, (_, i) => ({
    workspaceKey: practiceFixtureKey(practiceFixtureUuid(i + 1)),
    releaseId: DEFAULT_RELEASE.id,
    mappingVersion: PRACTICE_MAPPING_VERSION,
    group: "family",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    provenance: "retrospective",
    currency: "USD",
    source: "self_reported",
    stage: "established",
    feeModel: "hourly",
    score: i % 3 === 0 ? 40 : i % 3 === 1 ? 70 : 90,
    domains: DOMAIN_IDS.map((id) => ({ id, score: 70 })),
    outcomes: {
      inquiry_client_fraction: 0.23,
      billed_collection_fraction: 0.78,
      owner_admin_hours_day: 2.2,
    },
  }));
}
