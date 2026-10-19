import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "./catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "./demo";
import { assessPractice } from "./scoring";
import { getPersonalizedActions } from "./personalized-actions";
import type { CloudReport } from "./account/types";
import type { OutcomePeriod } from "./outcomes";
import type { PrioritizedAction } from "./types";

const now = new Date("2026-10-19T15:00:00Z");
function report(
  control: "yes" | "no" | "unknown" = "yes",
  capacity: number | null = 2,
): CloudReport {
  const snapshot = {
    id: "13be04bb-5fc0-4558-a171-bb2c65e934f7",
    practiceId: "631a03e4-12db-4244-be83-cdf017d4c17c",
    createdAt: "2026-07-15T20:00:00.000Z",
    label: "Action test practice",
    isSample: false,
    assessment: structuredClone(
      assessPractice({
        context: { ...SAMPLE_CONTEXT, capacityAdditionalMatters: capacity },
        answers: SAMPLE_ANSWERS,
        controls: { ...SAMPLE_CONTROLS, mfa: control },
        release: DEFAULT_RELEASE,
      }),
    ),
  };
  return {
    id: "8d0f1d4c-040d-433a-97a7-3d047c305212",
    snapshot,
    savedAt: "2026-07-15T20:10:00.000Z",
    canonical: true,
    actionProgress: snapshot.assessment.actions.map((a) => ({
      actionId: a.id,
      state: "todo",
      revision: 0,
      updatedAt: "2026-07-15T20:10:00.000Z",
    })),
  };
}
const period = (
  month: "08" | "09",
  baselineReportId: string | null,
): OutcomePeriod => ({
  id:
    month === "08"
      ? "7b0f1d4c-040d-433a-97a7-3d047c305212"
      : "7c0f1d4c-040d-433a-97a7-3d047c305212",
  revision: 0,
  createdAt: "2026-10-10T10:00:00Z",
  updatedAt: "2026-10-10T10:00:00Z",
  startDate: `2026-${month}-01`,
  endDate: month === "08" ? "2026-08-31" : "2026-09-30",
  source: "self_reported",
  currency: "USD",
  baselineReportId,
  inquiries: 100,
  contacted: 80,
  booked: 40,
  attended: 30,
  clients: 10,
  leadSpendMinor: 100000,
  cohortBilledMinor: 100000,
  cohortCollectedMinor: month === "08" ? 90000 : 50000,
  adminHours: month === "08" ? 15 : 40,
});
const issued = (r: ReturnType<typeof getPersonalizedActions>) =>
  r.items.filter((i) => i.kind === "issued");
const explanation = (r: ReturnType<typeof getPersonalizedActions>) =>
  r.items.flatMap((i) => i.whyNow).join("\n");
function restrict(
  r: CloudReport,
  predicate: (a: PrioritizedAction) => boolean,
) {
  r.snapshot.assessment.actions =
    r.snapshot.assessment.actions.filter(predicate);
  return r;
}

