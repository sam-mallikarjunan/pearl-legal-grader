import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "./catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "./demo";
import { assessPractice } from "./scoring";
import {
  csvCell,
  projectResearchCandidate,
  researchCsv,
  researchDataset,
  researchSummary,
  type ResearchCandidate,
} from "./research";
import {
  HELP_CONSENT_TEXT,
  HELP_CONSENT_VERSION,
  parseHelpInput,
} from "./help-requests";
import type { SavedAssessment } from "./storage";
const now = new Date("2026-10-16T16:00:00.000Z");
const workspace = "84ec0e52-f2ee-42a2-8432-a3520a9e7f77";
function candidate(patch: Partial<SavedAssessment> = {}): ResearchCandidate {
  const assessment = assessPractice({
    context: {
      ...SAMPLE_CONTEXT,
      practiceArea: "Sensitive named practice",
      jurisdiction: "Private location",
      websiteUrl: "https://private-firm.example",
    },
    answers: SAMPLE_ANSWERS,
    controls: SAMPLE_CONTROLS,
    release: DEFAULT_RELEASE,
  });
  return {
    workspaceId: workspace,
    benchmarking: true,
    report: {
      id: "83e88d9a-bb19-4287-bd36-760f083a7059",
      practiceId: "884ee9da-6654-44b0-910e-c937bfb6c264",
      createdAt: "2026-10-16T12:00:00.000Z",
      label: "Private owner name",
      isSample: false,
      assessment: structuredClone(assessment),
      ...patch,
    },
    progress: [],
  };
}
const pseudonym = (_id: string) => "hmac-pseudonym";
test("research derives a minimized row from canonical observations, omitting private fields", () => {
  const result = projectResearchCandidate(
    candidate(),
    DEFAULT_RELEASE,
    pseudonym,
    now,
  );
  assert.equal(result.eligible, true);
  if (!result.eligible) return;
  assert.equal(result.row.assessmentMonth, "2026-10");
  assert.equal(result.row.workspacePseudonym, "hmac-pseudonym");
  const encoded = JSON.stringify(result.row);
  for (const forbidden of [
    workspace,
    "private-firm",
    "Private owner",
    "Sensitive named",
    "Private location",
    "answersSnapshot",
    "controlsSnapshot",
    "deadline",
    "mfa",
    "websiteUrl",
  ])
    assert.equal(encoded.includes(forbidden), false);
});
test("withdrawn research permission, samples, stale reports and unpublished local releases are excluded", () => {
  const withdrawn = candidate();
  withdrawn.benchmarking = false;
  assert.deepEqual(
    projectResearchCandidate(withdrawn, DEFAULT_RELEASE, pseudonym, now),
    { eligible: false, reason: "no_consent" },
  );
  assert.deepEqual(
    projectResearchCandidate(
      candidate({ isSample: true }),
      DEFAULT_RELEASE,
      pseudonym,
      now,
    ),
    { eligible: false, reason: "sample" },
  );
  assert.deepEqual(
    projectResearchCandidate(
      candidate({ createdAt: "2026-01-01T12:00:00.000Z" }),
      DEFAULT_RELEASE,
      pseudonym,
      now,
    ),
    { eligible: false, reason: "stale" },
  );
  const local = candidate();
  (local.report as SavedAssessment).assessment.releaseId =
    "preview-local-custom";
  assert.deepEqual(
    projectResearchCandidate(local, DEFAULT_RELEASE, pseudonym, now),
    { eligible: false, reason: "different_release" },
  );
});
test("a fresh upload cannot refresh an old assessment and tampered supplied scores cannot enter research", () => {
  const forged = candidate();
  (forged.report as SavedAssessment).assessment.overallScore = 100;
  assert.deepEqual(
    projectResearchCandidate(forged, DEFAULT_RELEASE, pseudonym, now),
    { eligible: false, reason: "invalid" },
  );
  const incomplete = candidate();
  const report = incomplete.report as SavedAssessment;
  report.assessment = assessPractice({
    context: SAMPLE_CONTEXT,
    answers: {},
    controls: {},
    release: DEFAULT_RELEASE,
  });
  assert.deepEqual(
    projectResearchCandidate(incomplete, DEFAULT_RELEASE, pseudonym, now),
    { eligible: false, reason: "insufficient_evidence" },
  );
});
test("repeated reports count as one workspace and retain the latest eligible observation", () => {
  const first = candidate({ createdAt: "2026-09-16T12:00:00.000Z" });
  const latest = candidate();
  const data = researchDataset(
    [latest, first, latest],
    DEFAULT_RELEASE,
    pseudonym,
    now,
  );
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].assessmentMonth, "2026-10");
});
test("owner-reported outcomes remain separate from grade and count only valid actions and dates", () => {
  const value = candidate();
  const report = value.report as SavedAssessment;
  const id = report.assessment.actions[0].id;
  value.progress = [
    {
      actionId: id,
      details: {
        updatedAt: "2026-10-16T14:00:00.000Z",
        outcome: { status: "improved", recordedAt: "2026-10-16T14:00:00.000Z" },
      },
    },
    {
      actionId: id,
      details: {
        updatedAt: "2026-10-16T14:00:00.000Z",
        outcome: { status: "improved", recordedAt: "2026-10-16T14:00:00.000Z" },
      },
    },
    {
      actionId: "private-unapproved-action",
      details: {
        updatedAt: "2026-10-16T14:00:00.000Z",
        outcome: { status: "worse", recordedAt: "2026-10-16T14:00:00.000Z" },
      },
    },
  ];
  const result = projectResearchCandidate(
    value,
    DEFAULT_RELEASE,
    pseudonym,
    now,
  );
  assert.equal(result.eligible, true);
  if (!result.eligible) return;
  assert.deepEqual(result.row.reportedOutcomes, {
    improved: 1,
    no_change: 0,
    worse: 0,
    unsure: 0,
  });
});
test("descriptive statistics suppress cells below 30 workspaces and all truncated extracts", () => {
  const row = researchDataset([candidate()], DEFAULT_RELEASE, pseudonym, now)
    .rows[0];
  const rows = Array.from({ length: 30 }, (_, i) => ({
    ...row,
    workspacePseudonym: `workspace-${i}`,
  }));
  assert.equal(researchSummary(rows.slice(0, 29)).overall.status, "suppressed");
  assert.equal(researchSummary(rows).overall.status, "descriptive");
  assert.equal(researchSummary(rows, true).overall.status, "suppressed");
  assert.equal(
    researchSummary(Array(30).fill(row)).overall.status,
    "suppressed",
  );
  assert.equal(
    researchSummary(
      rows.map((item, i) => ({
        ...item,
        releaseId: i === 0 ? "other-release" : item.releaseId,
      })),
    ).overall.status,
    "suppressed",
  );
});
test("research CSV excludes source data and escapes spreadsheet formulas", () => {
  const rows = researchDataset(
    [candidate()],
    DEFAULT_RELEASE,
    pseudonym,
    now,
  ).rows;
  const csv = researchCsv(rows);
  assert.ok(csv.includes("owner_reported_outcome_improved"));
  assert.equal(csv.includes("private-firm"), false);
  assert.equal(csv.includes("jurisdiction"), false);
  assert.equal(csv.includes("email"), false);
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
});
test("requested help requires its own explicit purpose permission and typed inputs", () => {
  const requestId = "d1aac8ba-1a43-44e7-904c-172a5f246c17";
  assert.equal(
    parseHelpInput({ requestId, topic: "intake", consent: false }),
    null,
  );
  assert.equal(
    parseHelpInput({
      requestId,
      topic: "intake",
      consent: true,
      email: "other@example.com",
    }),
    null,
  );
  assert.deepEqual(
    parseHelpInput({
      requestId,
      topic: "intake",
      consent: true,
      consentVersion: HELP_CONSENT_VERSION,
    }),
    { requestId, topic: "intake", reportId: null },
  );
  assert.ok(HELP_CONSENT_TEXT.includes("separate"));
});
