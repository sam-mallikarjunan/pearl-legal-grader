import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  OUTCOME_IMPORT_MAX_BYTES,
  outcomeImportWizardTemplate,
  parseOutcomeImportTable,
  previewOutcomeImport,
  type OutcomeImportOptions,
} from "./outcome-import-wizard";
const now = new Date("2026-10-19T12:00:00Z");
const options: OutcomeImportOptions = {
  dateFormat: "iso",
  moneyUnits: "major",
  defaultCurrency: "USD",
};
const csv =
  "Start Date,End Date,Currency,New inquiries,Clients,Owner Admin Hours,Lead Spend,Billed,Collected\n2026-08-01,2026-08-31,USD,100,10,12.5,123.45,1000,800\n2026-09-01,2026-09-30,CAD,80,8,NULL,0,500,";
const preview = (text: string, choices = options) => {
  const table = parseOutcomeImportTable(text);
  return previewOutcomeImport(table, table.suggestedMapping, choices, [], now);
};

test("aliases suggest mappings for two aggregate periods without retaining custom headers", () => {
  const table = parseOutcomeImportTable(csv + "\n");
  assert.equal(table.rows.length, 2);
  assert.equal(table.suggestedMapping.inquiries, 3);
  assert.equal(table.suggestedMapping.adminHours, 5);
  assert.ok(!("headers" in table));
  const result = previewOutcomeImport(
    table,
    table.suggestedMapping,
    options,
    [],
    now,
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.periods.length, 2);
  assert.equal(result.periods[0].leadSpendMinor, 12345);
  assert.equal(result.periods[1].leadSpendMinor, 0);
  assert.equal(result.periods[1].adminHours, null);
  assert.equal(result.periods[1].cohortCollectedMinor, null);
  assert.ok(
    result.periods.every(
      (p) => p.source === "export" && p.baselineReportId === null,
    ),
  );
});

test("TSV auto detection handles BOM, quoted cells and CRLF", () => {
  const result = preview(
    '\uFEFF"period_start"\t"period_end"\t"lead_count"\r\n"2026-09-01"\t"2026-09-30"\t"0"\r\n',
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.periods[0].inquiries, 0);
  assert.equal(result.periods[0].currency, "USD");
});

test("unrecognized headers and unmapped values never appear in normalized preview", () => {
  const table = parseOutcomeImportTable(
    "start,end,inquiries,UNRECOGNIZED-PRIVATE-HEADER\n2026-09-01,2026-09-30,10,DO-NOT-SEND-THIS",
  );
  assert.equal(table.columnLabels[3], "Column D · unrecognized header");
  const result = previewOutcomeImport(
    table,
    table.suggestedMapping,
    options,
    [],
    now,
  );
  assert.deepEqual(result.errors, []);
  assert.ok(!JSON.stringify(result).includes("UNRECOGNIZED-PRIVATE-HEADER"));
  assert.ok(!JSON.stringify(result).includes("DO-NOT-SEND-THIS"));
});

test("known identifying, matter, free text and credential headers reject without echo", () => {
  for (const header of [
    "Client",
    "client_name",
    "Contact Email",
    "Billing Email",
    "Matter ID",
    "case_number",
    "employeeName",
    "phone_number",
    "Address",
    "notes",
    "Note",
    "comment",
    "password",
    "access_token",
    "api_key",
    "baseline_report_id",
  ]) {
    assert.throws(
      () =>
        parseOutcomeImportTable(
          `start,end,inquiries,${header}\n2026-09-01,2026-09-30,2,PRIVATE-DETAIL`,
        ),
      (e: Error) =>
        e.message ===
        "Use a CSV or tab-separated sheet of aggregate totals: one header row and 1–24 period rows, with no client, matter, contact or credential columns.",
    );
  }
});

test("bounds reject over24 rows, over32 columns, long cells, control bytes and UTF8 overflow", () => {
  for (const text of [
    "é".repeat(OUTCOME_IMPORT_MAX_BYTES / 2 + 1),
    "x".repeat(OUTCOME_IMPORT_MAX_BYTES + 1),
    csv.replace("100,10", "100\u0000,10"),
    "a,b,c\n" + Array(25).fill("1,2,3").join("\n"),
    Array(33)
      .fill(0)
      .map((_, i) => `column${i}`)
      .join(",") +
      "\n" +
      Array(33).fill("1").join(","),
    "start,end,inquiries\n" + "1".repeat(129) + ",2,3",
  ])
    assert.throws(() => parseOutcomeImportTable(text));
});

test("malformed quotes, embedded newlines, duplicate headers and empty sheets reject", () => {
  for (const text of [
    "",
    "start,end,inquiries",
    'start,end,inquiries\n"2026-09-01,2026-09-30,2',
    'start,end,inquiries\n"2026-09-01\n2026-09-02",2026-09-30,2',
    "start,end,inquiries,inquiries\n2026-09-01,2026-09-30,2,2",
  ])
    assert.throws(() => parseOutcomeImportTable(text));
});

