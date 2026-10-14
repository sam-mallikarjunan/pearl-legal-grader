export const DOMAIN_IDS = [
  "presence",
  "intake",
  "service",
  "cash",
  "operations",
  "independence",
] as const;
export type DomainId = (typeof DOMAIN_IDS)[number];
export type Goal =
  | "more_clients"
  | "better_conversion"
  | "collect_cash"
  | "less_admin"
  | "sustainable_practice";
export type PracticeStage = "prelaunch" | "new" | "established";
export type FeeModel =
  | "hourly"
  | "flat"
  | "contingency"
  | "subscription"
  | "mixed"
  | "other";
export interface PracticeContext {
  stage: PracticeStage;
  practiceArea: string;
  jurisdiction: string;
  goal: Goal;
  feeModel: FeeModel;
  capacityAdditionalMatters: number | null;
  websiteStatus: "has_site" | "no_site" | "unknown";
  websiteUrl?: string;
  usesAI: boolean | null;
  handlesClientFunds: boolean | null;
}
export type ScoredAnswer = "not_yet" | "ad_hoc" | "consistent" | "reviewed";
export type AnswerValue = ScoredAnswer | "unknown" | "not_applicable";
export type Answers = Record<string, AnswerValue>;
export interface AnswerOption {
  value: AnswerValue;
  label: string;
  points: 0 | 40 | 70 | 100 | null;
}
export interface DomainDefinition {
  id: DomainId;
  title: string;
  description: string;
  weight: number;
  color: string;
}
export type ApplicabilityRule = "always" | "website" | "invoiced_fees";
export interface QuestionDefinition {
  id: string;
  domain: DomainId;
  title: string;
  help: string;
  weight: number;
  mandatory: boolean;
  applicability: ApplicabilityRule;
  allowNotApplicable: boolean;
  catalogueIds: string[];
  options: AnswerOption[];
}
export type ControlId = "deadline" | "mfa" | "ai_review" | "client_funds";
export type ControlStatus = "yes" | "no" | "unknown" | "not_applicable";
export type ControlAnswers = Partial<Record<ControlId, ControlStatus>>;
export interface ControlFinding {
  id: ControlId;
  title: string;
  status: ControlStatus;
  applicable: boolean;
  note: string;
}
export type ActionTrigger =
  | { type: "question_below"; questionIds: string[]; threshold: number }
  | { type: "unknown"; questionIds: string[] }
  | { type: "control"; controlId: ControlId }
  | { type: "no_website" }
  | { type: "capacity_full" };
export interface ActionTemplate {
  id: string;
  domain: DomainId;
  title: string;
  summary: string;
  steps: string[];
  effort: string;
  definitionOfDone: string;
  verification: string;
  goalFit: Goal[];
  requiresCapacity: boolean;
  trigger: ActionTrigger;
}
export interface ReleaseSnapshot {
  id: string;
  label: string;
  status: "approved";
  provisional: true;
  rubricNote: string;
  minCoverage: number;
  domains: DomainDefinition[];
  questions: QuestionDefinition[];
  actions: ActionTemplate[];
}
export interface QuestionFinding {
  questionId: string;
  title: string;
  answer: AnswerValue;
  points: number | null;
  weight: number;
  applicable: boolean;
  mandatory: boolean;
  note: string;
}
export interface DomainAssessment {
  id: DomainId;
  title: string;
  status: "scored" | "incomplete" | "not_applicable";
  score: number | null;
  coverage: number;
  answeredCount: number;
  applicableCount: number;
  lowerBound: number | null;
  upperBound: number | null;
  missingMandatory: string[];
  findings: QuestionFinding[];
  note: string;
}
export interface PrioritizedAction extends ActionTemplate {
  priority: "high" | "medium" | "low";
  priorityReasons: string[];
}
export interface AssessmentInput {
  context: PracticeContext;
  answers: Answers;
  controls: ControlAnswers;
  release: ReleaseSnapshot;
}
export interface PracticeAssessment {
  releaseId: string;
  releaseSnapshot: ReleaseSnapshot;
  contextSnapshot: PracticeContext;
  answersSnapshot: Answers;
  controlsSnapshot: ControlAnswers;
  domains: DomainAssessment[];
  overallScore: number | null;
  overallNote: string;
  coverage: number;
  controls: ControlFinding[];
  actions: PrioritizedAction[];
  provisional: true;
  evidenceLabel: string;
}
