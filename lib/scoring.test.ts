import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "./catalog";
import {
  assessPractice,
  cloneReleaseSnapshot,
  validateRelease,
} from "./scoring";
import type { Answers, AssessmentInput, PracticeContext } from "./types";

const context: PracticeContext = {
  stage: "established",
  practiceArea: "Family law",
  jurisdiction: "Oregon",
  goal: "collect_cash",
  feeModel: "mixed",
  capacityAdditionalMatters: 2,
  websiteStatus: "has_site",
  usesAI: true,
  handlesClientFunds: true,
};
const allAnswers = (value: Answers[string] = "consistent"): Answers =>
  Object.fromEntries(DEFAULT_RELEASE.questions.map((q) => [q.id, value]));
const input = (overrides: Partial<AssessmentInput> = {}): AssessmentInput => ({
  context: { ...context },
  answers: allAnswers(),
  controls: {
    deadline: "yes",
    mfa: "yes",
    ai_review: "yes",
    client_funds: "yes",
  },
  release: cloneReleaseSnapshot(DEFAULT_RELEASE),
  ...overrides,
});

test("default local release is valid and has 24 questions across six modules", () => {
  assert.deepEqual(validateRelease(DEFAULT_RELEASE), []);
  assert.equal(DEFAULT_RELEASE.questions.length, 24);
  for (const domain of DEFAULT_RELEASE.domains)
    assert.equal(
      DEFAULT_RELEASE.questions.filter((q) => q.domain === domain.id).length,
      4,
    );
});

test("all unknown answers withhold grades rather than becoming zero", () => {
  const result = assessPractice(input({ answers: allAnswers("unknown") }));
  assert.equal(result.overallScore, null);
  assert.equal(result.coverage, 0);
  assert.ok(
    result.domains.every(
      (d) =>
        d.score === null &&
        d.status === "incomplete" &&
        d.lowerBound === 0 &&
        d.upperBound === 100,
    ),
  );
});

test("a confirmed missing process is zero while unanswered evidence remains unknown", () => {
  const result = assessPractice(
    input({ answers: { ...allAnswers("not_yet"), "intake-1": "unknown" } }),
  );
  assert.equal(result.domains.find((d) => d.id === "cash")!.score, 0);
  const intake = result.domains.find((d) => d.id === "intake")!;
  assert.equal(intake.score, null);
  assert.equal(intake.coverage, 0.75);
  assert.equal(intake.upperBound, 25);
  assert.equal(result.overallScore, null);
});

test("no website follows an N/A route and never triggers a scan or a zero grade", () => {
  const result = assessPractice(
    input({
      context: {
        ...context,
        websiteStatus: "no_site",
        websiteUrl: "https://not-fetched.example",
      },
    }),
  );
  const presence = result.domains.find((d) => d.id === "presence")!;
  assert.equal(presence.status, "not_applicable");
  assert.equal(presence.score, null);
  assert.equal(result.overallScore, 70);
  assert.ok(result.actions.some((a) => a.id === "public-presence-plan"));
});

test("contingency-only practices do not receive invoice-workflow penalties", () => {
  const result = assessPractice(
    input({
      context: { ...context, feeModel: "contingency" },
      answers: { ...allAnswers(), "cash-3": "not_yet", "cash-4": "unknown" },
    }),
  );
  const cash = result.domains.find((d) => d.id === "cash")!;
  assert.equal(cash.applicableCount, 2);
  assert.equal(cash.score, 70);
  assert.ok(!result.actions.some((a) => a.id === "cash-review"));
});

test("unsupported N/A cannot be used to erase an applicable weakness", () => {
  const result = assessPractice(
    input({ answers: { ...allAnswers(), "cash-1": "not_applicable" } }),
  );
  const cash = result.domains.find((d) => d.id === "cash")!;
  assert.equal(cash.status, "incomplete");
  assert.equal(cash.coverage, 0.75);
  assert.ok(cash.missingMandatory.includes("cash-1"));
});

test("disabled zero-weight question contributes neither points nor missing mandatory evidence", () => {
  const release = cloneReleaseSnapshot(DEFAULT_RELEASE);
  release.questions.find((q) => q.id === "cash-1")!.weight = 0;
  const result = assessPractice(
    input({ release, answers: { ...allAnswers(), "cash-1": "unknown" } }),
  );
  assert.equal(result.domains.find((d) => d.id === "cash")!.score, 70);
  release.questions
    .filter((q) => q.domain === "cash")
    .forEach((q) => {
      q.weight = 0;
    });
  assert.ok(
    validateRelease(release).some((e) => e.includes("cash must contain")),
  );
  assert.throws(() => assessPractice(input({ release })), /Invalid release/);
});

test("invalid configuration fails before assessment", () => {
  const release = cloneReleaseSnapshot(DEFAULT_RELEASE);
  release.questions[0].weight = -1;
  release.questions[1].options[0].points = 100;
  release.minCoverage = 0.5;
  assert.ok(validateRelease(release).length >= 3);
  assert.throws(() => assessPractice(input({ release })), /Invalid release/);
  assert.deepEqual(validateRelease(null), ["A release must be an object."]);
});

