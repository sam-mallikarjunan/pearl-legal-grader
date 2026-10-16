import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "./catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "./demo";
import { assessPractice } from "./scoring";
import {
  emptyStore,
  normalizeWebsite,
  parseStore,
  parseScanAccess,
  isActionProgress,
  isCalendarDate,
  retainActionProgress,
  type PreviewStore,
} from "./storage";
import type { WebsiteScanResult } from "./website/types";

function savedStore(): PreviewStore {
  const store = emptyStore();
  store.assessments.push({
    id: "sample-assessment",
    practiceId: "sample-juniper",
    createdAt: "2026-10-14T18:00:00.000Z",
    label: "Fictional example",
    isSample: true,
    assessment: assessPractice({
      context: SAMPLE_CONTEXT,
      answers: SAMPLE_ANSWERS,
      controls: SAMPLE_CONTROLS,
      release: DEFAULT_RELEASE,
    }),
  });
  store.actionStates["sample-assessment:cash-review"] = "done";
  store.preferences.reminders = true;
  return store;
}

const corrupt = (change: (store: PreviewStore) => void) => {
  const value = JSON.parse(JSON.stringify(savedStore())) as PreviewStore;
  change(value);
  return parseStore(JSON.stringify(value));
};

test("empty and assessed stores survive JSON round trips without reranking history", () => {
  const empty = emptyStore();
  assert.deepEqual(parseStore(JSON.stringify(empty)), empty);
  const store = savedStore();
  assert.deepEqual(parseStore(JSON.stringify(store)), store);
  assert.equal(
    parseStore(JSON.stringify(store))!.actionStates[
      "sample-assessment:cash-review"
    ],
    "done",
  );
});

test("missing, oversized, invalid JSON and nonobject storage are unreadable", () => {
  for (const raw of [
    null,
    "",
    "{broken",
    "null",
    "[]",
    "123",
    "x".repeat(4_000_001),
  ])
    assert.equal(parseStore(raw), null);
});

test("bad active, historical and issued releases are rejected", () => {
  assert.equal(
    corrupt((store) => {
      store.activeRelease.minCoverage = 0;
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      store.releaseHistory[0].questions[0].weight = -1;
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      store.assessments[0].assessment.releaseSnapshot.domains[0].title = "";
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      store.assessments[0].assessment.releaseId = "another-release";
    }),
    null,
  );
});

test("report module structure, findings and score ranges are validated", () => {
  assert.equal(
    corrupt((store) => {
      store.assessments[0].assessment.domains = [];
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      store.assessments[0].assessment.domains[1].id = "presence";
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      store.assessments[0].assessment.domains[0].score = 101;
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      store.assessments[0].assessment.domains[0].coverage = -1;
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      (
        store.assessments[0].assessment.domains[0] as unknown as Record<
          string,
          unknown
        >
      ).findings = null;
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      store.assessments[0].assessment.domains[0].findings[0].questionId =
        "missing-question";
    }),
    null,
  );
});

test("bad action guides and control status shapes cannot reach report rendering", () => {
  assert.equal(
    corrupt((store) => {
      (
        store.assessments[0].assessment.actions[0] as unknown as Record<
          string,
          unknown
        >
      ).steps = { invalid: true };
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      (
        store.assessments[0].assessment.actions[0] as unknown as Record<
          string,
          unknown
        >
      ).priorityReasons = null;
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      store.assessments[0].assessment.actions[0].id = "unpublished-action";
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      store.assessments[0].assessment.controls = [];
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      (
        store.assessments[0].assessment.controls[0] as unknown as Record<
          string,
          unknown
        >
      ).title = { invalid: true };
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      store.assessments[0].assessment.controls[1].id = "deadline";
    }),
    null,
  );
});

test("context, input snapshots, metadata and preference types are validated", () => {
  assert.equal(
    corrupt((store) => {
      (
        store.assessments[0].assessment.contextSnapshot as unknown as Record<
          string,
          unknown
        >
      ).goal = "unsupported";
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      (
        store.assessments[0].assessment.contextSnapshot as unknown as Record<
          string,
          unknown
        >
      ).practiceArea = { invalid: true };
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      store.assessments[0].assessment.contextSnapshot.websiteUrl =
        "https://user:secret@firm.example";
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      (
        store.assessments[0].assessment.answersSnapshot as unknown as Record<
          string,
          unknown
        >
      )["cash-1"] = { invalid: true };
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      store.assessments[0].createdAt = "not-a-date";
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      (store.preferences as unknown as Record<string, unknown>).marketing =
        "yes";
    }),
    null,
  );
  assert.equal(
    corrupt((store) => {
      (store.actionStates as unknown as Record<string, unknown>)[
        "sample-assessment:cash-review"
      ] = "published";
    }),
    null,
  );
});

