"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  Cloud,
  Download,
  LockKeyhole,
  LogOut,
  Mail,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import {
  ACTION_STATES,
  SCAN_ACCESS_KEY,
  STORAGE_KEY,
  emptyStore,
  isActionProgress,
  parseScanAccess,
  parseStore,
  retainActionProgress,
  type ActionProgress,
  type ActionState,
  type SavedAssessment,
} from "../lib/storage";
import {
  ACCOUNT_CONSENT_TEXT,
  ACCOUNT_CONSENT_VERSION,
  type AccountPreferenceValues,
  type AccountPreferences,
  type CloudActionProgress,
  type CloudReport,
} from "../lib/account/types";
import ActionProgressControls from "./ActionProgressControls";
import WebsiteAIReview from "./WebsiteAIReview";
import LeaderboardEnrollment from "./LeaderboardEnrollment";
import NurtureEnrollment from "./NurtureEnrollment";
import {
  HELP_CONSENT_TEXT,
  HELP_STATUSES,
  HELP_TOPICS,
  HELP_TOPIC_LABELS,
  type HelpRequest,
  type HelpTopic,
} from "../lib/help-requests";

interface AccountUser {
  id: string;
  email: string;
  admin: boolean;
}
interface AccountSession {
  configured: boolean;
  user: AccountUser | null;
  emailConfigured?: boolean;
  reportEmailConfigured?: boolean;
}
const REPORT_EMAIL_STATUSES = [
  "queued",
  "sending",
  "accepted",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "unavailable",
] as const;
interface ReportEmailRequest {
  id: string;
  status: (typeof REPORT_EMAIL_STATUSES)[number];
  requestedAt: string;
  updatedAt: string;
}
export interface AccountPanelProps {
  selectedReport?: SavedAssessment;
  onImport?: (
    report: SavedAssessment,
    progress?: CloudActionProgress[],
  ) => void;
  nextPath?: "/admin";
}

