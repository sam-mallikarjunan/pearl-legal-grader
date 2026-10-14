import { DOMAIN_IDS } from "./types";
import type {
  ActionTemplate,
  AnswerValue,
  AssessmentInput,
  ControlFinding,
  ControlId,
  ControlStatus,
  DomainAssessment,
  Goal,
  PracticeAssessment,
  PracticeContext,
  PrioritizedAction,
  QuestionDefinition,
  QuestionFinding,
  ReleaseSnapshot,
} from "./types";

const scoredValues = ["not_yet", "ad_hoc", "consistent", "reviewed"] as const;
const answerValues: AnswerValue[] = [
  ...scoredValues,
  "unknown",
  "not_applicable",
];
const fixedPoints = {
  not_yet: 0,
  ad_hoc: 40,
  consistent: 70,
  reviewed: 100,
  unknown: null,
  not_applicable: null,
} as const;
const goalValues: Goal[] = [
  "more_clients",
  "better_conversion",
  "collect_cash",
  "less_admin",
  "sustainable_practice",
];
const controlIds: ControlId[] = [
  "deadline",
  "mfa",
  "ai_review",
  "client_funds",
];
const round = (value: number) => Math.round(value * 10) / 10;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** The returned clone can be edited as a draft without mutating a prior release. */
export function cloneReleaseSnapshot(
  release: ReleaseSnapshot,
): ReleaseSnapshot {
  return JSON.parse(JSON.stringify(release)) as ReleaseSnapshot;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Runtime validation also handles corrupt local-storage or imported draft values. */
export function validateRelease(value: unknown): string[] {
  const errors: string[] = [];
  if (!object(value)) return ["A release must be an object."];
  if (typeof value.id !== "string" || !value.id.trim())
    errors.push("A release needs a stable ID.");
  if (typeof value.label !== "string" || !value.label.trim())
    errors.push("A release needs a label.");
  if (value.status !== "approved")
    errors.push("Only an approved local release can be assessed.");
  if (value.provisional !== true)
    errors.push("The preview rubric must be marked provisional.");
  if (typeof value.rubricNote !== "string" || !value.rubricNote.trim())
    errors.push("The rubric needs its provisional evidence explanation.");
  if (
    typeof value.minCoverage !== "number" ||
    !Number.isFinite(value.minCoverage) ||
    value.minCoverage < 0.8 ||
    value.minCoverage > 1
  )
    errors.push("Minimum coverage must be between 80% and 100%.");
  if (
    !Array.isArray(value.domains) ||
    !Array.isArray(value.questions) ||
    !Array.isArray(value.actions)
  )
    return [...errors, "Domains, questions and actions must be arrays."];
  const seenDomains = new Set<string>();
  for (const domain of value.domains) {
    if (!object(domain) || !DOMAIN_IDS.includes(domain.id as never)) {
      errors.push("A domain has an unsupported ID.");
      continue;
    }
    const id = domain.id as string;
    if (seenDomains.has(id)) errors.push(`Duplicate domain: ${id}.`);
    seenDomains.add(id);
    if (typeof domain.title !== "string" || !domain.title.trim())
      errors.push(`${id} needs a title.`);
    if (typeof domain.description !== "string" || !domain.description.trim())
      errors.push(`${id} needs a description.`);
    if (typeof domain.color !== "string" || !domain.color.trim())
      errors.push(`${id} needs a color.`);
    if (
      typeof domain.weight !== "number" ||
      !Number.isFinite(domain.weight) ||
      domain.weight <= 0
    )
      errors.push(`${id} needs a positive finite module weight.`);
  }
  DOMAIN_IDS.forEach((id) => {
    if (!seenDomains.has(id)) errors.push(`Missing domain: ${id}.`);
  });
  const seenQuestions = new Set<string>();
  const domainWeights: Record<string, number> = {};
  for (const q of value.questions) {
    if (!object(q) || typeof q.id !== "string" || !q.id.trim()) {
      errors.push("A question needs a stable ID.");
      continue;
    }
    if (seenQuestions.has(q.id)) errors.push(`Duplicate question: ${q.id}.`);
    seenQuestions.add(q.id);
    if (typeof q.domain !== "string" || !seenDomains.has(q.domain))
      errors.push(`${q.id} references an unknown domain.`);
    if (typeof q.title !== "string" || !q.title.trim())
      errors.push(`${q.id} needs question wording.`);
    if (typeof q.help !== "string" || !q.help.trim())
      errors.push(`${q.id} needs help text.`);
    if (
      typeof q.weight !== "number" ||
      !Number.isFinite(q.weight) ||
      q.weight < 0
    )
      errors.push(`${q.id} needs a nonnegative finite weight.`);
    else if (typeof q.domain === "string")
      domainWeights[q.domain] = (domainWeights[q.domain] ?? 0) + q.weight;
    if (
      typeof q.mandatory !== "boolean" ||
      typeof q.allowNotApplicable !== "boolean"
    )
      errors.push(`${q.id} needs explicit evidence and N/A policies.`);
    if (
      !["always", "website", "invoiced_fees"].includes(
        q.applicability as string,
      )
    )
      errors.push(`${q.id} has an unsupported applicability rule.`);
    if (!Array.isArray(q.options)) {
      errors.push(`${q.id} needs typed answer options.`);
      continue;
    }
    const seenOptions = new Set<string>();
    for (const option of q.options) {
      if (
        !object(option) ||
        !answerValues.includes(option.value as AnswerValue)
      ) {
        errors.push(`${q.id} has an unsupported answer option.`);
        continue;
      }
      const optionValue = option.value as AnswerValue;
      if (seenOptions.has(optionValue))
        errors.push(`${q.id} has duplicate answer options.`);
      seenOptions.add(optionValue);
      if (option.points !== fixedPoints[optionValue])
        errors.push(
          `${q.id}: ${optionValue} must retain its provisional ${String(fixedPoints[optionValue])} point value.`,
        );
      if (typeof option.label !== "string" || !option.label.trim())
        errors.push(`${q.id} has an unlabeled option.`);
    }
    [...scoredValues, "unknown"].forEach((option) => {
      if (!seenOptions.has(option))
        errors.push(`${q.id} is missing ${option}.`);
    });
    if (q.allowNotApplicable === true && !seenOptions.has("not_applicable"))
      errors.push(`${q.id} allows N/A but has no N/A option.`);
  }
  DOMAIN_IDS.forEach((id) => {
    if (!(domainWeights[id] > 0))
      errors.push(
        `${id} must contain at least one enabled positive-weight question.`,
      );
  });
  const actionIds = new Set<string>();
  for (const a of value.actions) {
    if (!object(a) || typeof a.id !== "string" || !a.id.trim()) {
      errors.push("An action needs a stable ID.");
      continue;
    }
    if (actionIds.has(a.id)) errors.push(`Duplicate action: ${a.id}.`);
    actionIds.add(a.id);
    if (typeof a.domain !== "string" || !seenDomains.has(a.domain))
      errors.push(`${a.id} references an unknown domain.`);
    for (const key of [
      "title",
      "summary",
      "effort",
      "definitionOfDone",
      "verification",
    ])
      if (typeof a[key] !== "string" || !(a[key] as string).trim())
        errors.push(`${a.id} needs ${key}.`);
    if (
      !Array.isArray(a.steps) ||
      !a.steps.length ||
      a.steps.some((step: unknown) => typeof step !== "string" || !step.trim())
    )
      errors.push(`${a.id} needs concrete steps.`);
    if (
      !Array.isArray(a.goalFit) ||
      a.goalFit.some((goal: unknown) => !goalValues.includes(goal as Goal))
    )
      errors.push(`${a.id} has invalid goal routing.`);
    if (typeof a.requiresCapacity !== "boolean")
      errors.push(`${a.id} needs an explicit capacity policy.`);
    if (!object(a.trigger)) {
      errors.push(`${a.id} needs a trigger.`);
      continue;
    }
    if (["question_below", "unknown"].includes(a.trigger.type as string)) {
      if (
        !Array.isArray(a.trigger.questionIds) ||
        !a.trigger.questionIds.length ||
        a.trigger.questionIds.some(
          (id: unknown) => typeof id !== "string" || !seenQuestions.has(id),
        )
      )
        errors.push(`${a.id} references unknown questions.`);
      if (
        a.trigger.type === "question_below" &&
        (typeof a.trigger.threshold !== "number" ||
          !Number.isFinite(a.trigger.threshold) ||
          a.trigger.threshold < 0 ||
          a.trigger.threshold > 100)
      )
        errors.push(`${a.id} needs a threshold from 0 to 100.`);
    } else if (a.trigger.type === "control") {
      if (!controlIds.includes(a.trigger.controlId as ControlId))
        errors.push(`${a.id} references an unknown control.`);
    } else if (
      !["no_website", "capacity_full"].includes(a.trigger.type as string)
    )
      errors.push(`${a.id} uses an unsupported trigger.`);
  }
  return errors;
}

export function getQuestionApplicability(
  question: QuestionDefinition,
  context: PracticeContext,
): { applicable: boolean; reason: string } {
  if (question.weight === 0)
    return {
      applicable: false,
      reason: "Disabled in this assessment release.",
    };
  if (
    question.applicability === "website" &&
    context.websiteStatus === "no_site"
  )
    return {
      applicable: false,
      reason:
        "You reported no website. This website question is not applicable and earns no penalty.",
    };
  if (
    question.applicability === "invoiced_fees" &&
    context.feeModel === "contingency"
  )
    return {
      applicable: false,
      reason:
        "This invoicing question is outside the contingency-only branch. Confirm its relevance before using it.",
    };
  return { applicable: true, reason: "" };
}

function makeFinding(
  question: QuestionDefinition,
  context: PracticeContext,
  inputAnswer?: AnswerValue,
): QuestionFinding {
  const rule = getQuestionApplicability(question, context);
  const answer = answerValues.includes(inputAnswer as AnswerValue)
    ? (inputAnswer as AnswerValue)
    : "unknown";
  const base = {
    questionId: question.id,
    title: question.title,
    weight: question.weight,
    mandatory: question.mandatory,
  };
  if (!rule.applicable)
    return {
      ...base,
      answer: "not_applicable",
      points: null,
      applicable: false,
      note: rule.reason,
    };
  if (answer === "not_applicable" && question.allowNotApplicable)
    return {
      ...base,
      answer,
      points: null,
      applicable: false,
      note: "Explicitly marked not applicable under this question's published policy.",
    };
  if (answer === "not_applicable")
    return {
      ...base,
      answer,
      points: null,
      applicable: true,
      note: "N/A is not established for this question. Confirm applicability; this remains unknown, not zero.",
    };
  const selected = question.options.find((option) => option.value === answer);
  if (!selected || selected.points === null)
    return {
      ...base,
      answer: "unknown",
      points: null,
      applicable: true,
      note: "Not assessed. An unknown answer earns no penalty and does not establish a capability.",
    };
  return {
    ...base,
    answer,
    points: selected.points,
    applicable: true,
    note:
      selected.points === 0
        ? "Owner reports this process is not yet in place. This is a provisional rubric observation."
        : "Owner-reported process maturity; not independently verified.",
  };
}

function assessDomain(
  id: DomainAssessment["id"],
  input: AssessmentInput,
): DomainAssessment {
  const definition = input.release.domains.find((domain) => domain.id === id)!;
  const findings = input.release.questions
    .filter((q) => q.domain === id)
    .map((q) => makeFinding(q, input.context, input.answers[q.id]));
  const applicable = findings.filter((f) => f.applicable);
  const totalWeight = applicable.reduce(
    (total, finding) => total + finding.weight,
    0,
  );
  const known = applicable.filter((f) => f.points !== null);
  const knownWeight = known.reduce(
    (total, finding) => total + finding.weight,
    0,
  );
  const weightedPoints = known.reduce(
    (total, finding) => total + finding.points! * finding.weight,
    0,
  );
  const missingMandatory = applicable
    .filter((f) => f.mandatory && f.points === null)
    .map((f) => f.questionId);
  const base = {
    id,
    title: definition.title,
    findings,
    answeredCount: known.length,
    applicableCount: applicable.length,
    missingMandatory,
  };
  if (totalWeight === 0)
    return {
      ...base,
      status: "not_applicable",
      score: null,
      coverage: 0,
      lowerBound: null,
      upperBound: null,
      note: "This module is outside the current applicable scope. No penalty is assigned.",
    };
  const coverage = knownWeight / totalWeight;
  const eligible =
    coverage + Number.EPSILON >= input.release.minCoverage &&
    missingMandatory.length === 0 &&
    knownWeight > 0;
  return {
    ...base,
    status: eligible ? "scored" : "incomplete",
    score: eligible ? round(weightedPoints / knownWeight) : null,
    coverage,
    lowerBound: round(weightedPoints / totalWeight),
    upperBound: round(
      (weightedPoints + (totalWeight - knownWeight) * 100) / totalWeight,
    ),
    note: eligible
      ? "A provisional module score from applicable owner-reported answers. Evidence coverage is separate from quality."
      : "More applicable evidence is needed. Bounds show possible rubric values if missing answers were known; they are not statistical confidence intervals.",
  };
}

export function assessControls(
  context: PracticeContext,
  answers: AssessmentInput["controls"],
): ControlFinding[] {
  const titles: Record<ControlId, string> = {
    deadline: "Deadline capture and backup",
    mfa: "Protection for important accounts",
    ai_review: "Qualified review of AI legal output",
    client_funds: "Applicable client-funds reconciliation",
  };
  return controlIds.map((id) => {
    const inapplicable =
      (id === "ai_review" && context.usesAI === false) ||
      (id === "client_funds" && context.handlesClientFunds === false);
    if (inapplicable)
      return {
        id,
        title: titles[id],
        applicable: false,
        status: "not_applicable",
        note: "Outside the applicability you reported. This control contributes no grade points.",
      };
    const raw = answers[id] ?? "unknown";
    const status: ControlStatus = ["yes", "no", "unknown"].includes(raw)
      ? (raw as ControlStatus)
      : "unknown";
    return {
      id,
      title: titles[id],
      applicable: true,
      status,
      note:
        status === "yes"
          ? "Reported in place; not independently verified or a compliance certification."
          : status === "no"
            ? "You reported a gap. Review the actual arrangement and appropriate next steps."
            : "Applicability or the working arrangement needs confirmation. Unknown is not a finding of failure.",
    };
  });
}

function actionPriority(
  action: ActionTemplate,
  input: AssessmentInput,
  domains: DomainAssessment[],
  controls: ControlFinding[],
): { rank: number; reasons: string[] } | null {
  if (
    action.requiresCapacity &&
    !(
      input.context.capacityAdditionalMatters !== null &&
      input.context.capacityAdditionalMatters > 0
    )
  )
    return null;
  const findings = domains.flatMap((domain) => domain.findings);
  let rank = 25;
  const reasons: string[] = [];
  const trigger = action.trigger;
  if (trigger.type === "question_below") {
    const matched = findings.filter(
      (f) =>
        trigger.questionIds.includes(f.questionId) &&
        f.applicable &&
        f.points !== null &&
        f.points < trigger.threshold,
    );
    if (!matched.length) return null;
    rank += Math.max(...matched.map((f) => (100 - f.points!) / 5));
    reasons.push("A reported process suggests a useful improvement.");
  } else if (trigger.type === "unknown") {
    if (
      !findings.some(
        (f) =>
          trigger.questionIds.includes(f.questionId) &&
          f.applicable &&
          f.points === null,
      )
    )
      return null;
    reasons.push("Clarifying an unknown could change the recommendation.");
  } else if (trigger.type === "control") {
    const control = controls.find((c) => c.id === trigger.controlId);
    if (!control || !control.applicable || control.status === "yes")
      return null;
    const applicabilityUnconfirmed =
      (trigger.controlId === "ai_review" && input.context.usesAI === null) ||
      (trigger.controlId === "client_funds" &&
        input.context.handlesClientFunds === null);
    rank = control.status === "no" ? 100 : applicabilityUnconfirmed ? 30 : 50;
    reasons.push(
      control.status === "no"
        ? "You reported an important control gap; review it separately from the grade."
        : applicabilityUnconfirmed
          ? "First confirm whether this control applies; its unknown status does not establish a gap."
          : "Confirm this applicable control before drawing a conclusion.",
    );
  } else if (trigger.type === "no_website") {
    if (input.context.websiteStatus !== "no_site") return null;
    reasons.push(
      "Choose public information that fits your actual client journey.",
    );
  } else if (trigger.type === "capacity_full") {
    if (
      input.context.capacityAdditionalMatters === null ||
      input.context.capacityAdditionalMatters > 0
    )
      return null;
    rank = 80;
    reasons.push(
      "You reported no spare matter capacity; increasing demand may add pressure.",
    );
  }
  if (action.goalFit.includes(input.context.goal)) {
    rank += 20;
    reasons.push("Supports the improvement you chose.");
  }
  // Reserve first priority for explicitly reported control gaps, even when a
  // goal-aligned capacity action would otherwise tie their rank.
  if (trigger.type !== "control") rank = Math.min(rank, 99);
  return { rank, reasons };
}

export function assessPractice(input: AssessmentInput): PracticeAssessment {
  const errors = validateRelease(input.release);
  if (errors.length) throw new Error(`Invalid release: ${errors.join(" ")}`);
  if (
    input.context.capacityAdditionalMatters !== null &&
    !Number.isFinite(input.context.capacityAdditionalMatters)
  )
    throw new Error("Capacity must be a finite estimate or unknown.");
  const copiedInput: AssessmentInput = {
    release: cloneReleaseSnapshot(input.release),
    context: { ...input.context },
    answers: { ...input.answers },
    controls: { ...input.controls },
  };
  const domains = DOMAIN_IDS.map((id) => assessDomain(id, copiedInput));
  const activeDomains = domains.filter(
    (domain) => domain.status !== "not_applicable",
  );
  const allRequiredEvidence =
    activeDomains.length > 0 &&
    activeDomains.every((domain) => domain.status === "scored");
  const totalDomainWeight = activeDomains.reduce(
    (sum, domain) =>
      sum + copiedInput.release.domains.find((d) => d.id === domain.id)!.weight,
    0,
  );
  const overallScore = allRequiredEvidence
    ? round(
        activeDomains.reduce(
          (sum, domain) =>
            sum +
            domain.score! *
              copiedInput.release.domains.find((d) => d.id === domain.id)!
                .weight,
          0,
        ) / totalDomainWeight,
      )
    : null;
  const coverage = activeDomains.length
    ? activeDomains.reduce(
        (sum, domain) =>
          sum +
          domain.coverage *
            copiedInput.release.domains.find((d) => d.id === domain.id)!.weight,
        0,
      ) / totalDomainWeight
    : 0;
  const controls = assessControls(copiedInput.context, copiedInput.controls);
  const actions = copiedInput.release.actions
    .map((action) => ({
      action,
      match: actionPriority(action, copiedInput, domains, controls),
    }))
    .filter(
      (
        entry,
      ): entry is {
        action: ActionTemplate;
        match: { rank: number; reasons: string[] };
      } => entry.match !== null,
    )
    .sort(
      (a, b) =>
        b.match.rank - a.match.rank || a.action.id.localeCompare(b.action.id),
    )
    .map(
      ({ action, match }): PrioritizedAction => ({
        ...action,
        priority:
          match.rank >= 65 ? "high" : match.rank >= 40 ? "medium" : "low",
        priorityReasons: match.reasons,
      }),
    );
  return deepFreeze({
    releaseId: copiedInput.release.id,
    releaseSnapshot: copiedInput.release,
    contextSnapshot: copiedInput.context,
    answersSnapshot: copiedInput.answers,
    controlsSnapshot: copiedInput.controls,
    domains,
    overallScore,
    overallNote:
      overallScore === null
        ? "The whole-practice summary is withheld because applicable module evidence is incomplete."
        : "Provisional owner-reported maturity summary across assessed applicable modules. Controls remain separate; this is not a measure of legal competence or a compliance certification.",
    coverage,
    controls,
    actions,
    provisional: true,
    evidenceLabel: "Owner-reported · provisional rubric · no live website scan",
  });
}
