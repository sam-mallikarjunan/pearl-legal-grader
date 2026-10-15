"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Globe2,
  Info,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  SCAN_ACCESS_KEY,
  parseScanAccess,
  type PreviewStore,
  type WebsiteScanSession,
} from "../lib/storage";
import {
  isWebsiteScanResult,
  type WebsiteScanResult,
} from "../lib/website/types";
import "./website-scan.css";

const terminal = (status: string) =>
  ["complete", "partial", "unavailable"].includes(status);
class ScanRequestError extends Error {}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const scanStatus = (value: unknown): value is WebsiteScanSession["status"] =>
  typeof value === "string" &&
  ["queued", "running", "complete", "partial", "unavailable"].includes(value);
const friendlyStage = (value: string) =>
  ({
    checking: "Checking the public address",
    queued: "Waiting to begin",
    inspecting: "Inspecting public pages",
    performance: "Measuring mobile performance",
    evaluating: "Preparing the findings",
    complete: "Website checks complete",
    partial: "Some checks could not be completed",
    unavailable: "Website check unavailable",
  })[value] ?? value;

/** One poller per page, kept separate from immutable issued assessment snapshots. */
export function useWebsiteScans(
  store: PreviewStore,
  setStore: Dispatch<SetStateAction<PreviewStore>>,
  loaded: boolean,
  canSave: boolean,
) {
  const access = useRef<Record<string, string>>({});
  const generation = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const [accessWarning, setAccessWarning] = useState("");
  const [accessReady, setAccessReady] = useState(false);
  const [accessRevision, setAccessRevision] = useState(0);
  const accessWritable = useRef(true);
  const upsert = useCallback(
    (session: WebsiteScanSession) =>
      setStore((previous) => ({
        ...previous,
        websiteSessions: [
          session,
          ...(previous.websiteSessions ?? []).filter(
            (entry) => entry.localId !== session.localId,
          ),
        ].slice(0, 30),
      })),
    [setStore],
  );
  const update = useCallback(
    (localId: string, change: Partial<WebsiteScanSession>) =>
      setStore((previous) => ({
        ...previous,
        websiteSessions: (previous.websiteSessions ?? []).map((entry) =>
          entry.localId === localId ? { ...entry, ...change } : entry,
        ),
      })),
    [setStore],
  );

  useEffect(() => {
    try {
      const parsed = parseScanAccess(localStorage.getItem(SCAN_ACCESS_KEY));
      if (parsed) access.current = parsed;
      else {
        accessWritable.current = false;
        setAccessWarning(
          "Saved scan access could not be read and has been preserved. Existing questionnaire history is unaffected. Clear this device’s data to reset scan access.",
        );
      }
    } catch {
      accessWritable.current = false;
      setAccessWarning(
        "Scan access cannot be saved in this browser. Keep this tab open to see the result.",
      );
    }
    setAccessReady(true);
    return () => {
      generation.current += 1;
      controllers.current.forEach((controller) => controller.abort());
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    setStore((previous) => ({
      ...previous,
      websiteSessions: (previous.websiteSessions ?? []).map((entry) =>
        entry.status === "starting"
          ? {
              ...entry,
              status: "unavailable",
              stage: "Request interrupted",
              error:
                "The page closed before the scan request was confirmed. Start a new check to try again.",
            }
          : entry,
      ),
    }));
  }, [loaded, setStore]);

  const pending = (store.websiteSessions ?? []).filter(
    (entry) => entry.scanId && !terminal(entry.status),
  );
  const signature = pending
    .map((entry) => `${entry.localId}:${entry.scanId}`)
    .join("|");
  useEffect(() => {
    if (!loaded || !accessReady || !canSave || !signature) return;
    let stopped = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const localControllers = new Set<AbortController>();
    for (const session of pending) {
      const token = access.current[session.scanId!];
      if (!token) {
        update(session.localId, {
          status: "unavailable",
          stage: "Scan access unavailable",
          error:
            "The private access key for this scan is no longer on this device. Start a new website check.",
        });
        continue;
      }
      let failures = 0;
      const poll = async () => {
        if (stopped) return;
        const controller = new AbortController();
        controllers.current.add(controller);
        localControllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), 25_000);
        try {
          const response = await fetch(
            `/api/scans/${encodeURIComponent(session.scanId!)}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
              signal: controller.signal,
            },
          );
          const data: unknown = await response.json();
          if (stopped) return;
          if (!response.ok) {
            if ([401, 403, 404, 410].includes(response.status)) {
              update(session.localId, {
                status: "unavailable",
                stage: "Scan no longer accessible",
                error:
                  object(data) && typeof data.error === "string"
                    ? data.error.slice(0, 1000)
                    : "This scan is no longer accessible. Start a new website check.",
              });
              return;
            }
            throw new Error("Temporary scan status failure");
          }
          if (
            !object(data) ||
            !scanStatus(data.status) ||
            (data.result !== undefined && !isWebsiteScanResult(data.result)) ||
            (["complete", "partial"].includes(data.status) &&
              !isWebsiteScanResult(data.result)) ||
            (isWebsiteScanResult(data.result) &&
              data.result.status !== data.status)
          )
            throw new Error("Unreadable scan status");
          failures = 0;
          const result = data.result as WebsiteScanResult | undefined;
          update(session.localId, {
            status: data.status,
            stage:
              typeof data.stage === "string"
                ? data.stage.slice(0, 300)
                : data.status,
            result,
            error:
              typeof data.error === "string"
                ? data.error.slice(0, 1000)
                : undefined,
          });
          if (!terminal(data.status)) timeouts.push(setTimeout(poll, 3000));
        } catch {
          if (stopped) return;
          failures += 1;
          if (failures >= 5)
            update(session.localId, {
              status: "unavailable",
              stage: "Connection interrupted",
              error:
                "We couldn’t retrieve the scan after several attempts. Your questionnaire is still available. Retry checking the scan status or start a new check.",
            });
          else
            timeouts.push(setTimeout(poll, Math.min(15_000, failures * 3000)));
        } finally {
          clearTimeout(timeout);
          controllers.current.delete(controller);
          localControllers.delete(controller);
        }
      };
      void poll();
    }
    return () => {
      stopped = true;
      timeouts.forEach(clearTimeout);
      localControllers.forEach((controller) => controller.abort());
    };
    // Pollers use the immutable handle; updates to progress must not restart requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, loaded, accessReady, accessRevision, canSave, update]);

  const begin = useCallback(
    async (url: string, practiceId: string, force = false) => {
      if (!canSave || !accessReady) return;
      const localId = crypto.randomUUID();
      const session: WebsiteScanSession = {
        localId,
        practiceId,
        url,
        createdAt: new Date().toISOString(),
        status: "starting",
        stage: "Starting website checks",
      };
      upsert(session);
      const requestGeneration = generation.current;
      const controller = new AbortController();
      controllers.current.add(controller);
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch("/api/scans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, force }),
          signal: controller.signal,
        });
        const data: unknown = await response.json();
        if (requestGeneration !== generation.current) return;
        if (!response.ok)
          throw new ScanRequestError(
            object(data) && typeof data.error === "string"
              ? data.error.slice(0, 1000)
              : "The website check could not start. Please try again later.",
          );
        if (
          !object(data) ||
          typeof data.scanId !== "string" ||
          !/^[a-zA-Z0-9_-]{8,150}$/.test(data.scanId) ||
          typeof data.accessToken !== "string" ||
          !/^[a-zA-Z0-9_-]{24,512}$/.test(data.accessToken) ||
          !scanStatus(data.status) ||
          (data.result !== undefined && !isWebsiteScanResult(data.result)) ||
          (["complete", "partial"].includes(data.status) &&
            !isWebsiteScanResult(data.result)) ||
          (isWebsiteScanResult(data.result) &&
            data.result.status !== data.status)
        )
          throw new ScanRequestError(
            "The scan service returned an unreadable response. No website grade has been created.",
          );
        access.current = { ...access.current, [data.scanId]: data.accessToken };
        const ids = Object.keys(access.current);
        if (ids.length > 35)
          access.current = Object.fromEntries(
            ids.slice(-35).map((id) => [id, access.current[id]]),
          );
        if (accessWritable.current) {
          try {
            localStorage.setItem(
              SCAN_ACCESS_KEY,
              JSON.stringify(access.current),
            );
          } catch {
            setAccessWarning(
              "Scan access could not be saved. Keep this tab open until the scan finishes.",
            );
          }
        }
        setAccessRevision((n) => n + 1);
        upsert({
          ...session,
          scanId: data.scanId,
          status: data.status,
          stage:
            typeof data.stage === "string"
              ? data.stage.slice(0, 300)
              : data.status,
          cached: data.cached === true,
          result: data.result as WebsiteScanResult | undefined,
          error:
            typeof data.error === "string"
              ? data.error.slice(0, 1000)
              : undefined,
        });
      } catch (error) {
        if (requestGeneration !== generation.current) return;
        update(localId, {
          status: "unavailable",
          stage: "Website check unavailable",
          error:
            error instanceof ScanRequestError
              ? error.message
              : "The scan service could not be reached in time. Your questionnaire still works; try the website check again later.",
        });
      } finally {
        clearTimeout(timeout);
        controllers.current.delete(controller);
      }
    },
    [accessReady, canSave, update, upsert],
  );

  const clear = () => {
    generation.current += 1;
    controllers.current.forEach((controller) => controller.abort());
    access.current = {};
    accessWritable.current = true;
    setAccessWarning("");
    try {
      localStorage.removeItem(SCAN_ACCESS_KEY);
    } catch {}
  };
  const retryStatus = (session: WebsiteScanSession) => {
    if (session.scanId && access.current[session.scanId]) {
      update(session.localId, {
        status: "queued",
        stage: "Checking scan status",
        error: undefined,
      });
      setAccessRevision((n) => n + 1);
    }
  };
  return { begin, clear, retryStatus, accessWarning };
}

export default function WebsiteScanPanel({
  session,
  snapshot,
  enabled,
  compact = false,
  isSample = false,
  noSite = false,
  onRescan,
  onSaveSnapshot,
  onRetryStatus,
  onConfirmContext,
}: {
  session?: WebsiteScanSession;
  snapshot?: WebsiteScanResult;
  enabled: boolean;
  compact?: boolean;
  isSample?: boolean;
  noSite?: boolean;
  onRescan?: () => void;
  onSaveSnapshot?: () => void;
  onRetryStatus?: () => void;
  onConfirmContext?: (result: WebsiteScanResult) => void;
}) {
  const result = session?.result ?? snapshot;
  const running = session && !terminal(session.status);
  const newerResult =
    result &&
    result !== snapshot &&
    result.completedAt !== snapshot?.completedAt;
  if (isSample) return null;
  if (!session && !snapshot && compact) return null;
  const inspected =
    result?.pages.filter((page) => page.status === "inspected").length ?? 0;
  const fixes =
    result?.findings
      .filter(
        (finding) => finding.status === "needs_attention" && finding.action,
      )
      .slice(0, 3) ?? [];
  const strengths =
    result?.findings.filter((finding) => finding.status === "pass") ?? [];
  return (
    <section
      className={`website-scan card ${compact ? "scan-compact" : ""}`}
      aria-label="Public website checks"
    >
      <div className="scan-heading">
        <span className="scan-icon">
          <Globe2 size={22} />
        </span>
        <div>
          <span className="eyebrow">PUBLIC WEBSITE CHECKS</span>
          <h2>
            {running
              ? "Your website check is under way."
              : result
                ? "What your public website shows."
                : noSite
                  ? "No website? Start with your practice."
                  : "A separate view of your website."}
          </h2>
        </div>
        {result && !running && (
          <span
            className={`tag ${result.status === "partial" ? "scan-tag-partial" : ""}`}
          >
            {result.status === "partial"
              ? "Partial evidence"
              : result.status === "unavailable"
                ? "Unavailable"
                : "Live evidence"}
          </span>
        )}
      </div>
      {running && (
        <div className="scan-progress" role="status">
          <LoaderCircle className="scan-spinner" size={20} />
          <div>
            <strong>{friendlyStage(session.stage)}</strong>
            <p>
              Keep answering while we inspect a few public pages. Unavailable
              checks won’t count as failures.
            </p>
          </div>
        </div>
      )}
      {compact && result && !running && (
        <div className="scan-summary">
          <CheckCircle2 size={18} />
          <p>
            {inspected} public {inspected === 1 ? "page" : "pages"} inspected.{" "}
            {result.status === "partial"
              ? "Some checks were unavailable. "
              : ""}
            Your website evidence will appear separately in your report.
          </p>
        </div>
      )}
      {!running && !result && (
        <p className="muted">
          {session?.error ??
            (noSite
              ? "Website checks are inapplicable to you for now. Your owner-reported assessment is still useful, and this won’t lower it."
              : enabled
                ? "Check your public website for clear next steps, search basics and mobile performance. The check never changes your questionnaire answers."
                : "Live website checks are not available on this deployment yet. You can still complete the practice assessment; no website score will be invented.")}
        </p>
      )}
      {session?.error && result && (
        <p className="scan-caution">
          <Info size={16} />
          {session.error}
        </p>
      )}
      {!compact && result && (
        <>
          <div className="scan-score-grid">
            <div className="scan-score">
              <strong>
                {result.score === null ? "—" : Math.round(result.score)}
                <small>
                  {result.score === null
                    ? "not enough evidence"
                    : "/100 website evidence"}
                </small>
              </strong>
              <p>
                This score covers observable website checks. It does not measure
                legal skill, operating practices or revenue.
              </p>
            </div>
            <div className="scan-coverage">
              <strong>{Math.round(result.coverage)}% evidence coverage</strong>
              <span>
                {result.measuredChecks} of {result.totalChecks} checks measured
                · {inspected} pages inspected
              </span>
              <div className="scan-coverage-track">
                <span style={{ width: `${result.coverage}%` }} />
              </div>
              <span>
                Checked{" "}
                {new Date(result.completedAt).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                {session?.cached ? " · Recent cached evidence" : ""}
              </span>
            </div>
          </div>
          {(result.status !== "complete" || result.warnings.length > 0) && (
            <div className="scan-caution">
              <Info size={18} />
              <div>
                <strong>
                  {result.status === "unavailable"
                    ? "We couldn’t complete this inspection."
                    : "Read this with its evidence limits."}
                </strong>
                {result.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
                {result.status === "partial" && (
                  <p>
                    Missing checks are excluded from the measured score. A
                    partial scan can look stronger than a complete scan, so
                    compare coverage too.
                  </p>
                )}
              </div>
            </div>
          )}
          {fixes.length > 0 && (
            <div className="scan-fixes">
              <h3>Practical website improvements</h3>
              <div className="scan-fix-grid">
                {fixes.map((finding, index) => (
                  <article key={finding.id} className="scan-fix">
                    <span className="scan-step">{index + 1}</span>
                    <span className="tag">{finding.action!.effort} effort</span>
                    <h4>{finding.action!.title}</h4>
                    <p>{finding.action!.why}</p>
                    <ol>
                      {finding.action!.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </article>
                ))}
              </div>
            </div>
          )}
          {strengths.length > 0 && (
            <div className="scan-strengths">
              <h3>Found on the inspected pages</h3>
              {strengths.slice(0, 4).map((finding) => (
                <div key={finding.id}>
                  <CheckCircle2 size={17} />
                  <span>
                    <strong>{finding.title}</strong>
                    <p>{finding.summary}</p>
                  </span>
                </div>
              ))}
            </div>
          )}
          <details className="scan-evidence">
            <summary>
              Inspect every finding and its evidence <ChevronDown size={17} />
            </summary>
            {result.findings.map((finding) => (
              <article key={finding.id}>
                <div className="scan-finding-title">
                  <strong>{finding.title}</strong>
                  <span className={`scan-status scan-${finding.status}`}>
                    {
                      {
                        pass: "Observed",
                        needs_attention: "Needs attention",
                        unknown: "Unmeasured",
                        info: "Context",
                      }[finding.status]
                    }
                  </span>
                </div>
                <p>{finding.summary}</p>
                {finding.limitation && (
                  <p className="fine-print">{finding.limitation}</p>
                )}
                {finding.evidence.map((evidence, index) => (
                  <div
                    className="scan-source"
                    key={`${evidence.sourceUrl}:${index}`}
                  >
                    <a
                      href={evidence.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {evidence.sourceUrl}
                      <ExternalLink size={12} />
                    </a>
                    <span>{evidence.detail}</span>
                  </div>
                ))}
              </article>
            ))}
          </details>
          <div className="scan-detail-grid">
            <details className="scan-evidence">
              <summary>
                Pages and mobile measurements <ChevronDown size={17} />
              </summary>
              {result.pages.map((page, index) => (
                <div
                  key={`${page.kind}:${page.url}:${index}`}
                  className="scan-source"
                >
                  <a href={page.url} target="_blank" rel="noreferrer">
                    {page.kind} · {page.status}
                    <ExternalLink size={12} />
                  </a>
                  <span>{page.reason ?? page.signals?.title ?? page.url}</span>
                </div>
              ))}
              <h4>Mobile Lighthouse laboratory audit</h4>
              {result.performance.provider && (
                <p className="fine-print">
                  Run by{" "}
                  {result.performance.provider === "google-pagespeed"
                    ? "Google PageSpeed Insights"
                    : "our Lighthouse runner on Vercel"}
                  {result.performance.lighthouseVersion
                    ? ` · Lighthouse ${result.performance.lighthouseVersion}`
                    : ""}
                  .
                </p>
              )}
              {result.performance.status === "unavailable" ? (
                <p>
                  {result.performance.reason ??
                    "The mobile performance measurement was unavailable. No performance grade has been invented."}
                </p>
              ) : (
                <>
                  <div className="scan-metrics">
                    {Object.entries(result.performance.categories).map(
                      ([category, score]) => (
                        <span key={category}>
                          <strong>{score}</strong>
                          {category}
                        </span>
                      ),
                    )}
                  </div>
                  {result.performance.metrics.map((metric) => (
                    <p key={metric.id}>
                      {metric.label}:{" "}
                      {metric.unit === "ms"
                        ? `${(metric.value / 1000).toFixed(2)} s`
                        : metric.value.toFixed(3)}
                    </p>
                  ))}
                  <p className="fine-print">
                    Laboratory measurements reflect one simulated mobile visit.
                    They are not real-user field data or a full accessibility
                    assessment.
                  </p>
                </>
              )}
            </details>
            <details className="scan-evidence">
              <summary>
                Detected tools and public clues <ChevronDown size={17} />
              </summary>
              <p>
                Presence shows what we detected, not whether a tool works or is
                configured well.
              </p>
              {result.technologies.length ? (
                <ul>
                  {result.technologies.map((tool) => (
                    <li key={`${tool.name}:${tool.category}`}>
                      <strong>{tool.name}</strong> · {tool.category}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No supported tool fingerprints found. This is not a penalty.
                </p>
              )}
              <h4>Suggestions for you to confirm</h4>
              <p>
                {[
                  result.suggestedContext.firmName,
                  ...result.suggestedContext.practiceAreas,
                  ...result.suggestedContext.locations,
                ]
                  .filter(Boolean)
                  .join(" · ") ||
                  "No reliable public practice clues were extracted."}
              </p>
              <p className="fine-print">
                These are public text clues, not verified licensing or service
                jurisdictions. We never replace your answers automatically.
              </p>
            </details>
          </div>
          {result.limitations.length > 0 && (
            <details className="scan-evidence">
              <summary>
                Scope, limitations and versions <ChevronDown size={17} />
              </summary>
              <ul>
                {result.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
              <p className="fine-print">
                {result.scannerVersion} · {result.rubricVersion}
              </p>
            </details>
          )}
        </>
      )}
      {compact &&
        result &&
        onConfirmContext &&
        (result.suggestedContext.practiceAreas.length > 0 ||
          result.suggestedContext.locations.length > 0) && (
          <div className="scan-context">
            <p>
              <strong>Public clues to review:</strong>{" "}
              {[
                ...result.suggestedContext.practiceAreas,
                ...result.suggestedContext.locations,
              ].join(" · ")}
              . These may be incomplete.
            </p>
            <button
              className="text-link"
              onClick={() => onConfirmContext(result)}
            >
              Review suggested practice details <ArrowRight size={14} />
            </button>
          </div>
        )}
      <div className="scan-footer">
        <p>
          <ShieldCheck size={14} />
          Public scan access expires after 30 days; expired server records are
          removed during scheduled cleanup. Saved reports and questionnaire
          answers stay in this browser until you clear them.
        </p>
        <div className="button-row">
          {newerResult && onSaveSnapshot && (
            <button className="btn btn-primary" onClick={onSaveSnapshot}>
              Save website results <ArrowRight size={15} />
            </button>
          )}
          {!running &&
            session?.scanId &&
            session.status === "unavailable" &&
            !result &&
            onRetryStatus && (
              <button className="quiet-button" onClick={onRetryStatus}>
                Retry status
              </button>
            )}
          {!running && enabled && !noSite && onRescan && (
            <button className="btn btn-secondary" onClick={onRescan}>
              <RefreshCw size={15} />
              {result || session
                ? "Run a new website check"
                : "Check my website"}
            </button>
          )}
        </div>
      </div>
      {newerResult && onSaveSnapshot && (
        <p className="fine-print">
          Save creates a new dated report. Earlier grades and website evidence
          stay as they were issued.
        </p>
      )}
    </section>
  );
}
