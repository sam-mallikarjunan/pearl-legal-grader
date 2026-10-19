"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  FileCheck2,
  Globe2,
  HeartHandshake,
  Info,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  Scale,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import AdminPanel from "./AdminPanel";
import AccountPanel from "./AccountPanel";
import ActionProgressControls from "./ActionProgressControls";
import PeerContextPanel from "./PeerContextPanel";
import WebsiteScanPanel, { useWebsiteScans } from "./WebsiteScanPanel";
import type { WebsiteScanResult } from "../lib/website/types";
import { DEFAULT_RELEASE } from "../lib/catalog";
import { canonicalJson } from "../lib/configuration";
import { assessPractice, getQuestionApplicability } from "../lib/scoring";
import { SAMPLE_ANSWERS, SAMPLE_CONTEXT, SAMPLE_CONTROLS } from "../lib/demo";
import {
  emptyStore,
  normalizeWebsite,
  parseStore,
  retainActionProgress,
  STORAGE_KEY,
  type ActionState,
  type ActionProgress,
  type PreviewPreferences,
  type PreviewStore,
  type SavedAssessment,
} from "../lib/storage";
import type { CloudActionProgress } from "../lib/account/types";
import {
  DOMAIN_IDS,
  type Answers,
  type ControlAnswers,
  type ControlId,
  type DomainAssessment,
  type DomainId,
  type Goal,
  type PracticeContext,
  type PrioritizedAction,
  type ReleaseSnapshot,
} from "../lib/types";

type View =
  | "home"
  | "assessment"
  | "report"
  | "progress"
  | "methodology"
  | "admin";
type Modal = "preferences" | "clear" | "email" | "sharing" | null;
const GOALS: {
  id: Goal;
  label: string;
  description: string;
  domain: DomainId;
  icon: LucideIcon;
}[] = [
  {
    id: "more_clients",
    label: "Find suitable clients",
    description: "Make the most of your capacity",
    domain: "intake",
    icon: Target,
  },
  {
    id: "better_conversion",
    label: "Improve inquiry handling",
    description: "Give the right opportunities a next step",
    domain: "intake",
    icon: HeartHandshake,
  },
  {
    id: "collect_cash",
    label: "Improve cash collection",
    description: "Bring clarity to pricing and billing",
    domain: "cash",
    icon: Wallet,
  },
  {
    id: "less_admin",
    label: "Spend less time on admin",
    description: "Reduce work that gets in the way",
    domain: "operations",
    icon: ListChecks,
  },
  {
    id: "sustainable_practice",
    label: "Build a sustainable practice",
    description: "Create more control and breathing room",
    domain: "independence",
    icon: ShieldCheck,
  },
];
const ICONS: Record<DomainId, LucideIcon> = {
  presence: Globe2,
  intake: Target,
  service: HeartHandshake,
  cash: Wallet,
  operations: ListChecks,
  independence: ShieldCheck,
};
const EMPTY_CONTEXT: PracticeContext = {
  stage: "established",
  practiceArea: "",
  jurisdiction: "",
  goal: "less_admin",
  feeModel: "hourly",
  capacityAdditionalMatters: null,
  websiteStatus: "unknown",
  usesAI: null,
  handlesClientFunds: null,
};
const CONTROL_TITLES: Record<ControlId, string> = {
  deadline: "Are deadlines recorded, checked and covered during absence?",
  mfa: "Is multifactor authentication in place for important business accounts?",
  ai_review:
    "Does a qualified person review AI-generated legal work before reliance?",
  client_funds:
    "Do you have a reconciliation process appropriate to the client funds you handle?",
};
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const rounded = (value: number | null) =>
  value === null ? "—" : Math.round(value).toString();
const goalFor = (context: PracticeContext) =>
  GOALS.find((g) => g.id === context.goal) ?? GOALS[3];
const band = (value: number | null) =>
  value === null
    ? "More evidence needed"
    : value < 40
      ? "A useful place to start"
      : value < 70
        ? "Build consistency"
        : value < 90
          ? "A working foundation"
          : "A reviewed process";

function ScoreRing({
  score,
  small = false,
}: {
  score: number | null;
  small?: boolean;
}) {
  const radius = 43,
    circumference = 2 * Math.PI * radius;
  return (
    <div
      className={`score-ring ${small ? "small" : ""}`}
      role="img"
      aria-label={
        score === null
          ? "Score unavailable until enough applicable questions are answered"
          : `Reported readiness ${Math.round(score)} out of 100`
      }
    >
      <svg viewBox="0 0 104 104" aria-hidden="true">
        <circle cx="52" cy="52" r={radius} className="ring-track" />
        <circle
          cx="52"
          cy="52"
          r={radius}
          className="ring-fill"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - (score ?? 0) / 100)}
        />
      </svg>
      <div>
        <strong>{rounded(score)}</strong>
        <span>{score === null ? "incomplete" : "out of 100"}</span>
      </div>
    </div>
  );
}

function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function ActionCard({
  action,
  index,
  state,
  setState,
  progress,
}: {
  action: PrioritizedAction;
  index: number;
  state: ActionState;
  setState: (s: ActionState, progress?: ActionProgress) => void;
  progress?: ActionProgress;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className={`action-card ${state === "done" ? "action-done" : ""}`}>
      <div className="action-number">
        {state === "done" ? (
          <Check size={19} />
        ) : (
          String(index + 1).padStart(2, "0")
        )}
      </div>
      <div className="action-body">
        <div className="action-kicker">
          <span className={`priority ${action.priority}`}>
            {action.priority === "high"
              ? "Start here"
              : action.priority === "medium"
                ? "Build next"
                : "Explore"}
          </span>
          <span>
            <Clock3 size={13} /> {action.effort}
          </span>
        </div>
        <h3>{action.title}</h3>
        <p>{action.summary}</p>
        <button
          className="text-link"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? "Hide action guide" : "See how to do it"}
          <ChevronDown size={15} className={expanded ? "rotated" : ""} />
        </button>
        {expanded && (
          <div className="action-guide">
            <ol>
              {action.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className="guide-note">
              <strong>Done looks like</strong>
              <p>{action.definitionOfDone}</p>
            </div>
            <div className="guide-note">
              <strong>Then check whether it helped</strong>
              <p>{action.verification}</p>
            </div>
            <p className="fine-print">
              Why this is prioritized: {action.priorityReasons.join(" · ")}
            </p>
          </div>
        )}
        <ActionProgressControls
          state={state}
          progress={progress}
          onChange={setState}
          outcomePrompt={action.verification}
        />
      </div>
    </article>
  );
}

