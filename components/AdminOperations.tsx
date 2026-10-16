"use client";
import { useEffect, useState } from "react";
type Counter = {
  day: number;
  month: number;
  statuses?: Record<string, number>;
};
type Operations = {
  health: {
    asOf: string;
    scans: Counter;
    signInCodes: Counter;
    reportEmails: Counter | null;
    accounts: { workspaces: number; reports: number };
  };
  limits: Record<
    "scans" | "signInCodes" | "reportEmails",
    { day: number; month: number }
  >;
  note: string;
};
export default function AdminOperations() {
  const [data, setData] = useState<Operations | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(signal?: AbortSignal) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/operations", {
        cache: "no-store",
        signal,
      });
      if (response.status === 401 || response.status === 403) {
        setData(null);
        return;
      }
      if (!response.ok)
        throw new Error("Operational counts could not be loaded.");
      setData(await response.json());
    } catch (e) {
      if (!signal?.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Operational counts could not be loaded.",
        );
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);
  if (!data && !error) return null;
  return (
    <section
      className="page-width progress-page"
      aria-label="Grader operations"
    >
      <div className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">OPERATIONS</p>
            <h2>Keep the pilot bounded.</h2>
          </div>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            Refresh counts
          </button>
        </div>
        {error && <p role="status">{error}</p>}
        {data && (
          <>
            <p className="fine-print">{data.note}</p>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  textAlign: "left",
                  borderSpacing: "0 14px",
                }}
              >
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Today / limit</th>
                    <th>Month / limit</th>
                  </tr>
                </thead>
                <tbody>
                  {(["scans", "signInCodes", "reportEmails"] as const).map(
                    (key) => {
                      const counter = data.health[key];
                      return (
                        <tr key={key}>
                          <th>
                            {key === "scans"
                              ? "Website scans"
                              : key === "signInCodes"
                                ? "Sign-in codes"
                                : "Requested report emails"}
                          </th>
                          <td>
                            {counter ? counter.day : "—"} /{" "}
                            {data.limits[key].day}
                          </td>
                          <td>
                            {counter ? counter.month : "—"} /{" "}
                            {data.limits[key].month}
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
            <p>
              {data.health.accounts.workspaces} private workspaces ·{" "}
              {data.health.accounts.reports} saved reports
            </p>
            <div className="field-grid">
              {(["scans", "reportEmails"] as const).map((key) => (
                <div key={key}>
                  <h3>
                    {key === "scans"
                      ? "Website job status"
                      : "Report email status"}
                  </h3>
                  <p className="fine-print">
                    {Object.entries(data.health[key]?.statuses ?? {})
                      .map(([status, n]) => status + ": " + n)
                      .join(" · ") || "No jobs yet."}
                  </p>
                </div>
              ))}
            </div>
            <p className="fine-print">
              As of {new Date(data.health.asOf).toLocaleString()}. UTC calendar
              periods apply. Account deletion and cached work do not reset the
              aggregate spending allowances.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
