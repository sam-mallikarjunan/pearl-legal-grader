import {
  OUTCOME_COUNT_FIELDS,
  OUTCOME_CURRENCIES,
  OUTCOME_LIMITS,
  OUTCOME_MONEY_FIELDS,
  OutcomeInputError,
  outcomePeriodsOverlap,
  parseOutcomePeriodInput,
  type OutcomePeriodInput,
} from "./outcomes";

export const OUTCOME_IMPORT_MAX_BYTES = 128 * 1024;
export const OUTCOME_IMPORT_MAX_ROWS = 24;
export const OUTCOME_IMPORT_MAX_COLUMNS = 32;
export const OUTCOME_IMPORT_FIELDS = [
  "startDate",
  "endDate",
  "currency",
  ...OUTCOME_COUNT_FIELDS,
  ...OUTCOME_MONEY_FIELDS,
  "adminHours",
] as const;
export type OutcomeImportField = (typeof OUTCOME_IMPORT_FIELDS)[number];
export type OutcomeColumnMapping = Record<OutcomeImportField, number | null>;
export interface OutcomeImportTable {
  /** Raw cell values are temporary browser memory, never request data. No headers retained. */
  rows: string[][];
  columnCount: number;
  columnLabels: string[];
  suggestedMapping: OutcomeColumnMapping;
}
export interface OutcomeImportOptions {
  dateFormat: "iso" | "us" | "eu";
  moneyUnits: "major" | "minor";
  defaultCurrency: OutcomePeriodInput["currency"];
}
export interface OutcomeImportIssue {
  row: number | null;
  code: string;
  message: string;
}
export interface OutcomeImportPreview {
  periods: OutcomePeriodInput[];
  sourceRows: number[];
  errors: OutcomeImportIssue[];
}
export type OutcomeImportSavedRange = Pick<
  OutcomePeriodInput,
  "startDate" | "endDate"
> & { reserved?: boolean };
export const OUTCOME_IMPORT_LABELS: Record<OutcomeImportField, string> = {
  startDate: "Start date",
  endDate: "End date",
  currency: "Currency",
  inquiries: "New inquiries",
  contacted: "Inquiries contacted",
  booked: "Consultations booked",
  attended: "Consultations attended",
  clients: "Engagements accepted",
  leadSpendMinor: "Acquisition spend",
  cohortBilledMinor: "Period-issued invoices billed",
  cohortCollectedMinor: "Collected on those invoices by period end",
  adminHours: "Your own administrative hours",
};
const aliases: Record<OutcomeImportField, string[]> = {
  startDate: ["startdate", "periodstart", "fromdate", "start"],
  endDate: ["enddate", "periodend", "todate", "end"],
  currency: ["currency", "currencycode"],
  inquiries: [
    "inquiries",
    "newinquiries",
    "inquirycount",
    "leads",
    "newleads",
    "leadcount",
  ],
  contacted: ["contacted", "inquiriescontacted", "contactedcount"],
  booked: ["booked", "consultationsbooked", "bookedcount"],
  attended: ["attended", "consultationsattended", "attendedcount", "showed"],
  clients: [
    "clients",
    "clientcount",
    "newclients",
    "engagements",
    "engagementsaccepted",
  ],
  leadSpendMinor: [
    "leadspend",
    "acquisitionspend",
    "marketingspend",
    "leadspendminor",
    "acquisitioncost",
  ],
  cohortBilledMinor: [
    "billed",
    "invoicesbilled",
    "periodbilled",
    "cohortbilled",
    "cohortbilledminor",
  ],
  cohortCollectedMinor: [
    "collected",
    "invoicescollected",
    "cohortcollected",
    "cohortcollectedminor",
  ],
  adminHours: [
    "adminhours",
    "administrativehours",
    "owneradminhours",
    "owneradministrativehours",
  ],
};
const normalizeHeader = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const identifyingHeader = (s: string) =>
  /^(client|contact|matter|case|customer|person|employee|name|names|firstname|lastname|fullname|email|emailaddress|phone|phonenumber|address|streetaddress|postaladdress|postcode|zipcode|ssn|socialsecuritynumber|dateofbirth|dob|note|notes|comment|comments|remarks|memo|narrative|description|details|freetext|salary|compensation|password|token|apikey|authorization|baselineid|baselinereportid|ownerid|userid|id)$/.test(
    s,
  ) ||
  /(?:email|phone|address|ssn|password|apikey|token|secret|dateofbirth)/.test(
    s,
  ) ||
  /names?$/.test(s) ||
  /(?:client|matter|case|contact|person|employee|customer)(?:name|names|id|ids|number|email|phone|address|details|description|notes)/.test(
    s,
  );