test("corrupt rendering metadata is rejected rather than reaching the UI", () => {
  const release = cloneReleaseSnapshot(DEFAULT_RELEASE);
  (release.domains[0] as unknown as Record<string, unknown>).description = null;
  (release.domains[1] as unknown as Record<string, unknown>).color = {
    invalid: true,
  };
  (release.questions[0] as unknown as Record<string, unknown>).help = 42;
  const errors = validateRelease(release);
  assert.ok(errors.some((error) => error.includes("needs a description")));
  assert.ok(errors.some((error) => error.includes("needs a color")));
  assert.ok(errors.some((error) => error.includes("needs help text")));
  assert.throws(() => assessPractice(input({ release })), /Invalid release/);
});

test("coverage threshold and mandatory evidence are independent gates", () => {
  const release = cloneReleaseSnapshot(DEFAULT_RELEASE);
  const q = release.questions.find((item) => item.id === "cash-4")!;
  q.weight = 0.2;
  q.mandatory = false;
  const result = assessPractice(
    input({ release, answers: { ...allAnswers(), "cash-4": "unknown" } }),
  );
  assert.equal(result.domains.find((d) => d.id === "cash")!.status, "scored");
  q.mandatory = true;
  assert.equal(
    assessPractice(
      input({ release, answers: { ...allAnswers(), "cash-4": "unknown" } }),
    ).domains.find((d) => d.id === "cash")!.status,
    "incomplete",
  );
});

test("controls remain visible and never change the maturity grade", () => {
  const normal = assessPractice(input());
  const gaps = assessPractice(
    input({
      controls: {
        deadline: "no",
        mfa: "no",
        ai_review: "unknown",
        client_funds: "no",
      },
    }),
  );
  assert.equal(normal.overallScore, gaps.overallScore);
  assert.equal(gaps.controls.find((c) => c.id === "deadline")!.status, "no");
  assert.ok(
    gaps.actions.some(
      (a) => a.id === "control-deadline" && a.priority === "high",
    ),
  );
  const notUsed = assessPractice(
    input({
      context: { ...context, usesAI: false, handlesClientFunds: false },
    }),
  );
  assert.equal(
    notUsed.controls.find((c) => c.id === "ai_review")!.status,
    "not_applicable",
  );
  assert.equal(
    notUsed.controls.find((c) => c.id === "client_funds")!.status,
    "not_applicable",
  );
});

test("zero spare capacity prioritizes resolving workload rather than generating demand", () => {
  const result = assessPractice(
    input({
      context: {
        ...context,
        goal: "more_clients",
        capacityAdditionalMatters: 0,
      },
    }),
  );
  assert.equal(result.actions[0].id, "capacity-first");
  assert.ok(!result.actions.some((a) => a.requiresCapacity));
});

test("confirmed cash-workflow needs outrank controls with unconfirmed applicability", () => {
  const result = assessPractice(
    input({
      context: { ...context, usesAI: null, handlesClientFunds: null },
      answers: {
        ...allAnswers("reviewed"),
        "cash-3": "ad_hoc",
        "cash-4": "not_yet",
      },
      controls: {
        deadline: "unknown",
        mfa: "unknown",
        ai_review: "unknown",
        client_funds: "unknown",
      },
    }),
  );
  assert.equal(result.actions[0].id, "cash-review");
  assert.ok(
    !result.actions
      .slice(0, 3)
      .some((action) =>
        ["control-ai_review", "control-client_funds"].includes(action.id),
      ),
  );
  assert.equal(result.controls.length, 4);
  assert.ok(result.controls.every((control) => control.status === "unknown"));
  assert.ok(
    result.actions
      .find((action) => action.id === "control-ai_review")!
      .priorityReasons[0].includes("whether this control applies"),
  );
});

test("explicit control gaps stay ahead of even goal-aligned capacity actions", () => {
  const result = assessPractice(
    input({
      context: {
        ...context,
        goal: "more_clients",
        capacityAdditionalMatters: 0,
      },
      controls: {
        deadline: "no",
        mfa: "yes",
        ai_review: "yes",
        client_funds: "yes",
      },
    }),
  );
  assert.equal(result.actions[0].id, "control-deadline");
  assert.ok(result.actions.some((action) => action.id === "capacity-first"));
});

test("same release and evidence produce identical immutable results", () => {
  const request = input();
  const first = assessPractice(request);
  const second = assessPractice(request);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first.releaseSnapshot.questions));
  request.release.questions[0].title = "Changed later";
  request.answers["presence-1"] = "not_yet";
  assert.notEqual(first.releaseSnapshot.questions[0].title, "Changed later");
  assert.equal(first.answersSnapshot["presence-1"], "consistent");
});

test("an older assessed release stays unchanged after publishing a different local rubric", () => {
  const oldRelease = cloneReleaseSnapshot(DEFAULT_RELEASE);
  const oldResult = assessPractice(
    input({
      release: oldRelease,
      answers: { ...allAnswers(), "cash-1": "not_yet" },
    }),
  );
  const newRelease = cloneReleaseSnapshot(oldRelease);
  newRelease.id = "preview-r2";
  newRelease.questions.find((q) => q.id === "cash-1")!.weight = 3;
  const newer = assessPractice(
    input({
      release: newRelease,
      answers: { ...allAnswers(), "cash-1": "not_yet" },
    }),
  );
  assert.equal(oldResult.releaseId, "preview-r1");
  assert.equal(oldResult.domains.find((d) => d.id === "cash")!.score, 52.5);
  assert.equal(newer.domains.find((d) => d.id === "cash")!.score, 35);
});