export default function GraderApp({
  websiteScansEnabled = false,
  publishedRelease = DEFAULT_RELEASE,
  configurationAvailable = true,
}: {
  websiteScansEnabled?: boolean;
  publishedRelease?: ReleaseSnapshot;
  configurationAvailable?: boolean;
}) {
  const [store, setStore] = useState<PreviewStore>(() => ({
    ...emptyStore(),
    activeRelease: structuredClone(publishedRelease),
    releaseHistory: [structuredClone(publishedRelease)],
  }));
  const [loaded, setLoaded] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const [unreadableData, setUnreadableData] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState("");
  const [website, setWebsite] = useState("");
  const [websiteError, setWebsiteError] = useState("");
  const [context, setContext] = useState<PracticeContext>(EMPTY_CONTEXT);
  const [answers, setAnswers] = useState<Answers>({});
  const [controls, setControls] = useState<ControlAnswers>({});
  const [wizardStep, setWizardStep] = useState(0);
  const [module, setModule] = useState<DomainId>("operations");
  const [assessmentRelease, setAssessmentRelease] =
    useState<ReleaseSnapshot>(publishedRelease);
  const [isSample, setIsSample] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [practiceId, setPracticeId] = useState("");
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [detailDomain, setDetailDomain] = useState<DomainId | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const websiteScans = useWebsiteScans(
    store,
    setStore,
    loaded,
    !unreadableData,
  );
  const [contextSuggestion, setContextSuggestion] =
    useState<WebsiteScanResult | null>(null);
  const [suggestedPracticeArea, setSuggestedPracticeArea] = useState("");
  const [suggestedJurisdiction, setSuggestedJurisdiction] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = parseStore(raw);
        if (saved)
          setStore({
            ...saved,
            activeRelease: structuredClone(publishedRelease),
            releaseHistory: [
              structuredClone(publishedRelease),
              ...saved.releaseHistory.filter(
                (item) => item.id !== publishedRelease.id,
              ),
            ].slice(0, 30),
          });
        else {
          setUnreadableData(raw);
          setStorageWarning(
            "Saved data could not be read and has been preserved. Download a recovery copy, then clear saved data to resume saving.",
          );
        }
      }
    } catch {
      setStorageWarning(
        "Browser storage is unavailable. You can use the preview, but changes will not persist after this session.",
      );
    }
    setLoaded(true);
  }, [publishedRelease]);
  useEffect(() => {
    if (loaded && !unreadableData) {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            ...store,
            actionProgress: retainActionProgress(
              store.actionProgress,
              store.assessments,
            ),
          }),
        );
      } catch {
        setStorageWarning(
          "Changes could not be saved in this browser. Download your data before leaving.",
        );
      }
    }
  }, [store, loaded, unreadableData]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (loaded) {
      window.scrollTo({ top: 0, behavior: "auto" });
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [view, wizardStep, loaded]);

  const current =
    store.assessments.find((a) => a.id === selectedId) ??
    store.assessments[0] ??
    null;
  const report = current?.assessment;
  const draftScan = (store.websiteSessions ?? []).find(
    (session) => session.practiceId === practiceId,
  );
  const latestForPractice =
    current &&
    store.assessments.find((entry) => entry.practiceId === current.practiceId)
      ?.id === current.id;
  const reportScan =
    current &&
    !current.isSample &&
    report?.contextSnapshot.websiteStatus === "has_site" &&
    latestForPractice
      ? (store.websiteSessions ?? []).find(
          (session) => session.practiceId === current.practiceId,
        )
      : undefined;
  const resumableScan = (store.websiteSessions ?? []).find(
    (session) =>
      !store.assessments.some(
        (entry) => entry.practiceId === session.practiceId,
      ),
  );
  const goal = goalFor(context);
  const example = useMemo(
    () =>
      assessPractice({
        context: SAMPLE_CONTEXT,
        answers: SAMPLE_ANSWERS,
        controls: SAMPLE_CONTROLS,
        release: DEFAULT_RELEASE,
      }),
    [],
  );
  const activeModuleQuestions = assessmentRelease.questions.filter(
    (q) =>
      q.domain === module &&
      q.weight > 0 &&
      getQuestionApplicability(q, context).applicable,
  );
  const applicableControls = [
    "deadline",
    "mfa",
    ...(context.usesAI === true ? ["ai_review"] : []),
    ...(context.handlesClientFunds === true ? ["client_funds"] : []),
  ] as ControlId[];

  function notify(message: string) {
    setToast(message);
  }
  function navigate(next: View) {
    setView(next);
    setDetailDomain(null);
  }
  function start(noSite = false) {
    let normalized =
      noSite || !website.trim() ? null : normalizeWebsite(website);
    if (!noSite && website.trim() && !normalized) {
      setWebsiteError(
        "Enter a website such as yourfirm.com, or choose the no-website option.",
      );
      return;
    }
    if (normalized && websiteScansEnabled) {
      const publicUrl = new URL(normalized);
      if (publicUrl.port) {
        setWebsiteError(
          "Use a standard public address without a custom port, or clear the URL to continue without website checks.",
        );
        return;
      }
      if (publicUrl.search || publicUrl.hash) {
        publicUrl.search = "";
        publicUrl.hash = "";
        normalized = publicUrl.href;
        setWebsite(normalized);
        notify(
          "Query parameters and page fragments were removed before checking the public page.",
        );
      }
    }
    setWebsiteError("");
    setContext({
      ...EMPTY_CONTEXT,
      websiteStatus: noSite ? "no_site" : normalized ? "has_site" : "unknown",
      websiteUrl: normalized ?? undefined,
    });
    setAnswers({});
    setControls({});
    setIsSample(false);
    const newPracticeId = crypto.randomUUID();
    setPracticeId(newPracticeId);
    setBaselineId(null);
    setWizardStep(0);
    setModule("operations");
    setAssessmentRelease(structuredClone(publishedRelease));
    navigate("assessment");
    if (normalized && websiteScansEnabled)
      void websiteScans.begin(normalized, newPracticeId);
  }
  function saveAssessment(
    nextContext = context,
    nextAnswers = answers,
    nextControls = controls,
    sample = isSample,
    release = assessmentRelease,
    baseline = baselineId,
  ) {
    const assessment = assessPractice({
      context: nextContext,
      answers: nextAnswers,
      controls: nextControls,
      release,
    });
    const entry: SavedAssessment = {
      id: crypto.randomUUID(),
      practiceId: sample ? "sample-juniper" : practiceId || crypto.randomUUID(),
      baselineId: baseline ?? undefined,
      createdAt: new Date().toISOString(),
      label: sample
        ? "Juniper Family Law"
        : nextContext.practiceArea
          ? `${nextContext.practiceArea} practice`
          : "Your practice",
      isSample: sample,
      assessment,
      websiteScan:
        !sample && nextContext.websiteStatus === "has_site"
          ? structuredClone(
              draftScan?.result ??
                (current?.practiceId === practiceId
                  ? current.websiteScan
                  : undefined),
            )
          : undefined,
    };
    setStore((s) => {
      const assessments = [entry, ...s.assessments].slice(0, 30);
      return {
        ...s,
        assessments,
        actionProgress: retainActionProgress(s.actionProgress, assessments),
      };
    });
    setSelectedId(entry.id);
    navigate("report");
  }
  function exploreSample() {
    saveAssessment(
      SAMPLE_CONTEXT,
      SAMPLE_ANSWERS,
      SAMPLE_CONTROLS,
      true,
      publishedRelease,
      null,
    );
  }
  function saveWebsiteSnapshot() {
    if (!current || current.isSample || !reportScan?.result) return;
    const newId = crypto.randomUUID();
    const entry: SavedAssessment = {
      ...structuredClone(current),
      id: newId,
      baselineId: current.id,
      createdAt: new Date().toISOString(),
      websiteScan: structuredClone(reportScan.result),
    };
    setStore((previous) => ({
      ...previous,
      assessments: [entry, ...previous.assessments].slice(0, 30),
      actionProgress: retainActionProgress(
        {
          ...previous.actionProgress,
          ...Object.fromEntries(
            Object.entries(previous.actionProgress ?? {})
              .filter(([key]) => key.startsWith(`${current.id}:`))
              .map(([key, value]) => [
                key.replace(`${current.id}:`, `${newId}:`),
                value,
              ]),
          ),
        },
        [entry, ...previous.assessments].slice(0, 30),
      ),
      actionStates: {
        ...previous.actionStates,
        ...Object.fromEntries(
          Object.entries(previous.actionStates)
            .filter(([key]) => key.startsWith(`${current.id}:`))
            .map(([key, value]) => [
              key.replace(`${current.id}:`, `${newId}:`),
              value,
            ]),
        ),
      },
    }));
    setSelectedId(newId);
    notify(
      "Website evidence saved in a new report. Your earlier report is unchanged.",
    );
  }
  function rescanReport() {
    if (
      !current ||
      current.isSample ||
      report?.contextSnapshot.websiteStatus !== "has_site" ||
      !report.contextSnapshot.websiteUrl
    )
      return;
    if (!latestForPractice) {
      const entry: SavedAssessment = {
        ...structuredClone(current),
        id: crypto.randomUUID(),
        baselineId: current.id,
        createdAt: new Date().toISOString(),
      };
      setStore((previous) => ({
        ...previous,
        assessments: [entry, ...previous.assessments].slice(0, 30),
        actionProgress: retainActionProgress(
          {
            ...previous.actionProgress,
            ...Object.fromEntries(
              Object.entries(previous.actionProgress ?? {})
                .filter(([key]) => key.startsWith(`${current.id}:`))
                .map(([key, value]) => [
                  key.replace(`${current.id}:`, `${entry.id}:`),
                  value,
                ]),
            ),
          },
          [entry, ...previous.assessments].slice(0, 30),
        ),
        actionStates: {
          ...previous.actionStates,
          ...Object.fromEntries(
            Object.entries(previous.actionStates)
              .filter(([key]) => key.startsWith(`${current.id}:`))
              .map(([key, value]) => [
                key.replace(`${current.id}:`, `${entry.id}:`),
                value,
              ]),
          ),
        },
      }));
      setSelectedId(entry.id);
      notify(
        "A new report is open for this website check. The earlier report is unchanged.",
      );
    }
    void websiteScans.begin(
      report.contextSnapshot.websiteUrl,
      current.practiceId,
      true,
    );
  }
  function resumeWebsiteCheck() {
    if (!resumableScan) return;
    setPracticeId(resumableScan.practiceId);
    setContext({
      ...EMPTY_CONTEXT,
      websiteStatus: "has_site",
      websiteUrl: resumableScan.url,
    });
    setAnswers({});
    setControls({});
    setIsSample(false);
    setBaselineId(null);
    setAssessmentRelease(structuredClone(publishedRelease));
    setWizardStep(0);
    setModule("operations");
    navigate("assessment");
  }
  function continueAssessment(domain: DomainId) {
    if (!current) return start();
    setContext(structuredClone(current.assessment.contextSnapshot));
    setAnswers(structuredClone(current.assessment.answersSnapshot));
    setControls(structuredClone(current.assessment.controlsSnapshot));
    setIsSample(current.isSample);
    setPracticeId(current.practiceId);
    setBaselineId(current.id);
    setAssessmentRelease(structuredClone(current.assessment.releaseSnapshot));
    setModule(domain);
    setWizardStep(1);
    navigate("assessment");
  }
  function publish(release: ReleaseSnapshot) {
    setStore((s) => ({
      ...s,
      activeRelease: structuredClone(release),
      releaseHistory: [structuredClone(release), ...s.releaseHistory].slice(
        0,
        30,
      ),
    }));
    notify(
      "Rubric published in this browser. Existing assessments are unchanged.",
    );
  }
  function exportData() {
    const blob = new Blob(
      [
        unreadableData ??
          JSON.stringify(
            {
              ...store,
              actionProgress: retainActionProgress(
                store.actionProgress,
                store.assessments,
              ),
            },
            null,
            2,
          ),
      ],
      {
        type: "application/json",
      },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "practice-grader-preview.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function clearData() {
    websiteScans.clear();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setStore({
      ...emptyStore(),
      activeRelease: structuredClone(publishedRelease),
      releaseHistory: [structuredClone(publishedRelease)],
    });
    setSelectedId(null);
    setContext(EMPTY_CONTEXT);
    setAnswers({});
    setControls({});
    setWebsite("");
    setWebsiteError("");
    setIsSample(false);
    setPracticeId("");
    setBaselineId(null);
    setWizardStep(0);
    setModule("operations");
    setAssessmentRelease(structuredClone(publishedRelease));
    setUnreadableData(null);
    setModal(null);
    setStorageWarning("");
    setContextSuggestion(null);
    navigate("home");
    notify("Assessment history and preferences cleared from this preview.");
  }
  function setAction(
    actionId: string,
    state: ActionState,
    progress?: ActionProgress,
  ) {
    if (current)
      setStore((s) => ({
        ...s,
        actionStates: {
          ...s.actionStates,
          [`${current.id}:${actionId}`]: state,
        },
        actionProgress: {
          ...retainActionProgress(s.actionProgress, s.assessments),
          [`${current.id}:${actionId}`]: progress ?? {
            updatedAt: new Date().toISOString(),
          },
        },
      }));
  }
  function importAccountReport(
    entry: SavedAssessment,
    progress: CloudActionProgress[] = [],
  ) {
    const existing = store.assessments.find((item) => item.id === entry.id);
    if (existing && canonicalJson(existing) !== canonicalJson(entry))
      throw new Error(
        "A different local report has this identifier. Export it before importing another copy.",
      );
    setStore((previous) => {
      const assessments = existing
        ? previous.assessments
        : [structuredClone(entry), ...previous.assessments].slice(0, 30);
      const actionStates = { ...previous.actionStates };
      const actionProgress = retainActionProgress(
        previous.actionProgress,
        assessments,
      );
      for (const action of progress) {
        const key = `${entry.id}:${action.actionId}`;
        if (actionStates[key] === undefined) actionStates[key] = action.state;
        if (!actionProgress[key] && action.details)
          actionProgress[key] = structuredClone(action.details);
      }
      return { ...previous, assessments, actionStates, actionProgress };
    });
    setSelectedId(entry.id);
    setModal(null);
    navigate("report");
    notify(
      "Your account report is open on this device. Existing reports and local progress were preserved.",
    );
  }
  function updatePreference(key: keyof PreviewPreferences, value: boolean) {
    setStore((s) => ({
      ...s,
      preferences: { ...s.preferences, [key]: value },
    }));
  }

  function renderHome() {
    const cash = example.domains.find((d) => d.id === "cash")!;
    return (
      <>
        <section className="hero page-width">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="tiny-line" />A BUSINESS CHECKUP FOR INDEPENDENT
              LAWYERS
            </div>
            <h1>
              A stronger practice.
              <br />
              <em>On your terms.</em>
            </h1>
            <p className="hero-description">
              Your legal work is your craft. Get a clearer picture of the
              business around it—and a practical plan for what to improve next.
            </p>
            <form
              className="url-form"
              onSubmit={(e) => {
                e.preventDefault();
                start();
              }}
            >
              <label htmlFor="website">Start with your website</label>
              <div className="url-input-row">
                <Globe2 size={20} />
                <input
                  id="website"
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="yourfirm.com"
                  value={website}
                  onChange={(e) => {
                    setWebsite(e.target.value);
                    setWebsiteError("");
                  }}
                  aria-describedby="url-help"
                />
                <button className="btn btn-primary" type="submit">
                  Find my starting point
                  <ArrowRight size={17} />
                </button>
              </div>
              {websiteError && (
                <p className="field-error" role="alert">
                  {websiteError}
                </p>
              )}
              <p id="url-help" className="fine-print">
                {websiteScansEnabled
                  ? "We’ll inspect a few public pages while you answer. Public scan access expires after 30 days. Your business answers stay on this device until you choose to save a report to a private account."
                  : "Live website checks are not available on this deployment yet. Your URL provides context for the practice assessment."}
              </p>
            </form>
            <button className="text-link no-site" onClick={() => start(true)}>
              I don’t have a website yet
              <ArrowRight size={15} />
            </button>
            <div className="hero-assurances">
              <span>
                <Check size={15} />
                No account needed
              </span>
              <span>
                <Check size={15} />
                Your goals come first
              </span>
              <span>
                <Check size={15} />
                Saved on this device
              </span>
            </div>
            {resumableScan && (
              <div className="scan-resume">
                <Globe2 size={19} />
                <div>
                  <strong>Your website check is saved on this device.</strong>
                  <p>{resumableScan.url}</p>
                  <button className="text-link" onClick={resumeWebsiteCheck}>
                    Return to the checkup <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="hero-visual">
            <div className="visual-orbit orbit-one" />
            <div className="visual-orbit orbit-two" />
            <div className="sample-report-card">
              <div className="sample-card-top">
                <span className="sample-dot" />
                ILLUSTRATIVE REPORT
                <span className="tag tag-outline">Fictional practice</span>
              </div>
              <div className="sample-firm">
                <div className="firm-avatar">J</div>
                <div>
                  <strong>Juniper Family Law</strong>
                  <span>Oregon · Independent practice</span>
                </div>
                <ArrowUpRight size={20} />
              </div>
              <div className="sample-score">
                <ScoreRing score={cash.score} />
                <div>
                  <span className="eyebrow">PRICING & CASH</span>
                  <h3>
                    A clear place
                    <br />
                    to start.
                  </h3>
                  <p>
                    Bring consistency to billing
                    <br />
                    before chasing more work.
                  </p>
                </div>
              </div>
              <div className="sample-next">
                <span className="sample-next-icon">
                  <ListChecks size={18} />
                </span>
                <div>
                  <span>YOUR NEXT USEFUL ACTION</span>
                  <strong>Create an invoicing review</strong>
                </div>
                <ChevronRight size={17} />
              </div>
              <button className="sample-report-link" onClick={exploreSample}>
                Explore the example report
                <ArrowRight size={16} />
              </button>
            </div>
            <div className="floating-note">
              <div className="floating-icon">
                <Sparkles size={17} />
              </div>
              <span>
                A plan for your practice.
                <br />
                <strong>Not another list of things to buy.</strong>
              </span>
            </div>
          </div>
        </section>
        <section className="domain-strip">
          <div className="page-width">
            <p>SIX WAYS TO UNDERSTAND YOUR PRACTICE</p>
            <div>
              {DEFAULT_RELEASE.domains.map((d) => {
                const Icon = ICONS[d.id];
                return (
                  <span key={d.id}>
                    <Icon size={18} />
                    {d.title}
                  </span>
                );
              })}
            </div>
          </div>
        </section>
        <section className="how-section page-width">
          <div>
            <span className="eyebrow">SMALL STEPS. A CLEARER PICTURE.</span>
            <h2>
              Find the next thing
              <br />
              <em>worth doing.</em>
            </h2>
            <p>
              Success can mean more suitable clients, steadier cash flow, or a
              Friday that actually ends on Friday. Start with what matters to
              you.
            </p>
            <button
              className="text-link"
              onClick={() => navigate("methodology")}
            >
              How the assessment works
              <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="how-steps">
            {[
              {
                number: "01",
                title: "Tell us what you want to improve",
                text: "A little context helps us ask useful questions. There’s a route for new practices and firms without a website.",
              },
              {
                number: "02",
                title: "See what your answers support",
                text: "Understand strengths, gaps and uncertainty. A provisional rubric makes the reasoning visible.",
              },
              {
                number: "03",
                title: "Choose your next useful action",
                text: "Follow a short plan, track what you’ve done and reassess when you have new evidence.",
              },
            ].map((s) => (
              <article key={s.number}>
                <span>{s.number}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="closing-banner page-width">
          <div className="closing-icon">
            <Scale size={29} />
          </div>
          <div>
            <h2>Your practice should work for you, too.</h2>
            <p>
              Explore a complete fictional assessment to see the experience.
            </p>
          </div>
          <button className="btn btn-light" onClick={exploreSample}>
            View the example
            <ArrowUpRight size={17} />
          </button>
        </section>
      </>
    );
  }

  function renderAssessment() {
    const selectedDomain = assessmentRelease.domains.find(
      (d) => d.id === module,
    )!;
    return (
      <section className="assessment-shell page-width">
        <div className="assessment-aside">
          <button
            className="text-link"
            onClick={() => navigate(current ? "report" : "home")}
          >
            <ArrowLeft size={15} />
            Back
          </button>
          <span className="eyebrow">YOUR PRACTICE CHECKUP</span>
          <h1>
            A little context.
            <br />
            <em>A useful next step.</em>
          </h1>
          <p>Assess one area now. Add the others whenever you’re ready.</p>
          <ol className="step-list">
            {[
              "Your practice & priorities",
              "A focused checkup",
              "Essential safeguards",
            ].map((s, i) => (
              <li
                className={
                  wizardStep === i
                    ? "current"
                    : wizardStep > i
                      ? "complete"
                      : ""
                }
                key={s}
              >
                <span>{wizardStep > i ? <Check size={14} /> : i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          <div className="aside-note">
            <LockKeyhole size={18} />
            <p>
              Guest answers stay on this device until you choose to save a
              report to your private account. Don’t enter client information,
              account credentials or private documents.
            </p>
          </div>
          {!isSample && context.websiteStatus === "has_site" && (
            <WebsiteScanPanel
              enabled={websiteScansEnabled}
              compact
              session={draftScan}
              snapshot={
                current?.practiceId === practiceId
                  ? current.websiteScan
                  : undefined
              }
              onRescan={
                context.websiteUrl
                  ? () =>
                      void websiteScans.begin(
                        context.websiteUrl!,
                        practiceId,
                        true,
                      )
                  : undefined
              }
              onRetryStatus={
                draftScan
                  ? () => websiteScans.retryStatus(draftScan)
                  : undefined
              }
              onConfirmContext={(result) => {
                setContextSuggestion(result);
                setSuggestedPracticeArea(
                  result.suggestedContext.practiceAreas.find((area) =>
                    [
                      "Family law",
                      "Estate planning",
                      "Immigration",
                      "Criminal defense",
                      "Personal injury",
                      "Business law",
                      "Employment",
                      "Real estate",
                      "General practice",
                      "Other",
                    ].includes(area),
                  ) ?? "",
                );
                setSuggestedJurisdiction("");
              }}
            />
          )}
          {isSample && <span className="tag">Editing a fictional example</span>}
        </div>
        <div className="assessment-main card">
          <div className="assessment-progress">
            <span>STEP {wizardStep + 1} OF 3</span>
            <span>
              {wizardStep === 1
                ? selectedDomain.title
                : wizardStep === 0
                  ? "Your starting point"
                  : "Outside the average"}
            </span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${((wizardStep + 1) / 3) * 100}%` }} />
          </div>
          <p className="draft-save-note">
            Your report saves when you select “See my report.” Refreshing clears
            unfinished questionnaire answers; a started website check can still
            be retrieved after you save a report.
            {baselineId
              ? " Prior answers are shown for review; other areas retain their earlier answers and rubric."
              : ""}
          </p>
          {wizardStep === 0 && (
            <>
              <h2>What would make your practice better?</h2>
              <p className="muted">
                Choose your immediate priority. Growth is one option.
              </p>
              <div className="goal-options">
                {GOALS.map((g) => {
                  const Icon = g.icon;
                  return (
                    <label
                      key={g.id}
                      className={`goal-option ${context.goal === g.id ? "selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="goal"
                        value={g.id}
                        checked={context.goal === g.id}
                        onChange={() =>
                          setContext((c) => ({ ...c, goal: g.id }))
                        }
                      />
                      <Icon size={21} />
                      <span>
                        <strong>{g.label}</strong>
                        <small>{g.description}</small>
                      </span>
                      <span className="selection-indicator">
                        {context.goal === g.id && <Check size={12} />}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="field-grid">
                <label className="field-label">
                  Main practice area
                  <select
                    aria-label="Main practice area"
                    value={context.practiceArea}
                    onChange={(e) =>
                      setContext((c) => ({
                        ...c,
                        practiceArea: e.target.value,
                      }))
                    }
                  >
                    <option value="">Prefer not to specify</option>
                    {[
                      "Family law",
                      "Estate planning",
                      "Immigration",
                      "Criminal defense",
                      "Personal injury",
                      "Business law",
                      "Employment",
                      "Real estate",
                      "General practice",
                      "Other",
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  Service jurisdiction
                  <input
                    aria-label="Service jurisdiction"
                    placeholder="e.g. Oregon (optional)"
                    maxLength={80}
                    value={context.jurisdiction}
                    onChange={(e) =>
                      setContext((c) => ({
                        ...c,
                        jurisdiction: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field-label">
                  Practice stage
                  <select
                    aria-label="Practice stage"
                    value={context.stage}
                    onChange={(e) =>
                      setContext((c) => ({
                        ...c,
                        stage: e.target.value as PracticeContext["stage"],
                      }))
                    }
                  >
                    <option value="prelaunch">Planning / prelaunch</option>
                    <option value="new">Newly launched</option>
                    <option value="established">Established</option>
                  </select>
                </label>
                <label className="field-label">
                  Main fee model
                  <select
                    aria-label="Main fee model"
                    value={context.feeModel}
                    onChange={(e) =>
                      setContext((c) => ({
                        ...c,
                        feeModel: e.target.value as PracticeContext["feeModel"],
                      }))
                    }
                  >
                    {[
                      ["hourly", "Hourly"],
                      ["flat", "Flat fee"],
                      ["contingency", "Contingency"],
                      ["subscription", "Subscription"],
                      ["mixed", "Mixed"],
                      ["other", "Other / unsure"],
                    ].map(([v, label]) => (
                      <option value={v} key={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  Suitable new matters you could take next month
                  <select
                    aria-label="Suitable new matters you could take next month"
                    value={context.capacityAdditionalMatters ?? "unknown"}
                    onChange={(e) =>
                      setContext((c) => ({
                        ...c,
                        capacityAdditionalMatters:
                          e.target.value === "unknown"
                            ? null
                            : Number(e.target.value),
                      }))
                    }
                  >
                    <option value="unknown">I’m not sure</option>
                    <option value="0">None right now</option>
                    <option value="1">About 1</option>
                    <option value="2">About 2</option>
                    <option value="5">About 5</option>
                    <option value="10">About 10 or more</option>
                  </select>
                </label>
                <label className="field-label">
                  Public website
                  <select
                    aria-label="Public website"
                    value={context.websiteStatus}
                    onChange={(e) =>
                      setContext((c) => ({
                        ...c,
                        websiteStatus: e.target
                          .value as PracticeContext["websiteStatus"],
                      }))
                    }
                  >
                    <option value="has_site">I have a website</option>
                    <option value="no_site">I don’t have one yet</option>
                    <option value="unknown">Not specified</option>
                  </select>
                </label>
              </div>
              <p className="fine-print">
                These details route questions. They don’t earn or lose points.
              </p>
              <div className="wizard-actions">
                <span>Start with four focused questions</span>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setModule(goal.domain);
                    setWizardStep(1);
                  }}
                >
                  Continue
                  <ArrowRight size={16} />
                </button>
              </div>
            </>
          )}
          {wizardStep === 1 && (
            <>
              <h2>{selectedDomain.title}</h2>
              <p className="muted">
                {selectedDomain.description} Choose what happens in practice,
                including “not sure” when appropriate.
              </p>
              {activeModuleQuestions.length === 0 && (
                <div className="empty-note">
                  <Info size={19} />
                  <p>
                    This module doesn’t apply to your current setup. It won’t
                    count as a failure or lower another module’s result.
                  </p>
                </div>
              )}
              {activeModuleQuestions.map((q, i) => (
                <fieldset className="question" key={q.id}>
                  <legend>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    {q.title}
                  </legend>
                  <p>{q.help}</p>
                  <div className="answer-options">
                    {q.options.map((option) => (
                      <label
                        key={option.value}
                        className={`answer-option ${answers[q.id] === option.value ? "selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name={q.id}
                          checked={answers[q.id] === option.value}
                          onChange={() =>
                            setAnswers((a) => ({ ...a, [q.id]: option.value }))
                          }
                        />
                        <span className="selection-indicator">
                          {answers[q.id] === option.value && (
                            <Check size={12} />
                          )}
                        </span>
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <div className="wizard-actions">
                <button
                  className="quiet-button"
                  onClick={() => setWizardStep(0)}
                >
                  <ArrowLeft size={15} />
                  Back
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => setWizardStep(2)}
                >
                  Continue
                  <ArrowRight size={16} />
                </button>
              </div>
              <p className="fine-print">
                Skipped answers remain unknown. We’ll show a grade only when
                enough applicable evidence is present.
              </p>
            </>
          )}
          {wizardStep === 2 && (
            <>
              <h2>A few safeguards deserve their own check.</h2>
              <p className="muted">
                These stay outside numerical averages. Your answers do not
                certify compliance, and a strong score elsewhere won’t hide a
                concern.
              </p>
              <div className="field-grid">
                <label className="field-label">
                  Do you use AI for legal work?
                  <select
                    aria-label="Do you use AI for legal work?"
                    value={
                      context.usesAI === null
                        ? "unknown"
                        : String(context.usesAI)
                    }
                    onChange={(e) =>
                      setContext((c) => ({
                        ...c,
                        usesAI:
                          e.target.value === "unknown"
                            ? null
                            : e.target.value === "true",
                      }))
                    }
                  >
                    <option value="unknown">Not sure / not specified</option>
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </label>
                <label className="field-label">
                  Does the practice handle client funds?
                  <select
                    aria-label="Does the practice handle client funds?"
                    value={
                      context.handlesClientFunds === null
                        ? "unknown"
                        : String(context.handlesClientFunds)
                    }
                    onChange={(e) =>
                      setContext((c) => ({
                        ...c,
                        handlesClientFunds:
                          e.target.value === "unknown"
                            ? null
                            : e.target.value === "true",
                      }))
                    }
                  >
                    <option value="unknown">Not sure / not specified</option>
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </label>
              </div>
              <div className="controls-questions">
                {applicableControls.map((id) => (
                  <fieldset className="control-question" key={id}>
                    <legend>{CONTROL_TITLES[id]}</legend>
                    <div>
                      {[
                        ["yes", "In place"],
                        ["no", "Needs attention"],
                        ["unknown", "Not sure yet"],
                      ].map(([value, label]) => (
                        <label
                          key={value}
                          className={`control-choice ${controls[id] === value ? "selected" : ""}`}
                        >
                          <input
                            type="radio"
                            name={`control-${id}`}
                            checked={controls[id] === value}
                            onChange={() =>
                              setControls((c) => ({ ...c, [id]: value }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              <div className="wizard-actions">
                <button
                  className="quiet-button"
                  onClick={() => setWizardStep(1)}
                >
                  <ArrowLeft size={15} />
                  Back
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => saveAssessment()}
                >
                  See my report
                  <ArrowRight size={16} />
                </button>
              </div>
              <p className="fine-print">
                You can leave these unanswered. We’ll preserve what remains
                unknown.
              </p>
            </>
          )}
        </div>
      </section>
    );
  }

  function renderReport() {
    if (!report || !current) return renderEmpty();
    const focusId = goalFor(report.contextSnapshot).domain,
      focus = report.domains.find((d) => d.id === focusId)!;
    const activeDomains = report.domains.filter(
      (d) => d.status !== "not_applicable",
    );
    const assessed = activeDomains.filter((d) => d.status === "scored").length;
    const strengths = report.domains
      .flatMap((d) =>
        d.findings
          .filter((f) => f.applicable && f.points !== null && f.points >= 70)
          .map((f) => ({ ...f, domain: d.title })),
      )
      .slice(0, 3);
    const concerns = report.controls.filter(
      (c) => c.applicable && c.status === "no",
    );
    return (
      <section className="report-page page-width">
        <div className="page-heading">
          <div>
            <span className="eyebrow">YOUR PRACTICE REPORT</span>
            <h1>
              {current.isSample
                ? "Juniper’s starting point."
                : "Your next chapter starts here."}
            </h1>
            <p>
              {current.label}{" "}
              {report.contextSnapshot.jurisdiction &&
                `· ${report.contextSnapshot.jurisdiction}`}{" "}
              · {dateLabel(current.createdAt)}
            </p>
          </div>
          <button className="btn btn-secondary" onClick={() => window.print()}>
            <Download size={16} />
            Print / save PDF
          </button>
        </div>
        <div className={`evidence-banner ${current.isSample ? "sample" : ""}`}>
          <Info size={18} />
          <span>
            {current.isSample
              ? "Fictional example. These answers and findings do not describe your firm or a website we inspected."
              : "Operating readiness is based on your answers. Any live public website evidence is shown separately below and does not verify your operating practices."}
          </span>
          <span className="tag">Provisional rubric</span>
        </div>
        <div className="report-overview">
          <div className="report-score card">
            <div>
              <span className="eyebrow">
                {focus.title.toUpperCase()} READINESS
              </span>
              <h2>{band(focus.score)}</h2>
              <p>
                {focus.score === null
                  ? "There isn’t enough evidence for a grade in this area yet. The findings and next steps below can still help."
                  : "A view of reported processes in your chosen priority area. Use it to choose an improvement, then check what changes."}
              </p>
              <div className="evidence-line">
                <span className="status-dot" />
                {focus.answeredCount} of {focus.applicableCount} applicable
                questions answered
              </div>
            </div>
            <ScoreRing score={focus.score} />
          </div>
          <div className="report-goal">
            <Target size={23} />
            <span className="eyebrow">YOUR CHOSEN DIRECTION</span>
            <h3>{goalFor(report.contextSnapshot).label}</h3>
            <p>
              {report.contextSnapshot.capacityAdditionalMatters === 0
                ? "At capacity. Prioritize workload, fit and coverage before increasing demand."
                : "Actions are ordered around this goal, evidence and effort—not which software you use."}
            </p>
            <span>
              {assessed} of {activeDomains.length} applicable areas graded
              <ArrowDown size={16} />
            </span>
          </div>
        </div>
        {!current.isSample && (
          <WebsiteScanPanel
            enabled={websiteScansEnabled}
            session={reportScan}
            snapshot={current.websiteScan}
            noSite={report.contextSnapshot.websiteStatus === "no_site"}
            onRescan={
              report.contextSnapshot.websiteStatus === "has_site" &&
              report.contextSnapshot.websiteUrl
                ? rescanReport
                : undefined
            }
            onSaveSnapshot={
              reportScan?.result ? saveWebsiteSnapshot : undefined
            }
            onRetryStatus={
              reportScan
                ? () => websiteScans.retryStatus(reportScan)
                : undefined
            }
          />
        )}
        <div className="section-heading">
          <div>
            <span className="eyebrow">A PRACTICAL PLACE TO BEGIN</span>
            <h2>Your next three actions</h2>
          </div>
          <span className="tag">
            <ListChecks size={14} />
            Prioritized for your goal
          </span>
        </div>
        <div className="actions-list">
          {report.actions.slice(0, 3).map((action, i) => (
            <ActionCard
              key={`${current.id}:${action.id}`}
              action={action}
              index={i}
              state={store.actionStates[`${current.id}:${action.id}`] ?? "todo"}
              progress={store.actionProgress?.[`${current.id}:${action.id}`]}
              setState={(state, progress) =>
                setAction(action.id, state, progress)
              }
            />
          ))}
          {report.actions.length === 0 && (
            <div className="card empty-note">
              <CheckCircle2 size={25} />
              <div>
                <h3>No immediate action triggered</h3>
                <p>
                  Review your chosen outcome, or assess another area to find the
                  next useful improvement.
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="section-heading">
          <div>
            <span className="eyebrow">THE PICTURE SO FAR</span>
            <h2>Six areas. One practice.</h2>
          </div>
          <p>Coverage describes evidence, not quality.</p>
        </div>
        <div className="module-grid">
          {report.domains.map((d) => {
            const Icon = ICONS[d.id],
              def = report.releaseSnapshot.domains.find((x) => x.id === d.id)!;
            return (
              <article className="module-card card" key={d.id}>
                <div className="module-card-top">
                  <span
                    className="domain-icon"
                    style={{ color: def.color, background: `${def.color}13` }}
                  >
                    <Icon size={22} />
                  </span>
                  <span
                    className={`module-value ${d.score === null ? "ungraded" : ""}`}
                  >
                    {d.status === "not_applicable" ? "N/A" : rounded(d.score)}
                    {d.score !== null && <small>/100</small>}
                  </span>
                </div>
                <h3>{d.title}</h3>
                <p>
                  {d.status === "not_applicable"
                    ? "Doesn’t apply to your current setup."
                    : d.score === null
                      ? "A little more evidence will help."
                      : band(d.score)}
                </p>
                <div className="coverage-meter">
                  <span
                    style={{
                      width: `${d.coverage * 100}%`,
                      background: def.color,
                    }}
                  />
                </div>
                <span className="fine-print">
                  {d.status === "not_applicable"
                    ? "Excluded from applicable evidence"
                    : `${d.answeredCount} / ${d.applicableCount} questions · ${Math.round(d.coverage * 100)}% weighted coverage`}
                </span>
                <div className="module-actions">
                  <button
                    className="text-link"
                    onClick={() =>
                      setDetailDomain(detailDomain === d.id ? null : d.id)
                    }
                    aria-expanded={detailDomain === d.id}
                  >
                    See the evidence
                    <ChevronDown size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Assess ${d.title}`}
                    onClick={() => continueAssessment(d.id)}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {detailDomain &&
          renderDomainDetail(
            report.domains.find((d) => d.id === detailDomain)!,
          )}
        <div className="report-bottom-grid">
          <div className="card strengths">
            <span className="eyebrow">KEEP WHAT WORKS</span>
            <h2>Foundations to build on</h2>
            {strengths.length ? (
              strengths.map((f) => (
                <div className="strength-item" key={f.questionId}>
                  <CheckCircle2 size={19} />
                  <div>
                    <strong>{f.title}</strong>
                    <span>
                      {f.domain} ·{" "}
                      {current.isSample ? "Example answer" : "Owner-reported"}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">
                As you answer more questions, we’ll surface the processes you
                report having in place.
              </p>
            )}
          </div>
          <div
            className={`card safeguards ${concerns.length ? "needs-attention" : ""}`}
          >
            <div className="safeguards-title">
              <ShieldCheck size={22} />
              <span className="eyebrow">OUTSIDE THE AVERAGE</span>
            </div>
            <h2>Essential safeguards</h2>
            <p className="muted">
              These are reported statuses, not a compliance certification.
            </p>
            {report.controls.map((c) => (
              <div className="control-status" key={c.id}>
                <span>{c.title}</span>
                <span className={`control-tag ${c.status}`}>
                  {!c.applicable
                    ? "Not applicable"
                    : c.status === "yes"
                      ? "Reported in place"
                      : c.status === "no"
                        ? "Needs attention"
                        : "Unknown"}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="save-banner">
          <div>
            <h3>A baseline to come back to.</h3>
            <p>
              This assessment is saved in this browser. Complete an action, then
              reassess to record what changed.
            </p>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => navigate("progress")}
          >
            View my progress
            <ArrowRight size={16} />
          </button>
          <button className="quiet-button" onClick={() => setModal("email")}>
            Email / login options
          </button>
        </div>
        <div className="report-meta">
          <span>
            {report.releaseSnapshot.label} · {report.releaseId}
          </span>
          <button className="text-link" onClick={() => navigate("methodology")}>
            Understand the methodology
            <ArrowUpRight size={14} />
          </button>
        </div>
      </section>
    );
  }

  function renderDomainDetail(domain: DomainAssessment) {
    if (!report) return null;
    return (
      <section
        className="card evidence-detail"
        aria-label={`${domain.title} evidence`}
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">REPORTED EVIDENCE</span>
            <h2>{domain.title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close evidence"
            onClick={() => setDetailDomain(null)}
          >
            <X size={19} />
          </button>
        </div>
        <p className="muted">{domain.note}</p>
        {domain.findings.map((f) => {
          const q = report.releaseSnapshot.questions.find(
            (q) => q.id === f.questionId,
          )!;
          return (
            <div className="finding-row" key={f.questionId}>
              <div>
                <strong>{f.title}</strong>
                <p>
                  {!f.applicable
                    ? "Not applicable in this context"
                    : (q.options.find((o) => o.value === f.answer)?.label ??
                      "Not answered")}
                </p>
                <span className="fine-print">
                  {f.note} · Weight {f.weight}
                </span>
              </div>
              <span className="tag">
                {!f.applicable
                  ? "N/A"
                  : f.points === null
                    ? "Unknown"
                    : `${f.points} / 100`}
              </span>
            </div>
          );
        })}
        {domain.score === null && domain.lowerBound !== null && (
          <p className="fine-print">
            Missing-information bounds: {Math.round(domain.lowerBound)}–
            {Math.round(domain.upperBound ?? 100)}. These are possible rubric
            results given unknown answers, not statistical confidence intervals.
          </p>
        )}
      </section>
    );
  }

  function renderEmpty() {
    return (
      <section className="empty-state page-width">
        <div className="empty-state-icon">
          <LayoutDashboard size={35} />
        </div>
        <span className="eyebrow">YOUR PRACTICE, OVER TIME</span>
        <h1>Start with a baseline.</h1>
        <p>
          A short assessment gives you a place to begin. Your reports and action
          progress will be saved in this browser.
        </p>
        <div className="button-row">
          <button className="btn btn-primary" onClick={() => start()}>
            Start my assessment
            <ArrowRight size={16} />
          </button>
          <button className="btn btn-secondary" onClick={exploreSample}>
            Explore an example
          </button>
        </div>
      </section>
    );
  }

  function renderProgress() {
    if (!current || !report) return renderEmpty();
    const previous = store.assessments.find(
      (r) =>
        r.id === current.baselineId &&
        r.practiceId === current.practiceId &&
        r.isSample === current.isSample,
    );
    const focus = report.domains.find(
      (d) => d.id === goalFor(report.contextSnapshot).domain,
    )!;
    const previousFocus = previous?.assessment.domains.find(
      (d) => d.id === focus.id,
    );
    const comparableContext =
      previous &&
      (
        [
          "goal",
          "feeModel",
          "stage",
          "websiteStatus",
          "websiteUrl",
          "practiceArea",
          "jurisdiction",
        ] as const
      ).every(
        (k) =>
          previous.assessment.contextSnapshot[k] === report.contextSnapshot[k],
      );
    const evidenceSet = (d: DomainAssessment | undefined) =>
      JSON.stringify(
        d?.findings
          .filter((f) => f.applicable && f.points !== null)
          .map((f) => [f.questionId, f.weight]),
      );
    const comparable =
      previous &&
      comparableContext &&
      previous.assessment.releaseId === report.releaseId &&
      evidenceSet(focus) === evidenceSet(previousFocus);
    const delta =
      comparable &&
      focus.score !== null &&
      previousFocus?.score !== null &&
      previousFocus?.score !== undefined
        ? Math.round(focus.score - previousFocus.score)
        : null;
    const completed = report.actions.filter(
      (a) => store.actionStates[`${current.id}:${a.id}`] === "done",
    ).length;
    return (
      <section className="progress-page page-width">
        <div className="page-heading">
          <div>
            <span className="eyebrow">A PRACTICE THAT KEEPS EVOLVING</span>
            <h1>Small steps. Visible progress.</h1>
            <p>
              Keep your original baseline. Record changes when you reassess.
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() =>
              continueAssessment(goalFor(report.contextSnapshot).domain)
            }
          >
            Reassess my priority
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="evidence-banner">
          <LockKeyhole size={18} />
          <span>
            Saved on this browser and device. No account sync, reminders or
            public sharing is connected.
          </span>
          <button className="text-link" onClick={() => setModal("preferences")}>
            Preferences
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="progress-stats">
          <div className="card">
            <span className="eyebrow">YOUR PRIORITY AREA</span>
            <strong>
              {rounded(focus.score)}
              <small>
                {focus.score === null
                  ? "incomplete"
                  : "/100 reported readiness"}
              </small>
            </strong>
            <span>{focus.title}</span>
          </div>
          <div className="card">
            <span className="eyebrow">ACTIONS MARKED COMPLETE</span>
            <strong>
              {completed}
              <small>
                of {Math.min(3, report.actions.length)} suggested actions
              </small>
            </strong>
            <span>Completion is reported by you</span>
          </div>
          <div className="card">
            <span className="eyebrow">COMPARABLE CHANGE</span>
            <strong>
              {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}`}
              <small>
                {delta === null
                  ? "another comparable assessment needed"
                  : "reported rubric points"}
              </small>
            </strong>
            <span>
              {previous && !comparable
                ? "Methodology or context changed"
                : "Business outcomes are not verified"}
            </span>
          </div>
        </div>
        <div className="progress-columns">
          <section>
            <div className="section-heading">
              <h2>Keep the next step small.</h2>
            </div>
            <div className="actions-list">
              {report.actions.slice(0, 3).map((a, i) => (
                <ActionCard
                  key={`${current.id}:${a.id}`}
                  action={a}
                  index={i}
                  state={store.actionStates[`${current.id}:${a.id}`] ?? "todo"}
                  progress={store.actionProgress?.[`${current.id}:${a.id}`]}
                  setState={(s, progress) => setAction(a.id, s, progress)}
                />
              ))}
            </div>
          </section>
          <aside>
            <PeerContextPanel assessment={current} />
            <div className="card assessment-history">
              <span className="eyebrow">YOUR ASSESSMENT HISTORY</span>
              <h3>A record of where you started.</h3>
              {store.assessments.map((r) => (
                <button
                  key={r.id}
                  className={`history-item ${r.id === current.id ? "active" : ""}`}
                  onClick={() => {
                    setSelectedId(r.id);
                    navigate("report");
                  }}
                >
                  <span className="history-dot" />
                  <span>
                    <strong>{r.label}</strong>
                    <small>
                      {dateLabel(r.createdAt)} ·{" "}
                      {r.isSample ? "Fictional example" : "Your answers"}
                    </small>
                    <small>{r.assessment.releaseSnapshot.label}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
            <div className="card community-card">
              <Trophy size={26} />
              <h3>Progress worth recognizing.</h3>
              <p>
                Future peer comparisons and recognition will be optional. Public
                rankings need comparable, current evidence first.
              </p>
              <button className="text-link" onClick={() => setModal("sharing")}>
                Explore sharing preferences
                <ArrowRight size={15} />
              </button>
            </div>
          </aside>
        </div>
      </section>
    );
  }

  function renderMethodology() {
    return (
      <section className="methodology-page page-width">
        <div className="methodology-intro">
          <span className="eyebrow">A GRADE YOU CAN UNDERSTAND</span>
          <h1>
            The reasoning
            <br />
            <em>stays visible.</em>
          </h1>
          <p>
            A useful assessment should help you choose what to do next. It
            should also be honest about what it knows.
          </p>
        </div>
        <div className="methodology-grid">
          {[
            {
              icon: Target,
              title: "Your goal sets the direction",
              text: "Practice area, stage, fee model and capacity route the questions. They don't earn points. Neither do headcount, software purchases or marketing permission.",
            },
            {
              icon: FileCheck2,
              title: "A process rubric, openly provisional",
              text: "Each answer maps to a published maturity band: not yet (0), informal (40), consistent (70), and reviewed (100). These are product-policy choices, not validated industry percentiles.",
            },
            {
              icon: CircleHelp,
              title: "Unknown stays unknown",
              text: "Skipped answers are not zeros. Confirmed inapplicability changes the applicable set. A module needs the coverage threshold and every required answer before a grade is shown.",
            },
            {
              icon: ShieldCheck,
              title: "Safeguards stay outside averages",
              text: "Deadline controls, account protection and applicable AI/client-funds checks remain visible. This assessment does not grade legal skill or certify compliance.",
            },
            {
              icon: Clock3,
              title: "History stays as it was issued",
              text: "Every assessment keeps its questions, weights and rubric. A new admin release changes future assessments. It never silently rewrites an earlier result.",
            },
            {
              icon: LockKeyhole,
              title: "You choose what to share",
              text: "Guest answers and progress stay on this device. Saving a selected report to a verified private account uploads that report and its progress so you can return from another device. Sign-in codes and report summaries are requested separately. The weekly education series and anonymous leaderboard each require their own explicit enrollment. Public scan access expires after 30 days. Private research, commercial contact and public sharing have separate choices.",
            },
          ].map((x) => {
            const Icon = x.icon;
            return (
              <article className="card methodology-card" key={x.title}>
                <span className="domain-icon">
                  <Icon size={24} />
                </span>
                <h2>{x.title}</h2>
                <p>{x.text}</p>
              </article>
            );
          })}
        </div>
        <div className="card rubric-explainer">
          <div>
            <span className="eyebrow">HOW THE NUMBER WORKS</span>
            <h2>Evidence first. Arithmetic second.</h2>
            <p>
              For an eligible module, reported answer points are combined using
              the published question weights. Applicable evidence coverage is
              calculated separately. Missing-information bounds show possible
              effects of unknown answers.
            </p>
          </div>
          <div className="rubric-bands">
            {[
              ["0", "Not in place yet"],
              ["40", "Informal / ad hoc"],
              ["70", "Consistent process"],
              ["100", "Reviewed in practice"],
            ].map(([n, label]) => (
              <div key={n}>
                <strong>{n}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <p className="fine-print">
            Current coverage policy: at least{" "}
            {Math.round(store.activeRelease.minCoverage * 100)}% applicable
            weighted evidence plus every mandatory answer. A policy threshold is
            not a statistical confidence level.
          </p>
        </div>
        <div className="methodology-links">
          <div>
            <span className="eyebrow">WHERE RESEARCH FITS</span>
            <h3>External research informs future calibration.</h3>
            <p>
              Peer studies, expert recommendations and our own observations need
              separate provenance and compatible definitions. This preview does
              not claim an industry percentile or predict revenue.
            </p>
          </div>
          <a
            href="https://www.clio.com/resources/legal-trends/read-online/"
            target="_blank"
            rel="noreferrer"
          >
            Explore Clio’s Legal Trends research
            <ArrowUpRight size={18} />
          </a>
        </div>
        <div className="card rubric-explainer">
          <div>
            <span className="eyebrow">A SEPARATE WEBSITE RUBRIC</span>
            <h2>Observed website evidence has its own score.</h2>
            <p>
              Measured public checks are combined using their published weights.
              Unavailable checks are excluded, never assigned zero. Evidence
              coverage is shown separately, and a score is withheld when too
              little is measurable. The report keeps its scan date, supporting
              pages, scanner version and rubric version.
            </p>
            <p>
              Inspecting page markup does not confirm that a booking flow works,
              analytics are correct, or the whole site is accessible. The
              Lighthouse laboratory audit simulates one mobile visit. It is not
              real-user field data, a compliance certification or a prediction
              of clients.
            </p>
          </div>
        </div>
        <div className="button-row">
          <button className="btn btn-primary" onClick={() => start()}>
            Find my starting point
            <ArrowRight size={16} />
          </button>
          <a className="btn btn-secondary" href="/admin">
            Manage published methodology
            <Settings2 size={16} />
          </a>
        </div>
      </section>
    );
  }

  function renderPreferences(sharing = false) {
    const items: {
      key: keyof PreviewPreferences;
      title: string;
      text: string;
    }[] = [
      {
        key: "reminders",
        title: "Action reminders",
        text: "Interest in a reminder about the action you choose. No reminder is sent in this preview.",
      },
      {
        key: "marketing",
        title: "Practice education and product updates",
        text: "A separate choice for future optional communications. This does not enroll you in a list.",
      },
      {
        key: "benchmarking",
        title: "Contribute to private aggregate benchmarks",
        text: "Interest in future contribution. No answers are uploaded or included in a research dataset now.",
      },
      {
        key: "leaderboard",
        title: "Opt into future recognition",
        text: "Interest in a leaderboard or share card. Your practice is not published; a future preview and explicit publication step will be required.",
      },
    ];
    return (
      <Dialog
        title={
          sharing ? "Recognition on your terms" : "Your data and preferences"
        }
        close={() => setModal(null)}
      >
        <p className="muted">
          Preview preferences are saved on this device. They trigger no emails,
          research contribution or public sharing.
        </p>
        <p className="fine-print">
          Website checks send a public URL for inspection. Public scan access
          expires after 30 days, and expired server records are removed during
          scheduled cleanup. Business questionnaire answers stay on this device
          unless you explicitly save a selected report to your private account.
          Clearing this device removes local history and scan access. Cloud
          account copies have separate export and deletion controls, and queued
          public scans keep their own expiry.
        </p>
        <div className="preference-list">
          {items.map((item) => (
            <label className="preference" key={item.key}>
              <span>
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </span>
              <input
                type="checkbox"
                checked={store.preferences[item.key]}
                onChange={(e) => updatePreference(item.key, e.target.checked)}
              />
              <span
                className={`switch ${store.preferences[item.key] ? "on" : ""}`}
                aria-hidden="true"
              >
                <span />
              </span>
            </label>
          ))}
        </div>
        <div className="dialog-data-actions">
          <button className="btn btn-secondary" onClick={exportData}>
            <Download size={16} />
            Download my preview data
          </button>
          <button
            className="quiet-button danger"
            onClick={() => setModal("clear")}
          >
            <Trash2 size={15} />
            Clear this device
          </button>
        </div>
        <button
          className="btn btn-primary dialog-done"
          onClick={() => setModal(null)}
        >
          Done
          <Check size={15} />
        </button>
      </Dialog>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="preview-bar">
        <span className="preview-pill">PREVIEW</span>
        <span>
          {websiteScansEnabled
            ? "Live website checks + owner-reported answers. Optional private accounts."
            : "Practice assessment preview. Website checks are unavailable on this deployment."}
        </span>
        <button onClick={() => setModal("preferences")}>
          <LockKeyhole size={12} />
          Saved on this device
        </button>
      </div>
      <header className="site-header page-width">
        <button
          className="brand"
          onClick={() => navigate("home")}
          aria-label="Practice Grader home"
        >
          <span className="brand-mark">
            <Scale size={25} />
          </span>
          <span>
            <strong>
              Practice Grader<span className="brand-period">.</span>
            </strong>
            <small>INDEPENDENT LAW · BY FOUNT</small>
          </span>
        </button>
        <nav aria-label="Main navigation">
          <button
            className={
              view === "home" || view === "assessment" || view === "report"
                ? "active"
                : ""
            }
            onClick={() => navigate(current ? "report" : "home")}
          >
            Assessment
          </button>
          <button
            className={view === "progress" ? "active" : ""}
            onClick={() => navigate("progress")}
          >
            My progress
          </button>
          <button
            className={view === "methodology" ? "active" : ""}
            onClick={() => navigate("methodology")}
          >
            Methodology
          </button>
        </nav>
        <a className="admin-nav" href="/account" aria-label="Private account">
          <LockKeyhole size={16} />
          <span>Private account</span>
        </a>
      </header>
      <nav
        className="growth-nav page-width"
        aria-label="Learning and community"
      >
        <a href="/benchmarks">Industry benchmarks</a>
        <a href="/leaderboard">Opt-in leaderboard</a>
        <a href="/account#practice-learning">Weekly practice lessons</a>
        <a href="/account#business-outcomes">Track business outcomes</a>
      </nav>
      {storageWarning && (
        <div className="storage-warning" role="alert">
          {storageWarning}
          <button onClick={exportData}>Download data</button>
          <button onClick={() => setModal("clear")}>Clear saved data</button>
        </div>
      )}
      {!configurationAvailable && (
        <div className="storage-warning" role="status">
          The latest shared methodology could not be loaded. New assessments use
          the built-in provisional baseline; your saved reports stay unchanged.
        </div>
      )}
      {websiteScans.accessWarning && (
        <div className="storage-warning" role="status">
          {websiteScans.accessWarning}
          <button onClick={() => setModal("clear")}>Clear this device</button>
        </div>
      )}
      <main ref={mainRef} id="main-content" tabIndex={-1}>
        {view === "home" ? (
          renderHome()
        ) : view === "assessment" ? (
          renderAssessment()
        ) : view === "report" ? (
          renderReport()
        ) : view === "progress" ? (
          renderProgress()
        ) : view === "methodology" ? (
          renderMethodology()
        ) : (
          <section className="admin-page page-width">
            <div className="page-heading">
              <div>
                <span className="eyebrow">LOCAL CONFIGURATION PLAYGROUND</span>
                <h1>Make the rubric your own.</h1>
                <p>
                  This local sandbox affects this browser only. The protected
                  admin console manages published methodology.
                </p>
              </div>
            </div>
            <AdminPanel
              activeRelease={store.activeRelease}
              releaseHistory={store.releaseHistory}
              onPublish={publish}
              onReset={() =>
                publish({
                  ...structuredClone(DEFAULT_RELEASE),
                  id: `preview-reset-${Date.now()}`,
                  label: "Default rubric restored locally",
                })
              }
            />
          </section>
        )}
      </main>
      <footer className="site-footer page-width">
        <div className="footer-brand">
          <Scale size={19} />
          <strong>Practice Grader.</strong>
          <span>A clearer path to professional independence.</span>
        </div>
        <div>
          <button onClick={() => navigate("methodology")}>Methodology</button>
          <button onClick={() => setModal("preferences")}>
            Data & preferences
          </button>
          <a href="/admin">Administration</a>
          <a href="/benchmarks">Benchmarks</a>
          <a href="/leaderboard">Leaderboard</a>
          <span>Interactive preview · {publishedRelease.id}</span>
        </div>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {(modal === "preferences" || modal === "sharing") &&
        renderPreferences(modal === "sharing")}
      {modal === "clear" && (
        <Dialog
          title="Clear this device’s preview data?"
          close={() => setModal(null)}
        >
          <p>
            This removes saved assessments, action progress, preferences and
            local rubric changes, plus private scan access on this device.
            Download a copy first if you want to keep your reports. It does not
            cancel queued scans or delete public website findings already stored
            on the server. Public scan access expires after 30 days, and expired
            records are removed during scheduled cleanup.
          </p>
          <div className="button-row">
            <button className="btn btn-danger" onClick={clearData}>
              <Trash2 size={16} />
              Clear preview data
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setModal(null)}
            >
              Keep my data
            </button>
          </div>
        </Dialog>
      )}
      {contextSuggestion && (
        <Dialog
          title="Review public practice clues"
          close={() => setContextSuggestion(null)}
        >
          <p>
            We found the following public text clues. Confirm any detail before
            adding it. Locations mentioned on a website do not establish where
            you are licensed or serve clients.
          </p>
          <p className="scan-context-clues">
            {[
              contextSuggestion.suggestedContext.firmName,
              ...contextSuggestion.suggestedContext.practiceAreas,
              ...contextSuggestion.suggestedContext.locations,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <label className="field-label">
            Main practice area
            <select
              aria-label="Suggested main practice area"
              value={suggestedPracticeArea}
              onChange={(event) => setSuggestedPracticeArea(event.target.value)}
            >
              <option value="">Keep my current answer</option>
              {[
                "Family law",
                "Estate planning",
                "Immigration",
                "Criminal defense",
                "Personal injury",
                "Business law",
                "Employment",
                "Real estate",
                "General practice",
                "Other",
              ].map((area) => (
                <option key={area}>{area}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Confirmed service jurisdiction
            <input
              aria-label="Confirmed service jurisdiction"
              value={suggestedJurisdiction}
              maxLength={80}
              placeholder="Type only a jurisdiction you actually serve"
              onChange={(event) => setSuggestedJurisdiction(event.target.value)}
            />
          </label>
          <div className="button-row">
            <button
              className="btn btn-primary"
              onClick={() => {
                setContext((previous) => ({
                  ...previous,
                  practiceArea: suggestedPracticeArea || previous.practiceArea,
                  jurisdiction:
                    suggestedJurisdiction.trim() || previous.jurisdiction,
                }));
                setContextSuggestion(null);
                notify(
                  "Confirmed details added. No questionnaire answers or scores changed.",
                );
              }}
            >
              Use my confirmed details <Check size={15} />
            </button>
            <button
              className="quiet-button"
              onClick={() => setContextSuggestion(null)}
            >
              Keep my answers
            </button>
          </div>
        </Dialog>
      )}
      {modal === "email" && (
        <Dialog
          title="Save your progress privately"
          close={() => setModal(null)}
        >
          <AccountPanel
            selectedReport={current ?? undefined}
            onImport={importAccountReport}
          />
          <div className="button-row">
            <button
              className="btn btn-primary"
              onClick={() => {
                setModal(null);
                window.print();
              }}
            >
              Print / save PDF
              <Download size={16} />
            </button>
            <button className="btn btn-secondary" onClick={exportData}>
              Download data
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