const formatError = () =>
  new Error(
    "Use a CSV or tab-separated sheet of aggregate totals: one header row and 1–24 period rows, with no client, matter, contact or credential columns.",
  );
export function blankOutcomeColumnMapping(): OutcomeColumnMapping {
  return Object.fromEntries(
    OUTCOME_IMPORT_FIELDS.map((field) => [field, null]),
  ) as OutcomeColumnMapping;
}
const columnLetter = (index: number) =>
  index < 26
    ? String.fromCharCode(65 + index)
    : `A${String.fromCharCode(65 + index - 26)}`;

export function parseOutcomeImportTable(
  text: string,
  delimiter: "auto" | "csv" | "tsv" = "auto",
): OutcomeImportTable {
  if (
    new TextEncoder().encode(text).byteLength > OUTCOME_IMPORT_MAX_BYTES ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  )
    throw formatError();
  const input = text.replace(/^\uFEFF/, "");
  const separator =
    delimiter === "tsv" ||
    (delimiter === "auto" && input.split(/\r?\n/, 1)[0].includes("\t"))
      ? "\t"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const pushCell = () => {
    if (cell.length > 128) throw formatError();
    row.push(cell.trim());
    cell = "";
    closed = false;
    if (row.length > OUTCOME_IMPORT_MAX_COLUMNS) throw formatError();
  };
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
      } else if (char === "\r" || char === "\n") throw formatError();
      else cell += char;
    } else if (char === '"') {
      if (cell !== "" || closed) throw formatError();
      quoted = true;
    } else if (char === separator) pushCell();
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      pushCell();
      rows.push(row);
      row = [];
      if (rows.length > OUTCOME_IMPORT_MAX_ROWS + 1) throw formatError();
    } else {
      if (closed && !/\s/.test(char)) throw formatError();
      cell += char;
    }
  }
  if (quoted) throw formatError();
  pushCell();
  if (row.some((v) => v !== "") || rows.length === 0) rows.push(row);
  if (rows.length < 2 || rows.length > OUTCOME_IMPORT_MAX_ROWS + 1)
    throw formatError();
  const headers = rows.shift()!;
  const normalized = headers.map(normalizeHeader);
  if (
    headers.some((h) => h.length > 80) ||
    normalized.some((h) => !h || identifyingHeader(h)) ||
    new Set(normalized).size !== normalized.length
  )
    throw formatError();
  const suggestedMapping = blankOutcomeColumnMapping();
  const columnLabels = normalized.map((header, index) => {
    const field = OUTCOME_IMPORT_FIELDS.find((f) =>
      aliases[f].includes(header),
    );
    return `Column ${columnLetter(index)}${field ? ` · ${OUTCOME_IMPORT_LABELS[field]}` : " · unrecognized header"}`;
  });
  for (const field of OUTCOME_IMPORT_FIELDS) {
    const matches = normalized.flatMap((header, index) =>
      aliases[field].includes(header) ? [index] : [],
    );
    if (matches.length === 1) suggestedMapping[field] = matches[0];
  }
  // Custom header strings are deliberately absent from this returned draft.
  return { rows, columnCount: headers.length, columnLabels, suggestedMapping };
}

