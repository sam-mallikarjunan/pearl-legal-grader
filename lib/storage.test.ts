import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_RELEASE } from "./catalog";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "./demo";
import { assessPractice } from "./scoring";
import {
  emptyStore,
  normalizeWebsite,
  parseStore,
  type PreviewStore,
} from "./storage";

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
