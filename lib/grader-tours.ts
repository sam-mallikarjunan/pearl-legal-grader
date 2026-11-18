import type { GuidedTourStep } from "../components/GuidedTour";

interface GraderTour {
  title: string;
  description: string;
  autoOffer: boolean;
  steps: GuidedTourStep[];
}

export const GRADER_TOURS: Record<string, GraderTour> = {
  start: {
    title: "A quick tour of the grader",
    description:
      "See where to start, what you’ll get, and how to save your progress.",
    autoOffer: true,
    steps: [
      {
        id: "website",
        target: '[data-tour="start-website"]',
        title: "Start with what you have",
        body: "Paste your firm’s public website to add website checks. If you don’t have one yet, select “I don’t have a website yet.” You’ll get a practice assessment either way.",
      },
      {
        id: "example",
        target: '[data-tour="start-example"]',
        title: "See a report before you begin",
        body: "This fictional example shows the scores, evidence and action plan you’ll receive. You can explore it before answering about your own firm.",
      },
      {
        id: "account",
        target: '[data-tour="private-account"]',
        title: "Save when it’s useful",
        body: "You can get a report without an account. Sign in later to save selected reports and continue on another device. Taking a tour doesn’t upload your answers or enroll you in emails.",
      },
    ],
  },
  "assessment-context": {
    title: "Choose a useful starting point",
    description: "A short guide to these questions.",
    autoOffer: false,
    steps: [
      {
        id: "goal",
        target: '[data-tour="assessment-goals"]',
        title: "Choose what matters to you",
        body: "Pick the outcome you want to work on first. Your goal helps choose relevant questions and actions; it doesn’t earn or lose points.",
      },
      {
        id: "context",
        target: '[data-tour="assessment-context"]',
        title: "Give just enough context",
        body: "Practice stage, fee model and capacity help make the assessment relevant. Optional fields can stay blank. Keep client details and private documents out of the grader.",
      },
      {
        id: "draft",
        target: '[data-tour="assessment-draft"]',
        title: "Your draft stays on this device",
        body: "Your answers are saved here as you go when browser storage is available. Close this tour, then choose Continue when you’re ready. You can return to the draft later.",
      },
    ],
  },
  "assessment-questions": {
    title: "Answer with the evidence you have",
    description: "A short guide to the focused checkup.",
    autoOffer: false,
    steps: [
      {
        id: "questions",
        target: '[data-tour="assessment-questions"]',
        title: "Describe what happens in practice",
        body: "Choose the response that best describes your current process. The helpful answer is an accurate one, even when the process is still informal.",
      },
      {
        id: "unknown",
        target: '[data-tour="assessment-unknown"]',
        title: "Unknown is a useful answer",
        body: "Use “not sure” or leave an answer blank when you don’t know. Missing evidence stays unknown rather than becoming a failing mark. Coverage explains how much supports the grade.",
      },
      {
        id: "draft",
        target: '[data-tour="assessment-draft"]',
        title: "Continue at your own pace",
        body: "The draft is saved on this device when storage is available. Close this tour to answer questions, go back, or continue to the separate safeguards check.",
      },
    ],
  },
  "assessment-safeguards": {
    title: "Understand the safeguards check",
    description: "A short guide before you finish.",
    autoOffer: false,
    steps: [
      {
        id: "safeguards",
        target: '[data-tour="assessment-safeguards"]',
        title: "Keep important concerns visible",
        body: "These safeguards stay separate from numerical averages. A strong score in another area won’t hide a reported concern. Answers are not a compliance certification.",
      },
      {
        id: "unknown",
        target: '[data-tour="assessment-finish"]',
        title: "You can leave uncertainty visible",
        body: "Unanswered safeguards remain unknown. Close this tour and review what you know before choosing “See my report” to save your dated assessment.",
      },
    ],
  },
  report: {
    title: "Make your report useful",
    description:
      "Understand the evidence, choose one action, and know where to return.",
    autoOffer: true,
    steps: [
      {
        id: "evidence",
        target: '[data-tour="report-evidence"]',
        title: "Know what the grade means",
        body: "This is a provisional view of operating readiness based on your answers. It doesn’t rank your legal skill. Website observations, when available, are dated and shown separately.",
      },
      {
        id: "priority",
        target: '[data-tour="report-overview"]',
        title: "Start with your chosen goal",
        body: "The priority score and evidence coverage help explain this starting point. Unknown or inapplicable answers stay visible so a score doesn’t imply more evidence than you supplied.",
      },
      {
        id: "action",
        target: '.report-page [data-tour="action-card"]',
        title: "Pick one useful action",
        body: "Open “See how to do it” for a practical checklist and what done looks like. Track your progress when you try it. Marking an action complete doesn’t rewrite the issued grade.",
      },
      {
        id: "save",
        target: '[data-tour="report-save"]',
        title: "Come back with new evidence",
        body: "Your report is saved in this browser. Use My progress to track work and reassess, or choose “Save to my workspace” to keep a private copy and continue on another device.",
      },
    ],
  },
  progress: {
    title: "Use progress without losing your baseline",
    description: "A short guide to reports saved on this device.",
    autoOffer: false,
    steps: [
      {
        id: "scope",
        target: '[data-tour="progress-scope"]',
        title: "Know which progress you’re viewing",
        body: "This page shows reports and action states on this device. Your signed-in workspace has its own saved reports and progress. You choose which reports to save or open here.",
      },
      {
        id: "history",
        target: '[data-tour="progress-history"]',
        title: "Keep the earlier report",
        body: "Open a dated report from this history to revisit its evidence. A reassessment creates a new report. Comparisons are shown only when the context and evidence can be compared.",
      },
      {
        id: "reassess",
        target: '[data-tour="progress-reassess"]',
        title: "Reassess after something changes",
        body: "Use this when you have new evidence about your practice. A readiness-point change reflects your answers; it doesn’t by itself prove better business outcomes. Track those separately in the workspace.",
      },
    ],
  },
};