test("shortlists only selected report issued templates, max three, without mutating score or data", () => {
  const r = report(),
    before = JSON.stringify(r);
  const result = getPersonalizedActions(r, { goal: "less_admin", now });
  assert.ok(result.items.length <= 3);
  assert.equal(JSON.stringify(r), before);
  assert.equal(result.reportId, r.id);
  for (const item of issued(result)) {
    assert.ok(r.snapshot.assessment.actions.includes(item.action));
    assert.ok(
      r.snapshot.assessment.releaseSnapshot.actions.some(
        (a) => a.id === item.action.id,
      ),
    );
    assert.match(item.measure, /Completion definition:/);
  }
  assert.match(result.note, /grade and templates stay unchanged/);
  const foreign = structuredClone(r.snapshot.assessment.actions[0]);
  foreign.id = "not-issued";
  r.snapshot.assessment.actions.unshift(foreign);
  r.actionProgress.push({
    actionId: foreign.id,
    state: "todo",
    revision: 0,
    updatedAt: now.toISOString(),
  });
  assert.ok(
    !issued(getPersonalizedActions(r, { now })).some(
      (i) => i.action.id === foreign.id,
    ),
  );
  r.snapshot.isSample = true;
  assert.equal(getPersonalizedActions(r, { now }).items.length, 0);
});
test("explicit essential control gaps precede goal choices; unknown is a confirmation task", () => {
  const r = report("no");
  const result = getPersonalizedActions(r, { goal: "more_clients", now });
  assert.equal(result.items[0].kind, "issued");
  assert.equal(
    result.items[0].kind === "issued" && result.items[0].essential,
    true,
  );
  assert.match(explanation(result), /explicitly reported.*missing/);
  const u = restrict(report("unknown"), (a) => a.trigger.type === "control");
  const resultUnknown = getPersonalizedActions(u, { now });
  assert.ok(issued(resultUnknown).every((i) => !i.essential));
  assert.match(
    explanation(resultUnknown),
    /unknown does not establish a missing control/,
  );
  assert.doesNotMatch(
    explanation(resultUnknown),
    /explicitly reported.*missing/,
  );
});
test("completion, deferral and not fitting stay excluded until owner explicitly reopens", () => {
  const r = report();
  const states = ["done", "deferred", "not_relevant"] as const;
  states.forEach((state, i) => (r.actionProgress[i].state = state));
  const result = getPersonalizedActions(r, { now });
  assert.deepEqual(
    [
      result.excluded.done,
      result.excluded.deferred,
      result.excluded.notRelevant,
    ],
    [1, 1, 1],
  );
  for (const p of r.actionProgress.slice(0, 3))
    assert.ok(!issued(result).some((i) => i.action.id === p.actionId));
  r.actionProgress[0].state = "todo";
  const reopened = restrict(r, (a) => a.id === r.actionProgress[0].actionId);
  assert.equal(issued(getPersonalizedActions(reopened, { now })).length, 1);
});
test("existing commitments and passed owner dates outrank a new goal without treating lateness as failure", () => {
  const r = report();
  const candidate = r.actionProgress.at(-1)!;
  candidate.state = "in_progress";
  candidate.details = {
    updatedAt: now.toISOString(),
    targetDate: "2026-10-01",
  };
  const result = getPersonalizedActions(r, { goal: "more_clients", now });
  assert.equal(issued(result)[0].action.id, candidate.actionId);
  assert.match(
    explanation(result),
    /planning cue, not proof the action failed/,
  );
  assert.match(explanation(result), /already started/);
});
test("full capacity excludes growth and unconfirmed capacity does not authorize capacity-required work", () => {
  const r = report("yes", 0);
  const result = getPersonalizedActions(r, { goal: "more_clients", now });
  assert.ok(
    issued(result).every(
      (i) =>
        !i.action.requiresCapacity &&
        !(
          i.action.domain === "presence" &&
          i.action.goalFit.includes("more_clients")
        ),
    ),
  );
  const u = report("yes", null);
  const a = structuredClone(u.snapshot.assessment.actions[0]);
  a.requiresCapacity = true;
  u.snapshot.assessment.actions = [a];
  const unknown = getPersonalizedActions(u, { now });
  assert.equal(issued(unknown).length, 0);
  assert.equal(unknown.excluded.capacity, 1);
  assert.doesNotMatch(explanation(unknown), /no spare matter capacity/);
});
test("unlinked periods do not affect practice rationale until separately declared in this view", () => {
  const r = restrict(report(), (a) => a.domain === "cash"),
    periods = [period("08", null), period("09", null)];
  const off = getPersonalizedActions(r, { goal: "collect_cash", periods, now });
  assert.doesNotMatch(explanation(off), /90.0%/);
  assert.match(explanation(off), /unlinked periods are not being used/);
  const on = getPersonalizedActions(r, {
    goal: "collect_cash",
    periods,
    allowUnlinkedForSelectedPractice: true,
    now,
  });
  assert.match(explanation(on), /90.0% \(90000\/100000\)/);
  assert.match(explanation(on), /50.0% \(50000\/100000\)/);
  assert.match(explanation(on), /owner-declared/);
  assert.match(explanation(on), /2026-08-01–2026-08-31/);
  assert.match(explanation(on), /not a cause/);
  assert.ok(periods.every((p) => p.baselineReportId === null));
});
test("foreign baselines and linked-unlinked pairs never become practice outcome evidence", () => {
  const r = restrict(report(), (a) => a.domain === "cash");
  const p = [
    period("08", "9d0f1d4c-040d-433a-97a7-3d047c305212"),
    period("09", "9d0f1d4c-040d-433a-97a7-3d047c305212"),
  ];
  assert.doesNotMatch(
    explanation(
      getPersonalizedActions(r, {
        goal: "collect_cash",
        periods: p,
        allowUnlinkedForSelectedPractice: true,
        now,
      }),
    ),
    /90.0%/,
  );
  const mixed = [period("08", r.id), period("09", null)];
  assert.doesNotMatch(
    explanation(
      getPersonalizedActions(r, {
        goal: "collect_cash",
        periods: mixed,
        allowUnlinkedForSelectedPractice: true,
        now,
      }),
    ),
    /90.0%/,
  );
});
test("latest known cohort observations provide dated ratios; favorable or unknown values never imply failure", () => {
  const r = restrict(report(), (a) => a.domain === "cash");
  const p = [period("08", r.id), period("09", r.id)];
  assert.match(
    explanation(
      getPersonalizedActions(r, { goal: "collect_cash", periods: p, now }),
    ),
    /Period-issued invoices collected/,
  );
  p[1].cohortCollectedMinor = null;
  const unknown = getPersonalizedActions(r, {
    goal: "collect_cash",
    periods: p,
    now,
  });
  assert.match(explanation(unknown), /unknown measure/);
  assert.doesNotMatch(explanation(unknown), /90.0%/);
  p[1].cohortCollectedMinor = 100000;
  assert.doesNotMatch(
    explanation(
      getPersonalizedActions(r, { goal: "collect_cash", periods: p, now }),
    ),
    /90.0%/,
  );
  p[1].cohortBilledMinor = 0;
  p[1].cohortCollectedMinor = 0;
  assert.doesNotMatch(
    explanation(
      getPersonalizedActions(r, { goal: "collect_cash", periods: p, now }),
    ),
    /0.0%/,
  );
});
test("invalid or mixed-currency cohorts abstain and readonly measurement tasks have no invented action IDs", () => {
  const r = report();
  const p = [period("08", r.id), period("09", r.id)];
  p[1].currency = "GBP";
  const result = getPersonalizedActions(r, {
    goal: "collect_cash",
    periods: p,
    now,
  });
  assert.doesNotMatch(explanation(result), /90.0%/);
  const measurement = result.items.find((i) => i.kind === "measurement");
  assert.ok(measurement);
  assert.ok(!("action" in measurement));
  assert.equal(measurement.href, "/account#business-outcomes");
  p[1].adminHours = Infinity;
  assert.doesNotMatch(
    explanation(getPersonalizedActions(r, { periods: p, now })),
    /Infinity/,
  );
});