const unknown = (value: string) => value === "" || /^null$/i.test(value);
function parseDate(
  value: string,
  format: OutcomeImportOptions["dateFormat"],
): string {
  if (format === "iso") return value;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) throw new Error("Use the selected date format for both dates.");
  const month = format === "us" ? match[1] : match[2],
    day = format === "us" ? match[2] : match[1];
  return `${match[3]}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
function numberValue(
  value: string,
  field: OutcomeImportField,
  units: OutcomeImportOptions["moneyUnits"],
): number | null {
  if (unknown(value)) return null;
  if (OUTCOME_MONEY_FIELDS.includes(field as never)) {
    if (units === "minor") {
      if (!/^\d{1,11}$/.test(value))
        throw new Error(
          "Use whole non-negative minor-unit money amounts, or leave unknown blank.",
        );
      return Number(value);
    }
    if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(value))
      throw new Error(
        "Use plain non-negative money amounts with at most two decimal places, or leave unknown blank.",
      );
    const [whole, fraction = ""] = value.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  }
  if (field === "adminHours") {
    if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(value))
      throw new Error(
        "Use non-negative owner administrative hours with at most two decimal places.",
      );
    return Number(value);
  }
  if (!/^\d{1,7}$/.test(value))
    throw new Error("Use non-negative whole counts, or leave unknown blank.");
  return Number(value);
}
export function previewOutcomeImport(
  table: OutcomeImportTable,
  mapping: OutcomeColumnMapping,
  options: OutcomeImportOptions,
  existing: OutcomeImportSavedRange[] = [],
  now = new Date(),
): OutcomeImportPreview {
  const errors: OutcomeImportIssue[] = [],
    periods: OutcomePeriodInput[] = [],
    sourceRows: number[] = [];
  const issue = (row: number | null, code: string, message: string) =>
    errors.push({ row, code, message });
  const positions = OUTCOME_IMPORT_FIELDS.map((field) => mapping[field]).filter(
    (value) => value !== null,
  );
  if (
    !table.rows.length ||
    table.rows.length > OUTCOME_IMPORT_MAX_ROWS ||
    OUTCOME_IMPORT_FIELDS.some(
      (field) =>
        mapping[field] !== null &&
        (!Number.isInteger(mapping[field]) ||
          mapping[field]! < 0 ||
          mapping[field]! >= table.columnCount),
    ) ||
    new Set(positions).size !== positions.length ||
    mapping.startDate === null ||
    mapping.endDate === null ||
    ![
      ...OUTCOME_COUNT_FIELDS,
      ...OUTCOME_MONEY_FIELDS,
      "adminHours" as const,
    ].some((field) => mapping[field] !== null) ||
    !["iso", "us", "eu"].includes(options.dateFormat) ||
    !["major", "minor"].includes(options.moneyUnits) ||
    !OUTCOME_CURRENCIES.includes(options.defaultCurrency)
  ) {
    issue(
      null,
      "invalid_mapping",
      "Map each needed column once, including both dates and at least one measure. Confirm date format, money units and a supported default currency.",
    );
    return { periods, sourceRows, errors };
  }
  if (
    existing.filter((range) => !range.reserved).length + table.rows.length >
    OUTCOME_LIMITS.periods
  )
    issue(
      null,
      "outcome_capacity",
      "This batch would exceed the 24 saved-period limit. Existing periods will not be overwritten.",
    );
  table.rows.forEach((cells, index) => {
    const row = index + 1;
    if (cells.length !== table.columnCount) {
      issue(
        row,
        "row_shape",
        "The number of cells does not match the header row.",
      );
      return;
    }
    const read = (field: OutcomeImportField) =>
      mapping[field] === null ? "" : cells[mapping[field]!] || "";
    try {
      const raw: Record<string, unknown> = {
        startDate: parseDate(read("startDate"), options.dateFormat),
        endDate: parseDate(read("endDate"), options.dateFormat),
        currency: (unknown(read("currency"))
          ? options.defaultCurrency
          : read("currency")
        ).toUpperCase(),
        source: "export",
        baselineReportId: null,
      };
      for (const field of [
        ...OUTCOME_COUNT_FIELDS,
        ...OUTCOME_MONEY_FIELDS,
        "adminHours" as const,
      ])
        raw[field] = numberValue(read(field), field, options.moneyUnits);
      const period = parseOutcomePeriodInput(raw, now);
      const overlap = existing.find((saved) =>
        outcomePeriodsOverlap(saved, period),
      );
      if (overlap)
        issue(
          row,
          overlap.reserved ? "registered_overlap" : "existing_overlap",
          overlap.reserved
            ? "This period overlaps a registered reporting plan. Use that plan’s locked reporting form instead."
            : "This period overlaps one already saved. Import never overwrites saved periods.",
        );
      for (let previous = 0; previous < periods.length; previous++)
        if (outcomePeriodsOverlap(periods[previous], period))
          issue(
            row,
            "batch_overlap",
            `This period overlaps data row ${sourceRows[previous]}. Use one nonoverlapping period per row.`,
          );
      periods.push(period);
      sourceRows.push(row);
    } catch (error) {
      issue(
        row,
        error instanceof OutcomeInputError
          ? error.code
          : "invalid_mapped_value",
        error instanceof Error
          ? error.message
          : "Check the mapped dates and aggregate numbers.",
      );
    }
  });
  return { periods, sourceRows, errors };
}

export function outcomeImportWizardTemplate(now = new Date()): string {
  const headers = [
    "start_date",
    "end_date",
    "currency",
    "inquiries",
    "clients",
    "admin_hours",
    "contacted",
    "booked",
    "attended",
    "lead_spend",
    "billed",
    "collected",
  ];
  return `${headers.join(",")}\n${[2, 1]
    .map((back) => {
      const start = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1),
        )
          .toISOString()
          .slice(0, 10),
        end = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 0),
        )
          .toISOString()
          .slice(0, 10);
      return [start, end, "USD", ...Array(9).fill("")].join(",");
    })
    .join("\n")}\n`;
}
