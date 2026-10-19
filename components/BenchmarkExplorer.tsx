"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Calculator,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  BENCHMARK_CATEGORIES,
  BENCHMARK_CATALOG_VERSION,
  BENCHMARK_REVIEWED_AT,
  calculateCashLockup,
  calculateFunnel,
  parseBenchmarkNumber,
  searchIndustryBenchmarks,
} from "../lib/benchmarks";
import type { PublicBenchmarkSummary } from "../lib/benchmarks-public";

const domainLabels = {
  presence: "Public presence",
  intake: "Intake & opportunity",
  service: "Client experience",
  cash: "Pricing & cash",
  operations: "Practice operations",
  independence: "Owner independence",
};
const money = (n: number | null) =>
  n === null
    ? "Not enough information"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(n);
const percent = (n: number | null) =>
  n === null ? "Not enough information" : `${(n * 100).toFixed(1)}%`;
const days = (n: number | null) =>
  n === null ? "Not enough information" : `${n.toFixed(1)} days`;

export default function BenchmarkExplorer() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [kind, setKind] = useState("All");
  const [peers, setPeers] = useState<PublicBenchmarkSummary | null>(null);
  const [peerState, setPeerState] = useState(
    "Checking whether a comparable group is ready…",
  );
  const [funnelInput, setFunnelInput] = useState({
    spend: "",
    leads: "",
    booked: "",
    showed: "",
    clients: "",
  });
  const [cashInput, setCashInput] = useState({
    workInProgress: "",
    receivables: "",
    annualCollections: "",
  });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/benchmarks", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("unavailable");
        const data = (await res.json()) as PublicBenchmarkSummary;
        if (
          !["descriptive", "insufficient_data"].includes(data.status) ||
          !Array.isArray(data.domains)
        )
          throw new Error("unavailable");
        setPeers(data);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setPeerState(
            "Peer comparisons are temporarily unavailable. The industry references below are still available.",
          );
      });
    return () => controller.abort();
  }, []);
  const cards = searchIndustryBenchmarks(query, category, kind);
  const invalidInput = (input: Record<string, string>) =>
    Object.values(input).some(
      (value) => value.trim() !== "" && parseBenchmarkNumber(value) === null,
    );
  const funnel = invalidInput(funnelInput)
    ? null
    : calculateFunnel({
        spend: parseBenchmarkNumber(funnelInput.spend),
        leads: parseBenchmarkNumber(funnelInput.leads),
        booked: parseBenchmarkNumber(funnelInput.booked),
        showed: parseBenchmarkNumber(funnelInput.showed),
        clients: parseBenchmarkNumber(funnelInput.clients),
      });
  const cash = invalidInput(cashInput)
    ? null
    : calculateCashLockup({
        workInProgress: parseBenchmarkNumber(cashInput.workInProgress),
        receivables: parseBenchmarkNumber(cashInput.receivables),
        annualCollections: parseBenchmarkNumber(cashInput.annualCollections),
      });
  return (
    <div className="benchmark-page">
      <header className="benchmark-nav page-width">
        <Link href="/" className="benchmark-brand">
          Practice Grader<span>by Pearl</span>
        </Link>
        <Link href="/" className="btn btn-secondary">
          <ArrowLeft size={15} />
          Back to my grader
        </Link>
      </header>
      <main id="benchmark-main" className="page-width">
        <section className="benchmark-hero">
          <p className="eyebrow">
            <BookOpen size={15} /> A REFERENCE, WITH THE RECEIPTS
          </p>
          <h1>
            Know what you’re
            <br />
            <em>comparing yourself to.</em>
          </h1>
          <p>
            Explore how firms operate, what each number measures, and where the
            evidence stops. Use a benchmark to choose a useful question for your
            practice.
          </p>
          <div className="benchmark-hero-note">
            <ShieldCheck size={20} />
            <span>
              These references don’t change your grade. Buying a tool, sharing
              your data, or joining a leaderboard never earns extra points.
            </span>
          </div>
          <p className="fine-print">
            Sources reviewed {BENCHMARK_REVIEWED_AT} · Reference edition{" "}
            {BENCHMARK_CATALOG_VERSION}
          </p>
        </section>

        <section
          className="benchmark-peer card"
          aria-labelledby="peer-benchmark-title"
        >
          <div>
            <p className="eyebrow">OUR CONTRIBUTOR DATA</p>
            <h2 id="peer-benchmark-title">Evidence before comparisons.</h2>
          </div>
          <p aria-live="polite">{peers ? peers.explanation : peerState}</p>
          {peers?.status === "descriptive" && (
            <>
              <p className="fine-print">
                {peers.cohortSizeBand} consenting workspaces · Current release{" "}
                {peers.releaseId}
              </p>
              <div className="benchmark-peer-grid">
                {peers.domains.map((domain) => (
                  <div key={domain.id}>
                    <span>{domainLabels[domain.id]}</span>
                    <strong>
                      {domain.medianScore === null
                        ? "Not published"
                        : `${domain.medianScore}/100`}
                    </strong>
                    <small>
                      {domain.status === "suppressed"
                        ? "Fewer than 30 known scores"
                        : `Rounded median · ${domain.cohortSizeBand} workspaces`}
                    </small>
                  </div>
                ))}
              </div>
            </>
          )}
          <details>
            <summary>How contributor comparisons work</summary>
            <ul>
              {(
                peers?.limitations ?? [
                  "At least 30 distinct consenting workspaces; one recent eligible assessment per workspace, using the same scoring release.",
                  "A self-selected, unverified sample cannot describe the whole legal profession.",
                  "Unknown observations stay unknown. Rubric points are not conversion percentages or legal-quality ratings.",
                  "No public subgroup filters, private answers, workspace identifiers, or small counts are published.",
                ]
              ).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        </section>

        <section
          aria-labelledby="industry-reference-title"
          className="benchmark-library"
        >
          <div className="benchmark-section-heading">
            <div>
              <p className="eyebrow">INDUSTRY REFERENCES</p>
              <h2 id="industry-reference-title">
                Twelve useful starting points.
              </h2>
            </div>
            <p>
              Observed results describe a sample. Guidance describes a
              recommended technical threshold. Neither is a universal firm
              target.
            </p>
          </div>
          <div className="benchmark-filters">
            <label className="benchmark-search">
              <span>Search references</span>
              <div>
                <Search size={17} />
                <input
                  type="search"
                  placeholder="Try intake, cash, or AI"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </label>
            <label>
              <span>Topic</span>
              <select
                aria-label="Topic"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="All">All topics</option>
                {BENCHMARK_CATEGORIES.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Evidence type</span>
              <select
                aria-label="Evidence type"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="All">All evidence</option>
                <option value="observed">Observed results</option>
                <option value="guidance">Technical guidance</option>
              </select>
            </label>
          </div>
          <p className="fine-print benchmark-result-count" aria-live="polite">
            {cards.length} reference{cards.length === 1 ? "" : "s"} shown
          </p>
          <div className="benchmark-card-grid">
            {cards.map((card) => (
              <article
                key={card.id}
                className="card benchmark-reference"
                id={`reference-${card.id}`}
              >
                <div className="benchmark-card-tags">
                  <span>{card.category}</span>
                  <span
                    className={
                      card.kind === "guidance" ? "guidance" : "observed"
                    }
                  >
                    {card.kind === "guidance" ? "Guidance" : "Observed"}
                  </span>
                </div>
                <h3>{card.title}</h3>
                <strong className="benchmark-value">{card.displayValue}</strong>
                <p className="benchmark-unit">{card.unit}</p>
                <p>{card.definition}</p>
                <div className="benchmark-next">
                  <span className="eyebrow">A USEFUL NEXT STEP</span>
                  <p>{card.nextAction}</p>
                </div>
                <details>
                  <summary>Source, denominator & limitations</summary>
                  <dl>
                    <dt>Evidence</dt>
                    <dd>{card.evidence}</dd>
                    <dt>Group</dt>
                    <dd>{card.cohort}</dd>
                    <dt>Period</dt>
                    <dd>{card.period}</dd>
                    <dt>Denominator</dt>
                    <dd>{card.denominator}</dd>
                    <dt>Limit</dt>
                    <dd>{card.limitation}</dd>
                  </dl>
                  <p className="fine-print">
                    Accessed {card.source.accessedAt}
                  </p>
                </details>
                <a
                  className="benchmark-source"
                  href={card.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {card.source.title}
                  <ArrowUpRight size={15} aria-label="opens in new tab" />
                </a>
              </article>
            ))}
          </div>
          {cards.length === 0 && (
            <p className="benchmark-no-results">
              No references match. Try a shorter search or choose all topics.
            </p>
          )}
        </section>

        <section
          className="benchmark-calculators"
          aria-labelledby="benchmark-calculator-title"
        >
          <div className="benchmark-section-heading">
            <div>
              <p className="eyebrow">
                <Calculator size={15} /> YOUR OWN NUMBERS
              </p>
              <h2 id="benchmark-calculator-title">
                Understand your funnel and cash.
              </h2>
            </div>
            <p>
              Calculator entries stay in this page’s memory. They aren’t sent to
              our server or saved to your account. Blank and zero-denominator
              results remain unknown.
            </p>
          </div>
          <div className="benchmark-calculator-grid">
            <div className="card benchmark-calculator">
              <h3>One inquiry cohort</h3>
              <p>
                Use the same source, cohort, and follow-up window for every
                stage. Count unique inquiries. Only include spending
                attributable to this cohort; costs below are acquisition
                spending, not fully loaded client economics.
              </p>
              <div className="benchmark-input-grid">
                {(
                  [
                    {
                      key: "spend",
                      label: "Attributed acquisition spend (USD)",
                    },
                    { key: "leads", label: "Unique inquiries" },
                    { key: "booked", label: "Consultations booked" },
                    { key: "showed", label: "Consultations attended" },
                    {
                      key: "clients",
                      label: "Clients retained from those consultations",
                    },
                  ] as const
                ).map(({ key, label }) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min="0"
                      max="1000000000000"
                      step={key === "spend" ? "0.01" : "1"}
                      inputMode={key === "spend" ? "decimal" : "numeric"}
                      value={funnelInput[key]}
                      onChange={(e) =>
                        setFunnelInput((previous) => ({
                          ...previous,
                          [key]: e.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <div aria-live="polite">
                {!funnel ? (
                  <p className="benchmark-input-error">
                    Check the cohort: counts must be whole numbers, and a later
                    stage cannot exceed an earlier stage.
                  </p>
                ) : (
                  <dl className="benchmark-results">
                    <dt>Spend / inquiry</dt>
                    <dd>{money(funnel.costPerLead)}</dd>
                    <dt>Spend / retained client</dt>
                    <dd>{money(funnel.costPerClient)}</dd>
                    <dt>Booked / inquiries</dt>
                    <dd>{percent(funnel.bookingRate)}</dd>
                    <dt>Attended / booked</dt>
                    <dd>{percent(funnel.showRate)}</dd>
                    <dt>Retained / attended</dt>
                    <dd>{percent(funnel.retentionRate)}</dd>
                    <dt>Retained / inquiries</dt>
                    <dd>{percent(funnel.leadToClientRate)}</dd>
                  </dl>
                )}
              </div>
              <button
                className="text-link"
                onClick={() =>
                  setFunnelInput({
                    spend: "",
                    leads: "",
                    booked: "",
                    showed: "",
                    clients: "",
                  })
                }
              >
                Clear funnel entries
              </button>
            </div>
            <div className="card benchmark-calculator">
              <h3>Cash tied up in work</h3>
              <p>
                Use work-in-progress and receivables balances from the same
                date, in the same currency. Divide each balance by collections
                from the previous full fiscal year, then multiply by 365.
              </p>
              <div className="benchmark-input-grid">
                {(
                  [
                    {
                      key: "workInProgress",
                      label: "Unbilled work value (USD)",
                    },
                    { key: "receivables", label: "Unpaid invoices (USD)" },
                    {
                      key: "annualCollections",
                      label: "Previous fiscal year’s collections (USD)",
                    },
                  ] as const
                ).map(({ key, label }) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min="0"
                      max="1000000000000"
                      step="0.01"
                      inputMode="decimal"
                      value={cashInput[key]}
                      onChange={(e) =>
                        setCashInput((previous) => ({
                          ...previous,
                          [key]: e.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <div aria-live="polite">
                {cash ? (
                  <dl className="benchmark-results">
                    <dt>Unbilled work lockup</dt>
                    <dd>{days(cash.realizationDays)}</dd>
                    <dt>Collection lockup</dt>
                    <dd>{days(cash.collectionDays)}</dd>
                    <dt>Total lockup</dt>
                    <dd>{days(cash.totalDays)}</dd>
                  </dl>
                ) : (
                  <p className="benchmark-input-error">
                    Use nonnegative amounts in a consistent currency.
                  </p>
                )}
              </div>
              <p className="fine-print">
                This stock-to-flow estimate is not average payment time or a
                forecast. It is sensitive to seasonality, growth, valuation of
                unbilled work, and your fee model. No full prior year? Leave it
                unknown.
              </p>
              <a
                className="benchmark-source"
                href="https://www.clio.com/resources/legal-trends/2023-report/read-online/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Formula: Clio 2023 Legal Trends Report
                <ArrowUpRight size={15} />
              </a>
              <button
                className="text-link"
                onClick={() =>
                  setCashInput({
                    workInProgress: "",
                    receivables: "",
                    annualCollections: "",
                  })
                }
              >
                Clear cash entries
              </button>
            </div>
          </div>
        </section>
        <footer className="benchmark-footer">
          <p>
            A benchmark should help you make a decision. Your goals, fee model,
            practice area, and evidence still matter.
          </p>
          <Link href="/" className="btn btn-primary">
            Choose my next action
            <ArrowUpRight size={15} />
          </Link>
        </footer>
      </main>
    </div>
  );
}
