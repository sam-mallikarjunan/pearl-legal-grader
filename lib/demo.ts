import type { Answers, ControlAnswers, PracticeContext } from "./types";

export const SAMPLE_CONTEXT: PracticeContext = {
  stage: "established",
  practiceArea: "Family law",
  jurisdiction: "Oregon",
  goal: "collect_cash",
  feeModel: "mixed",
  capacityAdditionalMatters: 2,
  websiteStatus: "has_site",
  websiteUrl: "https://juniper-family.example",
  usesAI: true,
  handlesClientFunds: true,
};

export const SAMPLE_ANSWERS: Answers = {
  "presence-1": "consistent",
  "presence-2": "consistent",
  "presence-3": "ad_hoc",
  "presence-4": "consistent",
  "intake-1": "consistent",
  "intake-2": "ad_hoc",
  "intake-3": "ad_hoc",
  "intake-4": "consistent",
  "service-1": "consistent",
  "service-2": "consistent",
  "service-3": "ad_hoc",
  "service-4": "consistent",
  "cash-1": "consistent",
  "cash-2": "ad_hoc",
  "cash-3": "not_yet",
  "cash-4": "ad_hoc",
  "operations-1": "consistent",
  "operations-2": "ad_hoc",
  "operations-3": "ad_hoc",
  "operations-4": "ad_hoc",
  "independence-1": "ad_hoc",
  "independence-2": "consistent",
  "independence-3": "reviewed",
  "independence-4": "consistent",
};

export const SAMPLE_CONTROLS: ControlAnswers = {
  deadline: "yes",
  mfa: "yes",
  ai_review: "yes",
  client_funds: "yes",
};