test("ambiguous aliases require explicit mapping and each input column can be used once", () => {
  const table = parseOutcomeImportTable(
    "start,end,inquiries,leads\n2026-09-01,2026-09-30,10,20",
  );
  assert.equal(table.suggestedMapping.inquiries, null);
  assert.equal(
    previewOutcomeImport(table, table.suggestedMapping, options, [], now)
      .errors[0].code,
    "invalid_mapping",
  );
  const mapping = { ...table.suggestedMapping, inquiries: 2 };
  assert.deepEqual(
    previewOutcomeImport(table, mapping, options, [], now).errors,
    [],
  );
  assert.equal(
    previewOutcomeImport(table, { ...mapping, clients: 2 }, options, [], now)
      .errors[0].code,
    "invalid_mapping",
  );
});

test("explicit US and EU date formats resolve ambiguous dates without guessing", () => {
  const text = "start,end,inquiries\n01/08/2026,08/08/2026,10";
  assert.equal(preview(text).errors[0].code, "invalid_outcome_dates");
  assert.equal(
    preview(text, { ...options, dateFormat: "us" }).periods[0].startDate,
    "2026-01-08",
  );
  assert.equal(
    preview(text, { ...options, dateFormat: "eu" }).periods[0].startDate,
    "2026-08-01",
  );
  assert.ok(
    preview("start,end,inquiries\n31/02/2026,10/03/2026,10", {
      ...options,
      dateFormat: "eu",
    }).errors.length > 0,
  );
});

test("minor-unit money is not converted again and fractional minor units are refused", () => {
  const text = "start,end,lead_spend\n2026-09-01,2026-09-30,12345";
  assert.equal(
    preview(text, { ...options, moneyUnits: "minor" }).periods[0]
      .leadSpendMinor,
    12345,
  );
  assert.equal(preview(text).periods[0].leadSpendMinor, 1234500);
  assert.ok(
    preview(text.replace("12345", "123.45"), {
      ...options,
      moneyUnits: "minor",
    }).errors.length > 0,
  );
});

test("bad row errors identify positions without echoing rejected cells and block whole-batch save", () => {
  const result = preview(csv.replace("80,8,NULL", "80,PRIVATE-VALUE,NULL"));
  assert.equal(result.errors[0].row, 2);
  assert.equal(result.periods.length, 1);
  assert.ok(!JSON.stringify(result).includes("PRIVATE-VALUE"));
  const malformed = preview(csv + "\n2026-07-01,2026-07-31,USD,1");
  assert.equal(malformed.errors[0].row, 3);
  assert.equal(malformed.errors[0].code, "row_shape");
});

test("period overlap within batch, with saved periods and registered plans is explicit", () => {
  assert.equal(
    preview(csv.replaceAll("2026-09", "2026-08")).errors[0].code,
    "batch_overlap",
  );
  const table = parseOutcomeImportTable(csv);
  assert.equal(
    previewOutcomeImport(
      table,
      table.suggestedMapping,
      options,
      [{ startDate: "2026-08-31", endDate: "2026-09-06" }],
      now,
    ).errors[0].code,
    "existing_overlap",
  );
  assert.equal(
    previewOutcomeImport(
      table,
      table.suggestedMapping,
      options,
      [{ startDate: "2026-08-01", endDate: "2026-08-31", reserved: true }],
      now,
    ).errors[0].code,
    "registered_overlap",
  );
  const tooMany = Array(23).fill({
    startDate: "2020-01-01",
    endDate: "2020-01-07",
  });
  assert.equal(
    previewOutcomeImport(table, table.suggestedMapping, options, tooMany, now)
      .errors[0].code,
    "outcome_capacity",
  );
});

test("cohort, closed period, source, zero, currency and numeric validation stays authoritative", () => {
  for (const text of [
    csv.replace("100,10", "1,10"),
    csv.replace("2026-09-30", "2026-10-19"),
    csv.replace("USD,100", "BTC,100"),
    csv.replace("123.45", "1e2"),
    csv.replace("1000,800", "1,800"),
    csv.replace("12.5", "9999"),
  ])
    assert.ok(preview(text).errors.length > 0);
  assert.equal(
    preview("start,end,currency,inquiries\n2026-09-01,2026-09-30,NULL,0")
      .periods[0].currency,
    "USD",
  );
  assert.equal(
    preview("start,end,inquiries,source\n2026-09-01,2026-09-30,2,self_reported")
      .periods[0].source,
    "export",
  );
});

test("blank template has two completed periods and no invented sample measures", () => {
  const table = parseOutcomeImportTable(outcomeImportWizardTemplate(now));
  assert.equal(table.rows.length, 2);
  assert.deepEqual(
    table.rows.map((row) => row.slice(0, 3)),
    [
      ["2026-08-01", "2026-08-31", "USD"],
      ["2026-09-01", "2026-09-30", "USD"],
    ],
  );
  assert.ok(
    previewOutcomeImport(
      table,
      table.suggestedMapping,
      options,
      [],
      now,
    ).errors.every((error) => error.code === "empty_outcome"),
  );
});