test("practice identity and explicit baselines survive round trip and prevent cross-practice linkage", () => {
  const store = savedStore();
  const baseline = JSON.parse(JSON.stringify(store.assessments[0]));
  store.assessments.unshift({
    ...baseline,
    id: "sample-followup",
    baselineId: baseline.id,
  });
  assert.deepEqual(parseStore(JSON.stringify(store)), store);
  store.assessments[0].practiceId = "another-practice";
  assert.equal(parseStore(JSON.stringify(store)), null);
  assert.equal(
    corrupt((value) => {
      (value.assessments[0] as unknown as Record<string, unknown>).practiceId =
        null;
    }),
    null,
  );
  assert.equal(
    corrupt((value) => {
      value.assessments[0].baselineId = value.assessments[0].id;
    }),
    null,
  );
  assert.equal(
    corrupt((value) => {
      (value.assessments[0] as unknown as Record<string, unknown>).baselineId =
        {};
    }),
    null,
  );
});

test("an explicit baseline can age out of bounded local history", () => {
  const store = savedStore();
  store.assessments[0].baselineId = "previous-result-no-longer-retained";
  assert.deepEqual(parseStore(JSON.stringify(store)), store);
});

test("website normalization accepts ordinary HTTP(S) addresses and bare domains", () => {
  assert.equal(normalizeWebsite("  firm.example  "), "https://firm.example/");
  assert.equal(
    normalizeWebsite("https://Firm.Example/contact?from=grader"),
    "https://firm.example/contact?from=grader",
  );
  assert.equal(normalizeWebsite("http://firm.example"), "http://firm.example/");
  assert.equal(
    normalizeWebsite("firm.example:8443/contact"),
    "https://firm.example:8443/contact",
  );
});

test("website normalization rejects credentials, nonweb schemes and malformed input", () => {
  for (const value of [
    "",
    "https://",
    "localhost",
    "https://user:secret@firm.example",
    "user@firm.example",
    "https://%75ser@firm.example",
    "javascript:alert(1)",
    "mailto:lawyer@firm.example",
    "ftp://firm.example",
    "custom.scheme://firm.example",
    "https://firm.\nexample",
  ])
    assert.equal(normalizeWebsite(value), null, value);
});

const scanFixture = (): WebsiteScanResult => ({
  scannerVersion: "website-scan-v1",
  rubricVersion: "website-rubric-v1",
  status: "unavailable",
  submittedUrl: "https://firm.example/",
  finalUrl: null,
  startedAt: "2026-10-15T18:00:00.000Z",
  completedAt: "2026-10-15T18:00:01.000Z",
  durationMs: 1000,
  pages: [],
  findings: [],
  score: null,
  coverage: 0,
  measuredChecks: 0,
  totalChecks: 20,
  suggestedContext: {
    firmName: null,
    practiceAreas: [],
    locations: [],
    evidence: [],
    requiresConfirmation: true,
  },
  technologies: [],
  performance: {
    status: "unavailable",
    strategy: "mobile",
    fetchedAt: "2026-10-15T18:00:01.000Z",
    sourceUrl: "https://firm.example/",
    reason: "Quota unavailable",
    categories: {},
    metrics: [],
    opportunities: [],
  },
  warnings: ["Website could not be inspected"],
  limitations: ["Public pages only"],
});

test("pre-scan device history remains compatible and scan snapshots retain issued evidence", () => {
  const legacy = savedStore();
  delete legacy.websiteSessions;
  assert.deepEqual(parseStore(JSON.stringify(legacy)), legacy);
  const store = savedStore();
  store.assessments[0].isSample = false;
  store.assessments[0].practiceId = "real-practice-123";
  store.assessments[0].websiteScan = scanFixture();
  store.websiteSessions = [
    {
      localId: "local-request",
      practiceId: store.assessments[0].practiceId,
      scanId: "scan-12345678",
      url: "https://firm.example/",
      createdAt: "2026-10-15T18:00:00.000Z",
      status: "unavailable",
      stage: "Inspection unavailable",
      result: scanFixture(),
    },
  ];
  const earlier = JSON.stringify(store.assessments[0]);
  store.websiteSessions[0].result!.completedAt = "2026-10-15T20:00:01.000Z";
  assert.equal(JSON.stringify(store.assessments[0]), earlier);
  assert.deepEqual(parseStore(JSON.stringify(store)), store);
  store.assessments[0].websiteScan.coverage = -1;
  assert.equal(parseStore(JSON.stringify(store)), null);
});

