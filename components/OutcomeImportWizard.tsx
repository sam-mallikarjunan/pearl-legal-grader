"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  OUTCOME_IMPORT_FIELDS,
  OUTCOME_IMPORT_LABELS,
  OUTCOME_IMPORT_MAX_BYTES,
  blankOutcomeColumnMapping,
  outcomeImportWizardTemplate,
  parseOutcomeImportTable,
  previewOutcomeImport,
  type OutcomeColumnMapping,
  type OutcomeImportOptions,
  type OutcomeImportPreview,
  type OutcomeImportSavedRange,
  type OutcomeImportTable,
} from "../lib/outcome-import-wizard";
import { OUTCOME_CURRENCIES, OUTCOME_MONEY_FIELDS } from "../lib/outcomes";
import "./outcome-import-wizard.css";

export default function OutcomeImportWizard() {
  const id = useId(),
    readGeneration = useRef(0),
    request = useRef<{ payload: string; id: string } | null>(null);
  const [text, setText] = useState(""),
    [delimiter, setDelimiter] = useState<"auto" | "csv" | "tsv">("auto"),
    [table, setTable] = useState<OutcomeImportTable | null>(null),
    [mapping, setMapping] = useState<OutcomeColumnMapping>(
      blankOutcomeColumnMapping,
    ),
    [dateFormat, setDateFormat] = useState<
      OutcomeImportOptions["dateFormat"] | ""
    >(""),
    [moneyUnits, setMoneyUnits] = useState<
      OutcomeImportOptions["moneyUnits"] | ""
    >(""),
    [currency, setCurrency] =
      useState<OutcomeImportOptions["defaultCurrency"]>("USD"),
    [mappingReviewed, setMappingReviewed] = useState(false),
    [totalsReviewed, setTotalsReviewed] = useState(false),
    [preview, setPreview] = useState<OutcomeImportPreview | null>(null),
    [ranges, setRanges] = useState<OutcomeImportSavedRange[] | null>(null),
    [savedCount, setSavedCount] = useState(0),
    [reading, setReading] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [accountMessage, setAccountMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const [outcomes, plans] = await Promise.all([
        fetch("/api/account/outcomes", { cache: "no-store" }),
        fetch("/api/account/outcome-plans", { cache: "no-store" }),
      ]);
      const values = await outcomes.json(),
        planned = await plans.json();
      if (
        !outcomes.ok ||
        !plans.ok ||
        !Array.isArray(values.periods) ||
        !Array.isArray(planned.plans)
      )
        throw new Error();
      setSavedCount(values.periods.length);
      setRanges([
        ...values.periods.map(
          (period: { startDate: string; endDate: string }) => ({
            startDate: period.startDate,
            endDate: period.endDate,
          }),
        ),
        ...planned.plans
          .filter((plan: { status: string }) => plan.status === "registered")
          .map((plan: { startDate: string; endDate: string }) => ({
            startDate: plan.startDate,
            endDate: plan.endDate,
            reserved: true,
          })),
      ]);
      setAccountMessage("");
    } catch {
      setRanges(null);
      setAccountMessage(
        "Your saved periods and registered plans could not load. Reload them before reviewing an import.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
    const changed = () => void load();
    window.addEventListener("grader:outcomes-changed", changed);
    window.addEventListener("grader:outcome-plans-changed", changed);
    return () => {
      readGeneration.current++;
      window.removeEventListener("grader:outcomes-changed", changed);
      window.removeEventListener("grader:outcome-plans-changed", changed);
    };
  }, [load]);
  const resetDraft = () => {
    setTable(null);
    setPreview(null);
    setMappingReviewed(false);
    setTotalsReviewed(false);
    request.current = null;
  };
  function clear() {
    readGeneration.current++;
    resetDraft();
    setText("");
    setMessage("");
    setReading(false);
  }
  function readText(value: string) {
    resetDraft();
    setMessage("");
    try {
      const parsed = parseOutcomeImportTable(value, delimiter);
      setTable(parsed);
      setMapping(parsed.suggestedMapping);
      setDateFormat("");
      setMoneyUnits("");
      setMessage(
        `${parsed.rows.length} aggregate period rows read locally. Review every mapping and choose date format and money units.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "This aggregate sheet could not be read.",
      );
    } finally {
      setText("");
    }
  }
  async function readFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const generation = ++readGeneration.current;
    resetDraft();
    setText("");
    setMessage("");
    if (
      file.size > OUTCOME_IMPORT_MAX_BYTES ||
      !/\.(csv|tsv|txt)$/i.test(file.name)
    ) {
      setMessage(
        "Choose a CSV, TSV or text file no larger than 128 KiB. Spreadsheet workbooks must first be exported to aggregate CSV or TSV.",
      );
      return;
    }
    setReading(true);
    try {
      const contents = await file.text();
      if (generation === readGeneration.current) readText(contents);
    } catch {
      if (generation === readGeneration.current)
        setMessage(
          "The local file could not be read. Try pasting aggregate CSV or TSV instead.",
        );
    } finally {
      if (generation === readGeneration.current) setReading(false);
    }
  }
  function previewTotals() {
    if (!table || !ranges || !dateFormat || !moneyUnits || !mappingReviewed)
      return;
    const result = previewOutcomeImport(
      table,
      mapping,
      { dateFormat, moneyUnits, defaultCurrency: currency },
      ranges,
    );
    setPreview(result);
    setTotalsReviewed(false);
    setTable(null);
    request.current = null;
    setMessage(
      result.errors.length
        ? "Nothing has been imported. Fix the rows or mappings in your source, then read it again."
        : "Review every period shown. Only these normalized aggregate totals will be saved when you confirm.",
    );
  }
  async function save() {
    if (
      !preview ||
      preview.errors.length ||
      !preview.periods.length ||
      !totalsReviewed ||
      !ranges
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const payload = JSON.stringify(preview.periods);
      if (request.current?.payload !== payload)
        request.current = { payload, id: crypto.randomUUID() };
      const response = await fetch("/api/account/outcomes/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: request.current.id,
          periods: preview.periods,
          confirm: "IMPORT REVIEWED TOTALS",
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error ||
            "Nothing was imported. Reload saved periods and review the batch before trying again.",
        );
      if (
        typeof result.created !== "boolean" ||
        typeof result.replayed !== "boolean" ||
        !Array.isArray(result.periodIds) ||
        !Number.isInteger(result.activePeriodCount)
      )
        throw new Error(
          "The import response could not be confirmed. Retry this same reviewed batch to safely check its saved status.",
        );
      setMessage(
        result.replayed
          ? `This import request was already processed. ${result.activePeriodCount} of its periods are still saved. Previously deleted periods have not been recreated.`
          : `${result.periodIds.length} periods imported privately. Existing periods and issued grades are unchanged.`,
      );
      setPreview(null);
      setTotalsReviewed(false);
      request.current = null;
      window.dispatchEvent(new Event("grader:outcomes-changed"));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The import could not be confirmed. Retry the same reviewed batch safely.",
      );
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([outcomeImportWizardTemplate()], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "pearl-aggregate-periods-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  const disabled = busy || reading;
  return (
    <section
      id="import-business-outcomes"
      className="account-subsection outcome-import-wizard"
      aria-labelledby={`${id}-title`}
    >
      <p className="eyebrow">PRIVATE · SPREADSHEET TOTALS</p>
      <h3 id={`${id}-title`}>Bring several business periods at once</h3>
      <p>
        Use one row per closed, nonoverlapping 7–366 day period, up to 24 rows.
        Import adds periods together or saves none; it never replaces existing
        periods or reports a registered plan for you.
      </p>
      <p>
        Use aggregate totals only, without client names, matter or contact
        records. Files are read on this device. Source text, custom headers and
        unused cells are cleared after preview and never uploaded or stored.
        Imported totals are still your report, not independently verified
        records.
      </p>
      <p>
        {savedCount}/24 periods saved. Import does not change research, email,
        contact or leaderboard permissions.
      </p>
      {accountMessage && <p role="status">{accountMessage}</p>}
      <div className="outcome-import-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled}
          onClick={download}
        >
          Download multi-period template
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled}
          onClick={() => void load()}
        >
          Reload saved periods for import
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={clear}
        >
          Clear import draft
        </button>
      </div>
      {!table && !preview && (
        <div className="outcome-import-source">
          <label className="field-label" htmlFor={`${id}-delimiter`}>
            Column separator
            <select
              id={`${id}-delimiter`}
              aria-label="Column separator"
              value={delimiter}
              disabled={disabled}
              onChange={(event) =>
                setDelimiter(event.target.value as typeof delimiter)
              }
            >
              <option value="auto">Detect comma or tab</option>
              <option value="csv">Comma (CSV)</option>
              <option value="tsv">Tab (TSV)</option>
            </select>
          </label>
          <label className="field-label" htmlFor={`${id}-file`}>
            Read aggregate CSV or TSV file locally
            <input
              id={`${id}-file`}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              disabled={disabled}
              onChange={(event) => void readFile(event)}
            />
          </label>
          <label className="field-label" htmlFor={`${id}-paste`}>
            Paste multi-period aggregate CSV or TSV
            <textarea
              id={`${id}-paste`}
              rows={6}
              maxLength={OUTCOME_IMPORT_MAX_BYTES}
              value={text}
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <p className="fine-print">
            128 KiB maximum. A header row is required. Plain numbers only: no
            thousands separators or currency symbols. Empty cells or NULL mean
            unknown; 0 is a known zero. Do not select an Excel workbook or a
            spreadsheet of individual clients.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={disabled || !text.trim()}
            onClick={() => readText(text)}
          >
            {reading ? "Reading locally…" : "Read pasted periods locally"}
          </button>
        </div>
      )}
      {table && (
        <section
          className="outcome-import-mapping"
          aria-labelledby={`${id}-mapping`}
        >
          <h4 id={`${id}-mapping`}>Review columns and units</h4>
          <p>
            {table.rows.length} data rows. Recognized headers suggest mappings;
            check every choice. Other columns are named by spreadsheet position,
            and their original headers and values are not displayed. Unmapped
            columns will be discarded.
          </p>
          <div className="outcome-import-grid">
            {OUTCOME_IMPORT_FIELDS.map((field) => (
              <label
                className="field-label"
                key={field}
                htmlFor={`${id}-map-${field}`}
              >
                Map {OUTCOME_IMPORT_LABELS[field]}
                <select
                  id={`${id}-map-${field}`}
                  aria-label={`Map ${OUTCOME_IMPORT_LABELS[field]}`}
                  value={mapping[field] === null ? "" : String(mapping[field])}
                  disabled={disabled}
                  onChange={(event) => {
                    setMapping((previous) => ({
                      ...previous,
                      [field]:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    }));
                    setMappingReviewed(false);
                  }}
                >
                  <option value="">
                    {field === "currency"
                      ? "Use default currency"
                      : field === "startDate" || field === "endDate"
                        ? "Choose a date column"
                        : "Leave this measure unknown"}
                  </option>
                  {table.columnLabels.map((label, index) => (
                    <option key={index} value={index}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="field-label" htmlFor={`${id}-dates`}>
              Date format for both mapped dates
              <select
                id={`${id}-dates`}
                aria-label="Date format for both mapped dates"
                value={dateFormat}
                disabled={disabled}
                onChange={(event) => {
                  setDateFormat(event.target.value as typeof dateFormat);
                  setMappingReviewed(false);
                }}
              >
                <option value="">Choose explicitly</option>
                <option value="iso">ISO · YYYY-MM-DD</option>
                <option value="us">US · MM/DD/YYYY</option>
                <option value="eu">European · DD/MM/YYYY</option>
              </select>
            </label>
            <label className="field-label" htmlFor={`${id}-money`}>
              Money units in all mapped money columns
              <select
                id={`${id}-money`}
                aria-label="Money units in all mapped money columns"
                value={moneyUnits}
                disabled={disabled}
                onChange={(event) => {
                  setMoneyUnits(event.target.value as typeof moneyUnits);
                  setMappingReviewed(false);
                }}
              >
                <option value="">Choose explicitly</option>
                <option value="major">
                  Ordinary amounts · 123.45 = 123.45
                </option>
                <option value="minor">
                  Whole minor units · 12345 = 123.45
                </option>
              </select>
            </label>
            <label className="field-label" htmlFor={`${id}-currency`}>
              Default currency for blank or unmapped currency
              <select
                id={`${id}-currency`}
                aria-label="Default currency for blank or unmapped currency"
                value={currency}
                disabled={disabled}
                onChange={(event) => {
                  setCurrency(event.target.value as typeof currency);
                  setMappingReviewed(false);
                }}
              >
                {OUTCOME_CURRENCIES.map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="fine-print">
            All dates are UTC calendar days. Acquisition and funnel totals must
            use the same new-inquiry cohort. Billed and collected totals must
            use invoices issued in the period, collected only by that period’s
            end. Use money totals for these invoice columns. Billed or collected
            hours, total deposits and payments on older invoices do not match.
            Use matching totals or leave those columns unmapped. Administrative
            hours are your own, not the team’s combined hours.
          </p>
          <label className="outcome-import-choice">
            <input
              type="checkbox"
              checked={mappingReviewed}
              disabled={disabled}
              onChange={(event) => setMappingReviewed(event.target.checked)}
            />
            <span>I reviewed the columns, date format and money units.</span>
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={
              disabled ||
              !ranges ||
              !dateFormat ||
              !moneyUnits ||
              !mappingReviewed
            }
            onClick={previewTotals}
          >
            Preview mapped periods locally
          </button>
        </section>
      )}
      {preview && (
        <section
          className="outcome-import-results"
          aria-labelledby={`${id}-preview`}
        >
          <h4 id={`${id}-preview`}>Review all normalized periods</h4>
          <p>
            The source file, original headers and unused values have been
            cleared. To change mappings or rows, clear this draft and read your
            source again.
          </p>
          {preview.errors.length > 0 && (
            <div className="outcome-import-errors" role="alert">
              <strong>
                Nothing can be imported until these issues are fixed.
              </strong>
              <ul>
                {preview.errors.map((error, index) => (
                  <li key={index}>
                    {error.row === null ? "Batch" : `Data row ${error.row}`}:{" "}
                    {error.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview.periods.map((period, index) => (
            <article
              key={`${period.startDate}-${index}`}
              className="outcome-import-period"
            >
              <h5>
                Data row {preview.sourceRows[index]}: {period.startDate} to{" "}
                {period.endDate}
              </h5>
              <p>
                {period.currency} · Export-informed owner report · No baseline
                link
              </p>
              <dl className="outcome-import-grid">
                {(["inquiries", "clients", "adminHours"] as const).map(
                  (field) => (
                    <div key={field}>
                      <dt>{OUTCOME_IMPORT_LABELS[field]}</dt>
                      <dd>{period[field] ?? "Unknown"}</dd>
                    </div>
                  ),
                )}
              </dl>
              <details>
                <summary>All aggregate measures for this period</summary>
                <dl className="outcome-import-grid">
                  {OUTCOME_IMPORT_FIELDS.filter(
                    (field) =>
                      !["startDate", "endDate", "currency"].includes(field),
                  ).map((field) => {
                    const value = period[field];
                    return (
                      <div key={field}>
                        <dt>{OUTCOME_IMPORT_LABELS[field]}</dt>
                        <dd>
                          {value === null
                            ? "Unknown"
                            : OUTCOME_MONEY_FIELDS.includes(field as never)
                              ? new Intl.NumberFormat("en-US", {
                                  style: "currency",
                                  currency: period.currency,
                                }).format(Number(value) / 100)
                              : String(value)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </details>
            </article>
          ))}
          {preview.errors.length === 0 && (
            <>
              <label className="outcome-import-choice">
                <input
                  type="checkbox"
                  checked={totalsReviewed}
                  disabled={disabled}
                  onChange={(event) => setTotalsReviewed(event.target.checked)}
                />
                <span>
                  I reviewed every period shown and confirm these are aggregate
                  totals, without client or matter records.
                </span>
              </label>
              <p>
                {preview.periods.length} periods will be added together, or none
                will be saved if any period conflicts. Existing saved periods
                and registered plans are checked again when you save.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={disabled || !ranges || !totalsReviewed}
                onClick={() => void save()}
              >
                {busy ? "Importing…" : "Import reviewed totals"}
              </button>
            </>
          )}
        </section>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