const freshPreferences = (): AccountPreferenceValues => ({
  reminders: false,
  marketing: false,
  benchmarking: false,
  leaderboard: false,
});
const preferenceLabels: Record<keyof AccountPreferenceValues, string> = {
  reminders: "Action reminders",
  marketing: "Marketing email",
  benchmarking: "Private aggregate research",
  leaderboard: "Interest in future recognition",
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function hasCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCredentialField);
  return (
    record(value) &&
    Object.entries(value).some(
      ([key, nested]) =>
        /^(access_?token|refresh_?token|password|secret|authorization|cookie|api_?key|websiteAccess)$/i.test(
          key,
        ) || hasCredentialField(nested),
    )
  );
}
class AccountUiError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
  ) {
    super(message);
  }
}
async function requestJson(
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: init?.signal ?? AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AccountUiError(
      "The connection interrupted this request. It may have reached the server. Check its status or retry the same request.",
      "request_status_unknown",
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AccountUiError(
      "The account service returned an unreadable response. Please try again.",
    );
  }
  if (!response.ok)
    throw new AccountUiError(
      record(data) && data.code === "email_suppressed"
        ? "Email to this account is paused after a bounce or complaint. Your saved reports are still available here."
        : record(data) && typeof data.error === "string"
          ? data.error.slice(0, 500)
          : "This request could not finish. Please try again.",
      record(data) && typeof data.code === "string" ? data.code : undefined,
      response.status,
    );
  if (!record(data))
    throw new AccountUiError(
      "The account service returned an unsupported response.",
    );
  return data;
}
function sessionFrom(value: Record<string, unknown>): AccountSession {
  if (
    typeof value.configured !== "boolean" ||
    (value.user !== null &&
      (!record(value.user) ||
        typeof value.user.id !== "string" ||
        typeof value.user.email !== "string" ||
        typeof value.user.admin !== "boolean"))
  )
    throw new AccountUiError(
      "Your account status could not be read. Refresh to try again.",
    );
  return {
    configured: value.configured,
    user: value.user as AccountUser | null,
    ...(typeof value.emailConfigured === "boolean"
      ? { emailConfigured: value.emailConfigured }
      : {}),
    ...(typeof value.reportEmailConfigured === "boolean"
      ? { reportEmailConfigured: value.reportEmailConfigured }
      : {}),
  };
}
function reportEmailFrom(value: unknown): ReportEmailRequest {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    !REPORT_EMAIL_STATUSES.includes(
      value.status as ReportEmailRequest["status"],
    ) ||
    !timestamp(value.requestedAt) ||
    !timestamp(value.updatedAt)
  )
    throw new AccountUiError(
      "The email request status could not be confirmed. Check its status before requesting another message.",
    );
  return {
    id: value.id,
    status: value.status as ReportEmailRequest["status"],
    requestedAt: value.requestedAt,
    updatedAt: value.updatedAt,
  };
}
function reportEmailLabel(status: ReportEmailRequest["status"]): string {
  switch (status) {
    case "queued":
      return "Requested — waiting to send";
    case "sending":
      return "Sending — provider confirmation pending";
    case "accepted":
      return "Accepted by the email provider — delivery is not confirmed";
    case "delivered":
      return "Email provider reported delivery — readership is not confirmed";
    case "bounced":
      return "Email provider reported a bounce — further email is paused";
    case "complained":
      return "Email provider reported a complaint — further email is paused";
    case "failed":
      return "This request could not be completed";
    case "unavailable":
      return "Email sending is currently unavailable";
  }
}
function helpRequestFrom(value: unknown): HelpRequest {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    !HELP_TOPICS.includes(value.topic as HelpTopic) ||
    !HELP_STATUSES.includes(value.status as HelpRequest["status"]) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    typeof value.consentVersion !== "string" ||
    typeof value.consentText !== "string" ||
    typeof value.contactConsent !== "boolean" ||
    !(value.reportId === null || typeof value.reportId === "string") ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  )
    throw new AccountUiError(
      "A contact request could not be read safely. Refresh before making another request.",
    );
  return {
    id: value.id,
    topic: value.topic as HelpTopic,
    status: value.status as HelpRequest["status"],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    consentVersion: value.consentVersion,
    consentText: value.consentText,
    contactConsent: value.contactConsent,
    reportId: value.reportId as string | null,
    revision: value.revision as number,
  };
}
function cloudReportFrom(value: unknown): CloudReport {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    value.canonical !== true ||
    !timestamp(value.savedAt) ||
    !record(value.snapshot) ||
    hasCredentialField(value.snapshot) ||
    !Array.isArray(value.actionProgress) ||
    value.actionProgress.length > 100
  )
    throw new AccountUiError(
      "A saved account report could not be read safely. Your local data is unchanged.",
    );
  const wrapper = emptyStore();
  wrapper.assessments = [value.snapshot as unknown as SavedAssessment];
  const parsed = parseStore(JSON.stringify(wrapper));
  const snapshot = parsed?.assessments[0];
  if (!snapshot || snapshot.isSample)
    throw new AccountUiError(
      "A saved report is unsupported. Your local data is unchanged.",
    );
  const allowed = new Set(
    snapshot.assessment.actions.map((action) => action.id),
  );
  const actionProgress = value.actionProgress.map((entry: unknown) => {
    if (
      !record(entry) ||
      typeof entry.actionId !== "string" ||
      !allowed.has(entry.actionId) ||
      !ACTION_STATES.includes(entry.state as ActionState) ||
      !Number.isSafeInteger(entry.revision) ||
      (entry.revision as number) < 0 ||
      !timestamp(entry.updatedAt) ||
      (entry.details !== undefined && !isActionProgress(entry.details))
    )
      throw new AccountUiError(
        "Saved action progress could not be read safely.",
      );
    return {
      actionId: entry.actionId,
      state: entry.state as ActionState,
      revision: entry.revision as number,
      updatedAt: entry.updatedAt,
      ...(entry.details ? { details: entry.details as ActionProgress } : {}),
    };
  });
  if (
    new Set(actionProgress.map((entry) => entry.actionId)).size !==
    actionProgress.length
  )
    throw new AccountUiError(
      "Saved action progress contains duplicate actions.",
    );
  return {
    id: value.id,
    canonical: true,
    savedAt: value.savedAt,
    snapshot,
    actionProgress,
  };
}
function preferencesFrom(value: unknown): AccountPreferences {
  if (
    !record(value) ||
    !record(value.values) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    value.consentVersion !== ACCOUNT_CONSENT_VERSION ||
    !(value.updatedAt === null || timestamp(value.updatedAt)) ||
    !Object.keys(freshPreferences()).every(
      (key) =>
        typeof (value.values as Record<string, unknown>)[key] === "boolean",
    )
  )
    throw new AccountUiError(
      "Your saved preferences could not be read. Refresh before making changes.",
    );
  return {
    values: {
      reminders: value.values.reminders as boolean,
      marketing: value.values.marketing as boolean,
      benchmarking: value.values.benchmarking as boolean,
      leaderboard: value.values.leaderboard as boolean,
    },
    revision: value.revision as number,
    updatedAt: value.updatedAt as string | null,
    consentVersion: ACCOUNT_CONSENT_VERSION,
  };
}
function localReportDetails(report: SavedAssessment) {
  const raw = localStorage.getItem(STORAGE_KEY);
  const local = raw ? parseStore(raw) : null;
  const actionStates: Record<string, ActionState> = {};
  const actionProgress: Record<string, ActionProgress> = {};
  for (const action of report.assessment.actions) {
    const key = `${report.id}:${action.id}`;
    if (local?.actionStates[key])
      actionStates[action.id] = local.actionStates[key];
    if (local?.actionProgress?.[key])
      actionProgress[action.id] = local.actionProgress[key];
  }
  let websiteAccess: { scanId: string; accessToken: string } | undefined;
  if (report.websiteScan && local) {
    const access = parseScanAccess(localStorage.getItem(SCAN_ACCESS_KEY));
    const session = local.websiteSessions?.find(
      (entry) =>
        entry.scanId &&
        entry.result &&
        stable(entry.result) === stable(report.websiteScan),
    );
    if (session?.scanId && access?.[session.scanId])
      websiteAccess = {
        scanId: session.scanId,
        accessToken: access[session.scanId],
      };
  }
  return {
    actionStates,
    actionProgress,
    ...(websiteAccess ? { websiteAccess } : {}),
  };
}
function importOnDevice(report: CloudReport) {
  const raw = localStorage.getItem(STORAGE_KEY);
  const store = raw === null ? emptyStore() : parseStore(raw);
  if (!store)
    throw new AccountUiError(
      "This device has unreadable saved data. Download a recovery copy in the grader before importing; nothing was overwritten.",
    );
  const existing = store.assessments.find(
    (entry) => entry.id === report.snapshot.id,
  );
  if (existing && stable(existing) !== stable(report.snapshot))
    throw new AccountUiError(
      "This device has a different report with the same identifier. Its original snapshot was preserved.",
    );
  if (!existing && store.assessments.length >= 40)
    throw new AccountUiError(
      "This device has reached its report allowance. Export your data before removing reports.",
    );
  if (!existing) store.assessments.unshift(structuredClone(report.snapshot));
  for (const progress of report.actionProgress) {
    const key = `${report.snapshot.id}:${progress.actionId}`;
    if (store.actionStates[key] === undefined)
      store.actionStates[key] = progress.state;
    if (progress.details && !store.actionProgress?.[key])
      store.actionProgress = {
        ...store.actionProgress,
        [key]: structuredClone(progress.details),
      };
  }
  store.actionProgress = retainActionProgress(
    store.actionProgress,
    store.assessments,
  );
  if (!parseStore(JSON.stringify(store)))
    throw new AccountUiError(
      "The report could not be imported safely. This device was not changed.",
    );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export default function AccountPanel({
  selectedReport,
  onImport,
  nextPath,
}: AccountPanelProps) {
  const id = useId();
  const [session, setSession] = useState<AccountSession | null>(null);
  const [reports, setReports] = useState<CloudReport[]>([]);
  const [preferences, setPreferences] = useState<AccountPreferences | null>(
    null,
  );
  const [preferenceDraft, setPreferenceDraft] =
    useState<AccountPreferenceValues>(freshPreferences);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [requestedEmail, setRequestedEmail] = useState("");
  const [busy, setBusy] = useState<string | null>("Checking your account");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [reportEmails, setReportEmails] = useState<
    Record<string, ReportEmailRequest[]>
  >({});
  const pendingEmailRequests = useRef<
    Record<string, { requestId: string; outboxId?: string }>
  >({});
  const [helpTopic, setHelpTopic] = useState<HelpTopic>("not_sure");
  const [helpReportId, setHelpReportId] = useState("");
  const [helpConsent, setHelpConsent] = useState(false);
  const [helpRequests, setHelpRequests] = useState<HelpRequest[] | null>(null);
  const pendingHelpRequests = useRef<Record<string, string>>({});

  function clearPrivateRequestState() {
    setReportEmails({});
    pendingEmailRequests.current = {};
    setHelpRequests(null);
    pendingHelpRequests.current = {};
    setHelpConsent(false);
    setHelpReportId("");
  }

  async function loadPrivate(includePreferences = true) {
    const [saved, prefs] = await Promise.all([
      requestJson("/api/account/reports"),
      includePreferences
        ? requestJson("/api/account/preferences")
        : Promise.resolve(null),
    ]);
    if (!Array.isArray(saved.reports) || saved.reports.length > 40)
      throw new AccountUiError("Your saved reports could not be read.");
    const nextReports = saved.reports.map(cloudReportFrom);
    setReports(nextReports);
    if (prefs) {
      const nextPreferences = preferencesFrom(prefs.preferences);
      setPreferences(nextPreferences);
      setPreferenceDraft({ ...nextPreferences.values });
    }
  }
  async function refresh() {
    const next = sessionFrom(await requestJson("/api/auth/me"));
    setSession(next);
    setReports([]);
    setPreferences(null);
    setPreferenceDraft(freshPreferences());
    if (next.user?.id !== session?.user?.id) clearPrivateRequestState();
    if (next.user) await loadPrivate();
    return next;
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void requestJson("/api/auth/me", { signal: controller.signal })
      .then(async (data) => {
        if (!active) return;
        const next = sessionFrom(data);
        setSession(next);
        if (next.user) await loadPrivate();
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Your account could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  async function perform(label: string, job: () => Promise<void>) {
    setBusy(label);
    setError("");
    setErrorCode("");
    setMessage("");
    try {
      await job();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This request could not finish. Please try again.",
      );
      setErrorCode(cause instanceof AccountUiError ? (cause.code ?? "") : "");
      if (cause instanceof AccountUiError && cause.status === 401) {
        setSession((previous) =>
          previous ? { ...previous, user: null } : null,
        );
        setReports([]);
        setPreferences(null);
        setPreferenceDraft(freshPreferences());
        clearPrivateRequestState();
      }
    } finally {
      setBusy(null);
    }
  }
  function requestCode(event: React.FormEvent) {
    event.preventDefault();
    void perform("Requesting your code", async () => {
      const address = email.trim().toLowerCase();
      const result = await requestJson("/api/auth/request", {
        method: "POST",
        body: JSON.stringify({ email: address }),
      });
      if (
        result.accepted !== true ||
        !(result.emailConfigured === true || result.configured === true)
      )
        throw new AccountUiError(
          "Email sign-in is still being configured. Your local reports remain available.",
        );
      setRequestedEmail(address);
      setCode("");
      setMessage(
        "Your code was requested. Check your inbox and spam folder. Delivery can take a moment.",
      );
    });
  }
  function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    void perform("Opening your private workspace", async () => {
      await requestJson("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ email: requestedEmail, code: code.trim() }),
      });
      setCode("");
      setRequestedEmail("");
      const next = await refresh();
      if (!next.user)
        throw new AccountUiError(
          "The code could not establish a verified session. Request a new code and try again.",
        );
      setMessage(
        "You’re signed in. Choose which report to save; other device data stays on this device.",
      );
    });
  }
  function saveSelected(ownerOnly = false) {
    if (!selectedReport || selectedReport.isSample) return;
    void perform("Saving your selected report", async () => {
      const details = localReportDetails(selectedReport);
      const snapshot = structuredClone(selectedReport);
      if (ownerOnly) {
        snapshot.id = crypto.randomUUID();
        delete snapshot.websiteScan;
        delete snapshot.baselineId;
        snapshot.label = `${snapshot.label.slice(0, 175)} (owner-only copy)`;
      }
      const body = {
        report: snapshot,
        actionStates: details.actionStates,
        actionProgress: details.actionProgress,
        ...(!ownerOnly && details.websiteAccess
          ? { websiteAccess: details.websiteAccess }
          : {}),
      };
      const result = await requestJson("/api/account/reports", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const saved = cloudReportFrom(result.report);
      await loadPrivate(false);
      setMessage(
        `${result.created === false ? "This report is already saved" : "Your selected report is saved"} in your private account.${ownerOnly ? " This new copy contains your reported assessment without website evidence; the original local report is unchanged." : ""}`,
      );
      if (saved.snapshot.id === selectedReport.id && result.created === false)
        setMessage(
          "This immutable report is already saved. Its original result is unchanged. Open its account actions below to update progress.",
        );
    });
  }
  function openReport(saved: CloudReport) {
    void perform("Opening your saved report", async () => {
      if (onImport)
        onImport(
          structuredClone(saved.snapshot),
          structuredClone(saved.actionProgress),
        );
      else importOnDevice(saved);
      setMessage(
        "Report opened on this device. Existing local reports and local progress were preserved.",
      );
    });
  }
  function updateCloudAction(
    saved: CloudReport,
    progress: CloudActionProgress,
    state: ActionState,
    details?: ActionProgress,
  ) {
    void perform("Saving action progress", async () => {
      const data = await requestJson(
        `/api/account/reports/${encodeURIComponent(saved.id)}/actions`,
        {
          method: "PATCH",
          body: JSON.stringify({
            actionId: progress.actionId,
            state,
            revision: progress.revision,
            ...(details
              ? { details }
              : progress.details
                ? { details: progress.details }
                : {}),
          }),
        },
      );
      if (!record(data.progress))
        throw new AccountUiError(
          "The progress update could not be confirmed. Refresh before retrying.",
        );
      await loadPrivate(false);
      setMessage(
        "Action progress saved in your account. The report’s assessment score is unchanged.",
      );
    });
  }
  function savePreferences() {
    if (!preferences) return;
    void perform("Saving your choices", async () => {
      const data = await requestJson("/api/account/preferences", {
        method: "PATCH",
        body: JSON.stringify({
          revision: preferences.revision,
          preferences: preferenceDraft,
          consentVersion: ACCOUNT_CONSENT_VERSION,
        }),
      });
      const next = preferencesFrom(data.preferences);
      setPreferences(next);
      setPreferenceDraft({ ...next.values });
      setMessage(
        "Your account choices were saved. No public profile or leaderboard entry was created.",
      );
    });
  }
  function exportAccount() {
    void perform("Preparing your account export", async () => {
      const response = await fetch("/api/account/export", {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const data: unknown = await response.json().catch(() => null);
        throw new AccountUiError(
          record(data) && typeof data.error === "string"
            ? data.error
            : "Your account export could not be prepared.",
        );
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "pearl-grader-account.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        "Your account export was prepared. It contains saved reports, action progress and preference records, without sign-in or scan access credentials.",
      );
    });
  }
  function removeReport(saved: CloudReport) {
    void perform("Removing this account report", async () => {
      await requestJson(
        `/api/account/reports/${encodeURIComponent(saved.id)}`,
        { method: "DELETE" },
      );
      setRemoveId(null);
      await loadPrivate(false);
      setMessage(
        "The report and its action progress were removed from your account. Existing device copies remain available.",
      );
    });
  }
  function requestReportEmail(saved: CloudReport) {
    if (!session?.user || session.reportEmailConfigured !== true) return;
    void perform("Requesting your report email", async () => {
      const key = `${session.user!.id}:${saved.id}`;
      const pending = pendingEmailRequests.current[key] ?? {
        requestId: crypto.randomUUID(),
      };
      pendingEmailRequests.current[key] = pending;
      const data = await requestJson(
        `/api/account/reports/${encodeURIComponent(saved.id)}/email`,
        {
          method: "POST",
          body: JSON.stringify({ requestId: pending.requestId }),
        },
      );
      const emailRequest = reportEmailFrom(data.email);
      pendingEmailRequests.current[key] = {
        ...pending,
        outboxId: emailRequest.id,
      };
      setReportEmails((previous) => ({
        ...previous,
        [saved.id]: [
          emailRequest,
          ...(previous[saved.id] ?? []).filter(
            (item) => item.id !== emailRequest.id,
          ),
        ].slice(0, 10),
      }));
      if (!["queued", "sending"].includes(emailRequest.status))
        delete pendingEmailRequests.current[key];
      setMessage(
        `${reportEmailLabel(emailRequest.status)}. This requested summary goes to your verified account email; marketing preferences are separate.`,
      );
    });
  }
  function checkReportEmail(saved: CloudReport) {
    if (!session?.user) return;
    void perform("Checking requested email status", async () => {
      const data = await requestJson(
        `/api/account/reports/${encodeURIComponent(saved.id)}/email`,
      );
      if (!Array.isArray(data.emails) || data.emails.length > 10)
        throw new AccountUiError(
          "Recent email requests could not be read. Your saved report remains available.",
        );
      const emails = data.emails.map(reportEmailFrom);
      setReportEmails((previous) => ({ ...previous, [saved.id]: emails }));
      const key = `${session.user!.id}:${saved.id}`;
      const pending = pendingEmailRequests.current[key];
      if (
        pending?.outboxId &&
        emails.some(
          (item) =>
            item.id === pending.outboxId &&
            !["queued", "sending"].includes(item.status),
        )
      )
        delete pendingEmailRequests.current[key];
      setMessage(
        emails[0]
          ? `${reportEmailLabel(emails[0].status)}. Provider acceptance does not establish inbox delivery or readership.`
          : "No report email has been requested for this saved report.",
      );
    });
  }
  async function loadHelpRequests() {
    const data = await requestJson("/api/account/help-request");
    if (!Array.isArray(data.requests) || data.requests.length > 100)
      throw new AccountUiError("Your contact requests could not be loaded.");
    setHelpRequests(data.requests.map(helpRequestFrom));
  }
  function requestHelp(event: React.FormEvent) {
    event.preventDefault();
    if (!session?.user || !helpConsent) return;
    void perform("Recording your contact request", async () => {
      const key = `${session.user!.id}:${helpTopic}:${helpReportId}`;
      const requestId = pendingHelpRequests.current[key] ?? crypto.randomUUID();
      pendingHelpRequests.current[key] = requestId;
      const data = await requestJson("/api/account/help-request", {
        method: "POST",
        body: JSON.stringify({
          requestId,
          topic: helpTopic,
          consent: true,
          ...(helpReportId ? { reportId: helpReportId } : {}),
        }),
      });
      const saved = helpRequestFrom(data.request);
      delete pendingHelpRequests.current[key];
      setHelpConsent(false);
      setHelpRequests((previous) =>
        [
          saved,
          ...(previous ?? []).filter((item) => item.id !== saved.id),
        ].slice(0, 100),
      );
      setMessage(
        "Your request for Pearl to contact you was recorded. A call has not been booked. You can withdraw this request here; marketing choices and your grade are unchanged.",
      );
    });
  }
  function withdrawHelp(request: HelpRequest) {
    void perform("Withdrawing your contact request", async () => {
      await requestJson(
        `/api/account/help-request/${encodeURIComponent(request.id)}`,
        { method: "DELETE" },
      );
      await loadHelpRequests();
      setMessage(
        "Your contact request was withdrawn. Your optional marketing choices are unchanged.",
      );
    });
  }
  function deleteWorkspace(event: React.FormEvent) {
    event.preventDefault();
    if (deleteConfirmation !== "DELETE MY ACCOUNT") return;
    void perform("Deleting your account", async () => {
      const result = await requestJson("/api/account", {
        method: "DELETE",
        body: JSON.stringify({ confirm: deleteConfirmation }),
      });
      if (result.ok !== true)
        throw new AccountUiError(
          "Deletion could not be confirmed. Refresh your account before retrying.",
        );
      setSession((previous) => (previous ? { ...previous, user: null } : null));
      setReports([]);
      setPreferences(null);
      setPreferenceDraft(freshPreferences());
      clearPrivateRequestState();
      setDeleteConfirmation("");
      setRequestedEmail("");
      setCode("");
      setMessage(
        "Your account and private workspace were deleted and you were signed out. Device copies are separate; clear them in the grader when you choose. Public website checks, provider logs and backups follow their separate retention.",
      );
    });
  }
  const user = session?.user;
  const prefsChanged =
    preferences && stable(preferenceDraft) !== stable(preferences.values);
  return (
    <div aria-label="Private account workspace">
      <div className="evidence-banner">
        <LockKeyhole size={19} />
        <span>
          Choose what to save. A verified email opens your private workspace; it
          does not verify authority to represent a practice.
        </span>
      </div>
      {busy && (
        <p className="fine-print" role="status">
          {busy}…
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="guide-note" role="status">
          {message}
        </p>
      )}
      {!user ? (
        <>
          <h3>Save your progress privately.</h3>
          <p className="muted">
            You can keep using the grader without an account. Sign in when you
            want to save selected reports and return from another device.
          </p>
          {session?.configured === false ||
          session?.emailConfigured === false ? (
            <p className="guide-note">
              Email sign-in is being configured. Your assessment, print report
              and device data export remain available.
            </p>
          ) : (
            <>
              <form onSubmit={requestCode}>
                <label className="field-label" htmlFor={`${id}-email`}>
                  Your email
                  <input
                    id={`${id}-email`}
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    required
                    maxLength={254}
                    value={email}
                    disabled={!!busy}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <p className="fine-print">
                  We’ll request a sign-in code for this address. This does not
                  subscribe you to marketing.
                </p>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={!!busy || !session?.configured}
                >
                  <Mail size={16} />
                  {requestedEmail
                    ? "Request a new code"
                    : "Request sign-in code"}
                </button>
              </form>
              {requestedEmail && (
                <form onSubmit={verifyCode}>
                  <p className="fine-print">
                    Enter the code requested for {requestedEmail}.
                  </p>
                  <label className="field-label" htmlFor={`${id}-code`}>
                    One-time sign-in code
                    <input
                      id={`${id}-code`}
                      type="text"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]{6,10}"
                      minLength={6}
                      maxLength={10}
                      required
                      value={code}
                      disabled={!!busy}
                      onChange={(event) =>
                        setCode(event.target.value.replace(/\D/g, ""))
                      }
                    />
                  </label>
                  <div className="button-row">
                    <button
                      className="btn btn-primary"
                      type="submit"
                      disabled={!!busy}
                    >
                      Open my workspace <ArrowRight size={16} />
                    </button>
                    <button
                      className="quiet-button"
                      type="button"
                      disabled={!!busy}
                      onClick={() => {
                        setRequestedEmail("");
                        setCode("");
                      }}
                    >
                      Use another email
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="dialog-data-actions">
            <span className="fine-print">
              Signed in as <strong>{user.email}</strong>
            </span>
            <button
              className="quiet-button"
              disabled={!!busy}
              onClick={() =>
                void perform("Signing out", async () => {
                  await requestJson("/api/auth/signout", {
                    method: "POST",
                    body: "{}",
                  });
                  setSession((previous) =>
                    previous ? { ...previous, user: null } : null,
                  );
                  setReports([]);
                  setPreferences(null);
                  setPreferenceDraft(freshPreferences());
                  clearPrivateRequestState();
                  setRequestedEmail("");
                  setCode("");
                  setMessage(
                    "Signed out. Reports already opened on this device remain here until you clear device data.",
                  );
                })
              }
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
          {nextPath === "/admin" &&
            (user.admin ? (
              <a className="btn btn-primary" href="/admin">
                Open scoring administration <ArrowRight size={16} />
              </a>
            ) : (
              <p className="fine-print">
                This account has no scoring-administration access. Your private
                workspace is available below.
              </p>
            ))}
          {selectedReport && (
            <section className="guide-note" aria-label="Save selected report">
              <h3>Save this report</h3>
              <p>
                {selectedReport.label} ·{" "}
                {new Date(selectedReport.createdAt).toLocaleDateString()}
              </p>
              <p className="fine-print">
                Only this report and its action progress are sent to your
                private account. Other local history and browser-only rubric
                edits are not uploaded.
              </p>
              {selectedReport.isSample ? (
                <p className="fine-print">
                  Fictional examples cannot be saved as your practice’s account
                  data.
                </p>
              ) : (
                <div className="button-row">
                  <button
                    className="btn btn-primary"
                    disabled={!!busy}
                    onClick={() => saveSelected()}
                  >
                    <Save size={16} />
                    Save selected report
                  </button>
                  {errorCode === "website_evidence_unverified" && (
                    <button
                      className="btn btn-secondary"
                      disabled={!!busy}
                      onClick={() => saveSelected(true)}
                    >
                      Save a new owner-only copy
                    </button>
                  )}
                </div>
              )}
            </section>
          )}
          <section aria-label="Saved account reports">
            <h3>
              <Cloud size={19} /> Your saved reports
            </h3>
            {reports.length === 0 ? (
              <p className="muted">
                No account reports are shown yet. Open a report in the grader,
                then choose “Save selected report.”
              </p>
            ) : (
              reports.map((saved) => (
                <article className="guide-note" key={saved.id}>
                  <h3>{saved.snapshot.label}</h3>
                  <p className="fine-print">
                    Assessed{" "}
                    {new Date(saved.snapshot.createdAt).toLocaleDateString()} ·{" "}
                    {saved.snapshot.assessment.releaseSnapshot.label} · Private
                  </p>
                  <div className="button-row">
                    <button
                      className="btn btn-secondary btn-small"
                      disabled={!!busy}
                      onClick={() => openReport(saved)}
                    >
                      Open on this device <ArrowRight size={15} />
                    </button>
                    <button
                      className="quiet-button danger"
                      disabled={!!busy}
                      onClick={() =>
                        setRemoveId(removeId === saved.id ? null : saved.id)
                      }
                    >
                      <Trash2 size={14} />
                      Remove account copy
                    </button>
                  </div>
                  <div
                    className="guide-note"
                    aria-label="Requested report email"
                  >
                    <strong>A short summary in your inbox</strong>
                    <p className="fine-print">
                      Request the assessment date, next actions and a private
                      workspace link at your verified account email. Detailed
                      business answers stay in your workspace.
                    </p>
                    <div className="button-row">
                      <button
                        className="btn btn-secondary btn-small"
                        disabled={
                          !!busy ||
                          session?.reportEmailConfigured !== true ||
                          [
                            "queued",
                            "sending",
                            "bounced",
                            "complained",
                          ].includes(reportEmails[saved.id]?.[0]?.status ?? "")
                        }
                        onClick={() => requestReportEmail(saved)}
                      >
                        <Mail size={15} />
                        {pendingEmailRequests.current[`${user.id}:${saved.id}`]
                          ? "Retry same email request"
                          : reportEmails[saved.id]?.[0]
                            ? "Request this summary again"
                            : "Email my next actions"}
                      </button>
                      <button
                        className="quiet-button"
                        disabled={!!busy}
                        onClick={() => checkReportEmail(saved)}
                      >
                        Check email status
                      </button>
                    </div>
                    {session?.reportEmailConfigured !== true && (
                      <p className="fine-print">
                        Report email is being configured. Your saved report and
                        account export are available here.
                      </p>
                    )}
                    {reportEmails[saved.id]?.slice(0, 3).map((request) => (
                      <p className="fine-print" key={request.id} role="status">
                        {new Date(request.requestedAt).toLocaleString()} ·{" "}
                        {reportEmailLabel(request.status)}
                        {["failed", "unavailable"].includes(request.status)
                          ? ". You can explicitly request another summary when email sending is available."
                          : ""}
                      </p>
                    ))}
                  </div>
                  {removeId === saved.id && (
                    <div className="guide-note">
                      <p className="fine-print">
                        Remove this saved account report and its action
                        progress? Your device copies are separate.
                      </p>
                      <button
                        className="btn btn-danger btn-small"
                        disabled={!!busy}
                        onClick={() => removeReport(saved)}
                      >
                        Remove this account report
                      </button>
                      <button
                        className="quiet-button"
                        disabled={!!busy}
                        onClick={() => setRemoveId(null)}
                      >
                        Keep report
                      </button>
                    </div>
                  )}
                  {saved.actionProgress.length > 0 && (
                    <details>
                      <summary className="text-link">
                        Account action progress
                      </summary>
                      {saved.actionProgress.map((progress) => {
                        const action = saved.snapshot.assessment.actions.find(
                          (candidate) => candidate.id === progress.actionId,
                        );
                        return (
                          <div className="guide-note" key={progress.actionId}>
                            <strong>
                              {action?.title ?? "Suggested action"}
                            </strong>
                            <ActionProgressControls
                              state={progress.state}
                              progress={progress.details}
                              disabled={!!busy}
                              outcomePrompt={action?.verification}
                              onChange={(state, details) =>
                                updateCloudAction(
                                  saved,
                                  progress,
                                  state,
                                  details,
                                )
                              }
                            />
                          </div>
                        );
                      })}
                      <p className="fine-print">
                        These are your reported progress states. Updating them
                        does not change the assessment score.
                      </p>
                    </details>
                  )}
                  <WebsiteAIReview reportId={saved.id} />
                </article>
              ))
            )}
          </section>
          <section
            id="request-help"
            className="guide-note"
            aria-label="Request help from Pearl"
          >
            <h3>Want help with the business side?</h3>
            <p className="fine-print">
              Choose a need and ask Pearl to contact you. This preview records
              your request for review; it does not book a call. Asking for help
              never changes your grade or enrolls you in product marketing.
            </p>
            <form onSubmit={requestHelp}>
              <div className="field-grid">
                <label className="field-label" htmlFor={`${id}-help-topic`}>
                  What would you like help with?
                  <select
                    id={`${id}-help-topic`}
                    value={helpTopic}
                    disabled={!!busy}
                    onChange={(event) =>
                      setHelpTopic(event.target.value as HelpTopic)
                    }
                  >
                    {HELP_TOPICS.map((topic) => (
                      <option key={topic} value={topic}>
                        {HELP_TOPIC_LABELS[topic]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label" htmlFor={`${id}-help-report`}>
                  Related saved report (optional)
                  <select
                    id={`${id}-help-report`}
                    value={helpReportId}
                    disabled={!!busy}
                    onChange={(event) => setHelpReportId(event.target.value)}
                  >
                    <option value="">No report reference</option>
                    {reports.map((saved) => (
                      <option key={saved.id} value={saved.id}>
                        {saved.snapshot.label} ·{" "}
                        {new Date(
                          saved.snapshot.createdAt,
                        ).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="preference">
                <span>
                  <strong>Contact me about this request</strong>
                  <small>{HELP_CONSENT_TEXT}</small>
                </span>
                <input
                  type="checkbox"
                  checked={helpConsent}
                  disabled={!!busy}
                  onChange={(event) => setHelpConsent(event.target.checked)}
                />
                <span
                  className={`switch ${helpConsent ? "on" : ""}`}
                  aria-hidden="true"
                >
                  <span />
                </span>
              </label>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={!!busy || !helpConsent}
              >
                Record my contact request <ArrowRight size={16} />
              </button>
            </form>
            <button
              className="text-link"
              disabled={!!busy}
              onClick={() =>
                void perform("Loading your contact requests", loadHelpRequests)
              }
            >
              View or refresh my contact requests
            </button>
            {helpRequests !== null &&
              (helpRequests.length === 0 ? (
                <p className="fine-print">
                  You have no recorded contact requests.
                </p>
              ) : (
                <div>
                  {helpRequests.slice(0, 10).map((request) => (
                    <article className="guide-note" key={request.id}>
                      <strong>{HELP_TOPIC_LABELS[request.topic]}</strong>
                      <p className="fine-print">
                        {new Date(request.createdAt).toLocaleString()} ·{" "}
                        {request.status === "open"
                          ? "Awaiting review"
                          : request.status === "in_review"
                            ? "Under review"
                            : request.status === "contacted"
                              ? "Follow-up recorded"
                              : request.status === "closed"
                                ? "Closed"
                                : "Withdrawn"}
                      </p>
                      {request.contactConsent &&
                        request.status !== "withdrawn" && (
                          <button
                            className="quiet-button"
                            disabled={!!busy}
                            onClick={() => withdrawHelp(request)}
                          >
                            Withdraw contact request
                          </button>
                        )}
                    </article>
                  ))}
                </div>
              ))}
          </section>
          {preferences && (
            <section aria-label="Account choices">
              <h3>Your account choices</h3>
              <p className="fine-print">
                These are separate choices, not requirements for using the
                grader. Device-only interest settings are never copied into
                account consent. Reminders and public recognition are not
                activated by saving a choice alone. Use the separate enrollment
                controls below to publish an anonymous entry or join the weekly
                email series.
              </p>
              <div className="preference-list">
                {(
                  Object.keys(
                    preferenceLabels,
                  ) as (keyof AccountPreferenceValues)[]
                ).map((key) => (
                  <label className="preference" key={key}>
                    <span>
                      <strong>{preferenceLabels[key]}</strong>
                      <small>
                        {key === "marketing" && preferenceDraft.marketing
                          ? "Email is enabled for the permissions you explicitly granted. Joining the course permits only its four lessons. Turn this off to stop all grader marketing."
                          : ACCOUNT_CONSENT_TEXT[key]}
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={preferenceDraft[key]}
                      disabled={!!busy}
                      onChange={(event) =>
                        setPreferenceDraft((previous) => ({
                          ...previous,
                          [key]: event.target.checked,
                        }))
                      }
                    />
                    <span
                      className={`switch ${preferenceDraft[key] ? "on" : ""}`}
                      aria-hidden="true"
                    >
                      <span />
                    </span>
                  </label>
                ))}
              </div>
              <p className="fine-print">
                Your choice is recorded with its date and wording. Withdraw it
                by turning it off and saving. Already published aggregate
                statistics may not be reversible; your private answers and
                practice identity are not published by these choices.
              </p>
              <p className="fine-print">
                Requesting the four-part course permits only those lessons, not
                general product news or offers. Stopping marketing here also
                stops the course. Its separate enrollment never starts again
                just because an email preference is turned on.
              </p>
              <button
                className="btn btn-secondary"
                disabled={!!busy || !prefsChanged}
                onClick={savePreferences}
              >
                Save these choices
              </button>
            </section>
          )}
          <LeaderboardEnrollment
            key={`leaderboard-${user.id}`}
            reports={reports}
          />
          <NurtureEnrollment
            key={`learning-${user.id}-${preferences?.revision ?? 0}`}
            onPreferencesChanged={() => loadPrivate()}
          />
          <div className="dialog-data-actions">
            <button
              className="btn btn-secondary"
              disabled={!!busy}
              onClick={exportAccount}
            >
              <Download size={16} />
              Download account data
            </button>
            <p className="fine-print">
              Account data and device data have separate copies. Removing one
              does not remove the other.
            </p>
          </div>
          <details>
            <summary className="text-link danger">Delete my account</summary>
            <p className="fine-print">
              This deletes your email sign-in account and its private reports,
              action progress, explanations, preferences, leaderboard entry,
              email-series enrollment and contact requests. Download an account
              export first if you want a copy. Device copies remain separate.
              Shared public website checks expire after 30 days; provider logs
              and backups follow their own retention. Hashed abuse-prevention
              counters expire after their separate 48-hour window.
            </p>
            <p className="fine-print">
              A recent sign-in is required. If your sign-in is older than 15
              minutes, sign out and request a new code before deleting.
            </p>
            <form onSubmit={deleteWorkspace}>
              <label className="field-label" htmlFor={`${id}-delete`}>
                Type DELETE MY ACCOUNT to confirm
                <input
                  id={`${id}-delete`}
                  autoComplete="off"
                  value={deleteConfirmation}
                  disabled={!!busy}
                  onChange={(event) =>
                    setDeleteConfirmation(event.target.value)
                  }
                />
              </label>
              <button
                className="btn btn-danger"
                type="submit"
                disabled={!!busy || deleteConfirmation !== "DELETE MY ACCOUNT"}
              >
                Delete my account and private data
              </button>
            </form>
          </details>
        </>
      )}
      <div className="button-row">
        <button
          className="quiet-button"
          disabled={!!busy}
          onClick={() =>
            void perform("Refreshing your account", async () => {
              await refresh();
            })
          }
        >
          <RefreshCw size={15} />
          Refresh account
        </button>
        {!onImport && (
          <a className="text-link" href="/">
            Return to the grader <ArrowRight size={15} />
          </a>
        )}
      </div>
    </div>
  );
}