test("scan session validation rejects corrupt shapes and credential leakage into exportable history", () => {
  const store = savedStore();
  store.websiteSessions = [
    {
      localId: "local-request",
      practiceId: "practice-123",
      scanId: "scan-12345678",
      url: "https://firm.example/",
      createdAt: "2026-10-15T18:00:00.000Z",
      status: "queued",
      stage: "Waiting",
    },
  ];
  assert.ok(parseStore(JSON.stringify(store)));
  (store.websiteSessions[0] as unknown as Record<string, unknown>).accessToken =
    "secret-should-never-be-here";
  assert.equal(parseStore(JSON.stringify(store)), null);
  delete (store.websiteSessions[0] as unknown as Record<string, unknown>)
    .accessToken;
  (store.websiteSessions[0] as unknown as Record<string, unknown>).stage = {};
  assert.equal(parseStore(JSON.stringify(store)), null);
  const sample = savedStore();
  sample.assessments[0].websiteScan = scanFixture();
  assert.equal(
    parseStore(JSON.stringify(sample)),
    null,
    "fictional reports cannot acquire real scan evidence",
  );
});

test("private scan access has a separate bounded validator and never enters report exports", () => {
  const token = "a".repeat(64);
  assert.deepEqual(parseScanAccess(null), {});
  assert.deepEqual(
    parseScanAccess(JSON.stringify({ "scan-12345678": token })),
    { "scan-12345678": token },
  );
  for (const raw of [
    "{broken",
    "[]",
    "null",
    JSON.stringify({ "bad id": token }),
    JSON.stringify({ "scan-12345678": "short" }),
    JSON.stringify({ "scan-12345678": { token } }),
  ])
    assert.equal(parseScanAccess(raw), null);
  const store = emptyStore();
  assert.equal(JSON.stringify(store).includes(token), false);
  assert.equal(JSON.stringify(store).includes("accessToken"), false);
});

test("action plans retain optional progress and outcomes without rewriting issued scores", () => {
  const store = savedStore();
  const issued = JSON.stringify(store.assessments[0]);
  const actionId = store.assessments[0].assessment.actions[0].id;
  const key = `sample-assessment:${actionId}`;
  store.actionStates[key] = "in_progress";
  store.actionProgress = {
    [key]: {
      updatedAt: "2026-10-16T12:30:00.000Z",
      targetDate: "2026-10-23",
    },
  };
  assert.deepEqual(parseStore(JSON.stringify(store)), store);
  store.actionStates[key] = "done";
  store.actionProgress[key].outcome = {
    status: "improved",
    recordedAt: "2026-10-24T12:30:00.000Z",
  };
  assert.deepEqual(parseStore(JSON.stringify(store)), store);
  assert.equal(JSON.stringify(store.assessments[0]), issued);
  store.actionStates[key] = "not_relevant";
  store.actionProgress[key].relevanceReason = "does_not_fit";
  assert.deepEqual(parseStore(JSON.stringify(store)), store);
  delete store.actionProgress;
  assert.ok(
    parseStore(JSON.stringify(store)),
    "old history needs no new field",
  );
});

test("action details reject malformed dates, unknown metadata and unissued actions", () => {
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("2028-02-29"), true);
  assert.equal(isCalendarDate("2026-10-23T00:00:00Z"), false);
  const base = { updatedAt: "2026-10-16T12:30:00.000Z" };
  for (const invalid of [
    null,
    [],
    {},
    { updatedAt: "yesterday" },
    { updatedAt: "2026-02-31T12:30:00.000Z" },
    { ...base, targetDate: "2026-02-31" },
    { ...base, relevanceReason: "publish_my_firm" },
    { ...base, outcome: { status: "verified", recordedAt: base.updatedAt } },
    { ...base, outcome: { status: "improved", recordedAt: "not-a-date" } },
    { ...base, accessToken: "secret-must-not-be-exported" },
    {
      ...base,
      outcome: {
        status: "improved",
        recordedAt: base.updatedAt,
        token: "secret",
      },
    },
  ])
    assert.equal(isActionProgress(invalid), false, JSON.stringify(invalid));
  const store = savedStore();
  store.actionProgress = { "sample-assessment:unissued-action": base };
  assert.equal(parseStore(JSON.stringify(store)), null);
  store.actionProgress = { "another-assessment:cash-review": base };
  assert.equal(parseStore(JSON.stringify(store)), null);
});

test("bounded report retention removes progress for reports or actions no longer retained", () => {
  const store = savedStore();
  const key = `${store.assessments[0].id}:${store.assessments[0].assessment.actions[0].id}`;
  const detail = { updatedAt: "2026-10-16T12:30:00.000Z" };
  const progress = { [key]: detail, "expired-report:cash-review": detail };
  assert.deepEqual(retainActionProgress(progress, store.assessments), {
    [key]: detail,
  });
  assert.deepEqual(retainActionProgress(progress, []), {});
  assert.deepEqual(retainActionProgress(undefined, store.assessments), {});
});
