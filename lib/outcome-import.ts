import {
  OUTCOME_COUNT_FIELDS,
  OUTCOME_MONEY_FIELDS,
  parseOutcomePeriodInput,
  type OutcomePeriodInput,
} from "./outcomes";

/** Aggregate CSV is parsed in the browser; callers must never persist the source text. */
export const OUTCOME_CSV_MAX_BYTES = 32 * 1024;
export const OUTCOME_CSV_HEADERS = [
  "start_date",
  "end_date",
  "currency",
  "source",
  "inquiries",
  "clients",
  "admin_hours",
  "contacted",
  "booked",
  "attended",
  "lead_spend",
  "billed",
  "collected",
] as const;
export type OutcomeDatePreset = "last_month" | "last_30_days";

export function closedOutcomeDatePreset(
  preset: OutcomeDatePreset,
  now = new Date(),
): Pick<OutcomePeriodInput, "startDate" | "endDate"> {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const end =
    preset === "last_month"
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)
      : today - 86400000;
  const start =
    preset === "last_month"
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
      : today - 30 * 86400000;
  return {
    startDate: new Date(start).toISOString().slice(0, 10),
    endDate: new Date(end).toISOString().slice(0, 10),
  };
}

/** Deliberately copies only setup: no old counts, amounts, hours or baseline. */
export function repeatOutcomeSetup(
  period: Pick<OutcomePeriodInput, "source" | "currency">,
  now = new Date(),
): OutcomePeriodInput {
  return {
    ...closedOutcomeDatePreset("last_month", now),
    source: period.source,
    currency: period.currency,
    baselineReportId: null,
    inquiries: null,
    contacted: null,
    booked: null,
    attended: null,
    clients: null,
    leadSpendMinor: null,
    cohortBilledMinor: null,
    cohortCollectedMinor: null,
    adminHours: null,
  };
}

const invalidCsv = () =>
  new Error(
    "Use the aggregate template with one header row and one totals row. Do not paste client, matter or contact records.",
  );

function csvRows(text: string): string[][] {
  if (
    new TextEncoder().encode(text).byteLength > OUTCOME_CSV_MAX_BYTES ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  )
    throw invalidCsv();
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else if (char === "\r" || char === "\n") throw invalidCsv();
      else cell += char;
      continue;
    }
    if (char === '"') {
      if (cell !== "" || closed) throw invalidCsv();
      quoted = true;
    } else if (char === ",") {
      row.push(cell.trim());
      cell = "";
      closed = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      closed = false;
    } else {
      if (closed && !/\s/.test(char)) throw invalidCsv();
      cell += char;
    }
    // This is a totals importer, never a client-record importer.
    if (rows.length > 3 || row.length > OUTCOME_CSV_HEADERS.length)
      throw invalidCsv();
  }
  if (quoted) throw invalidCsv();
  row.push(cell.trim());
  if (row.some((value) => value !== "") || rows.length === 0) rows.push(row);
  while (rows.length && rows[rows.length - 1].every((value) => value === ""))
    rows.pop();
  if (rows.length !== 2) throw invalidCsv();
  return rows;
}

function decimal(raw: string, money: boolean): number | null {
  if (raw === "") return null;
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(raw)) throw invalidCsv();
  if (!money) return Number(raw);
  const [whole, fraction = ""] = raw.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function parseOutcomeCsv(
  text: string,
  now = new Date(),
): OutcomePeriodInput {
  const [rawHeaders, cells] = csvRows(text);
  const headers = rawHeaders.map((header) => header.toLowerCase());
  if (
    cells.length !== headers.length ||
    new Set(headers).size !== headers.length ||
    headers.some((header) => !OUTCOME_CSV_HEADERS.includes(header as never)) ||
    ["start_date", "end_date", "currency"].some(
      (header) => !headers.includes(header),
    )
  )
    throw invalidCsv();
  const row = Object.fromEntries(
    headers.map((header, index) => [header, cells[index]]),
  );
  const value: Record<string, unknown> = {
    startDate: row.start_date,
    endDate: row.end_date,
    currency: row.currency,
    source: row.source || "export",
    baselineReportId: null,
    adminHours: decimal(row.admin_hours || "", false),
  };
  for (const field of OUTCOME_COUNT_FIELDS) {
    const raw = row[field] || "";
    if (raw !== "" && !/^\d{1,7}$/.test(raw)) throw invalidCsv();
    value[field] = raw === "" ? null : Number(raw);
  }
  const moneyHeaders = ["lead_spend", "billed", "collected"] as const;
  for (let i = 0; i < OUTCOME_MONEY_FIELDS.length; i++)
    value[OUTCOME_MONEY_FIELDS[i]] = decimal(row[moneyHeaders[i]] || "", true);
  // Reuse the same bounds, cohort rules and closed-period rules as manual entry.
  return parseOutcomePeriodInput(value, now);
}

export function outcomeCsvTemplate(now = new Date()): string {
  const dates = closedOutcomeDatePreset("last_month", now);
  return `${OUTCOME_CSV_HEADERS.join(",")}\n${[dates.startDate, dates.endDate, "USD", "export", ...Array(9).fill("")].join(",")}\n`;
}
