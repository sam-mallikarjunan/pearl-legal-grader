import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  closedOutcomeDatePreset,
  OUTCOME_CSV_MAX_BYTES,
  outcomeCsvTemplate,
  parseOutcomeCsv,
  repeatOutcomeSetup,
} from "./outcome-import";

const now = new Date("2026-10-19T00:02:00Z");
const minimal =
  "start_date,end_date,currency,inquiries,clients,admin_hours\n2026-09-01,2026-09-30,USD,20,3,12.25";

test("presets use complete UTC days, including leap-year and year boundaries", () => {
  assert.deepEqual(closedOutcomeDatePreset("last_month", now), {
    startDate: "2026-09-01",
    endDate: "2026-09-30",
  });
  assert.deepEqual(closedOutcomeDatePreset("last_30_days", now), {
    startDate: "2026-09-19",
    endDate: "2026-10-18",
  });
  assert.deepEqual(
    closedOutcomeDatePreset("last_month", new Date("2024-03-01T00:01:00Z")),
    { startDate: "2024-02-01", endDate: "2024-02-29" },
  );
  assert.deepEqual(
    closedOutcomeDatePreset("last_month", new Date("2026-01-12T14:00:00Z")),
    { startDate: "2025-12-01", endDate: "2025-12-31" },
  );
});

test("repeat setup keeps source and currency but clears every measurement and baseline", () => {
  const repeated = repeatOutcomeSetup(
    {
      source: "self_reported",
      currency: "CAD",
      inquiries: 120,
      clients: 12,
      adminHours: 5,
      baselineReportId: "must-not-copy",
    } as never,
    now,
  );
  assert.equal(repeated.source, "self_reported");
  assert.equal(repeated.currency, "CAD");
  for (const key of [
    "inquiries",
    "contacted",
    "booked",
    "attended",
    "clients",
    "leadSpendMinor",
    "cohortBilledMinor",
    "cohortCollectedMinor",
    "adminHours",
    "baselineReportId",
  ] as const)
    assert.equal(repeated[key], null);
});

test("one aggregate row imports known measures while omitted measures remain unknown", () => {
  const period = parseOutcomeCsv(minimal, now);
  assert.equal(period.inquiries, 20);
  assert.equal(period.clients, 3);
  assert.equal(period.adminHours, 12.25);
  assert.equal(period.contacted, null);
  assert.equal(period.cohortCollectedMinor, null);
  assert.equal(period.baselineReportId, null);
  assert.equal(period.source, "export");
});

test("quoted cells, BOM, CRLF and reordered whitelisted headers are supported", () => {
  const period = parseOutcomeCsv(
    '\uFEFF"currency","clients","end_date","start_date","source"\r\n"GBP","0","2026-09-30","2026-09-01","self_reported"\r\n',
    now,
  );
  assert.equal(period.currency, "GBP");
  assert.equal(period.clients, 0);
  assert.equal(period.source, "self_reported");
});

test("major-unit money is converted exactly once to integer minor units", () => {
  const period = parseOutcomeCsv(
    "start_date,end_date,currency,lead_spend,billed,collected\n2026-09-01,2026-09-30,EUR,123.45,100.10,0",
    now,
  );
  assert.equal(period.leadSpendMinor, 12345);
  assert.equal(period.cohortBilledMinor, 10010);
  assert.equal(period.cohortCollectedMinor, 0);
});

test("unknown columns, duplicate columns and identifiers are rejected without echoing input", () => {
  for (const extra of [
    "client_name",
    "email",
    "matter",
    "score",
    "baseline_report_id",
    "inquiries",
    "INQUIRIES",
  ]) {
    const csv =
      minimal.replace("admin_hours\n", `admin_hours,${extra}\n`) +
      ",PRIVATE-CLIENT-VALUE";
    assert.throws(
      () => parseOutcomeCsv(csv, now),
      (error: Error) =>
        error.message ===
        "Use the aggregate template with one header row and one totals row. Do not paste client, matter or contact records.",
    );
  }
});

test("multiple records, embedded lines, mismatched cells and malformed quotes are refused", () => {
  for (const csv of [
    minimal + "\n2026-09-01,2026-09-30,USD,2,1,1",
    minimal + ",unexpected",
    minimal.replace("20,3", '"20\nPRIVATE",3'),
    minimal.replace("20,3", '"20,3'),
    minimal.replace("20,3", '"20"private,3'),
    "inquiries\n2",
    "",
  ])
    assert.throws(() => parseOutcomeCsv(csv, now));
});

test("raw input is bounded by UTF-8 byte length and rejects hidden control characters", () => {
  assert.throws(() =>
    parseOutcomeCsv("x".repeat(OUTCOME_CSV_MAX_BYTES + 1), now),
  );
  assert.throws(() =>
    parseOutcomeCsv("é".repeat(OUTCOME_CSV_MAX_BYTES / 2 + 1), now),
  );
  assert.throws(() =>
    parseOutcomeCsv(minimal.replace("USD", "USD\u0000"), now),
  );
});

test("numeric expressions, formulas, separators, negatives and excessive precision never coerce", () => {
  for (const raw of [
    "1e2",
    "=1+1",
    "-1",
    "+1",
    "NaN",
    "Infinity",
    "1.5",
    "1 000",
    "0x10",
  ])
    assert.throws(() =>
      parseOutcomeCsv(minimal.replace("20,3", `${raw},0`), now),
    );
  assert.throws(() => parseOutcomeCsv(minimal.replace("12.25", "12.251"), now));
  assert.throws(() =>
    parseOutcomeCsv(
      "start_date,end_date,currency,lead_spend\n2026-09-01,2026-09-30,USD,1.001",
      now,
    ),
  );
});

test("existing date, funnel, currency, hour, money and known-value checks remain authoritative", () => {
  for (const csv of [
    minimal.replace("2026-09-30", "2026-10-19"),
    minimal.replace("2026-09-01", "2026-09-29"),
    minimal.replace("USD", "BTC"),
    minimal.replace("20,3", "2,3"),
    minimal.replace("12.25", "721"),
    "start_date,end_date,currency,billed,collected\n2026-09-01,2026-09-30,USD,1,2",
    "start_date,end_date,currency,inquiries\n2026-09-01,2026-09-30,USD,",
  ])
    assert.throws(() => parseOutcomeCsv(csv, now));
});

test("download template starts with a closed month and contains no sample outcomes", () => {
  const template = outcomeCsvTemplate(now);
  assert.match(template, /2026-09-01,2026-09-30,USD,export,,,,,,,,,/);
  assert.throws(() => parseOutcomeCsv(template, now), /at least one known/);
  assert.equal(
    parseOutcomeCsv(template.replace("USD,export,", "USD,export,0"), now)
      .inquiries,
    0,
  );
});
