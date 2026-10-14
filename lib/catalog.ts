import type {
  ActionTemplate,
  AnswerOption,
  DomainDefinition,
  DomainId,
  QuestionDefinition,
  ReleaseSnapshot,
} from "./types";

export const DOMAIN_DEFINITIONS: DomainDefinition[] = [
  {
    id: "presence",
    title: "Public presence",
    description: "Can a suitable client understand your offer and reach you?",
    weight: 1,
    color: "#586e9e",
  },
  {
    id: "intake",
    title: "Intake & opportunity",
    description: "Give suitable inquiries an accountable next step.",
    weight: 1,
    color: "#9b7846",
  },
  {
    id: "service",
    title: "Client experience",
    description: "Make expectations, updates and handovers clear.",
    weight: 1,
    color: "#788b70",
  },
  {
    id: "cash",
    title: "Pricing & cash",
    description: "Help clients understand fees and manage the cash workflow.",
    weight: 1,
    color: "#af735e",
  },
  {
    id: "operations",
    title: "Practice operations",
    description: "Reduce avoidable work and learn from dependable records.",
    weight: 1,
    color: "#8c79a3",
  },
  {
    id: "independence",
    title: "Owner independence",
    description: "Build a practice that supports the life you choose.",
    weight: 1,
    color: "#4f8d89",
  },
];

const options = (labels: [string, string, string, string]): AnswerOption[] => [
  { value: "not_yet", label: labels[0], points: 0 },
  { value: "ad_hoc", label: labels[1], points: 40 },
  { value: "consistent", label: labels[2], points: 70 },
  { value: "reviewed", label: labels[3], points: 100 },
  { value: "unknown", label: "I'm not sure yet", points: null },
];
type QInput = Omit<
  QuestionDefinition,
  "weight" | "mandatory" | "applicability" | "allowNotApplicable"
> &
  Partial<
    Pick<
      QuestionDefinition,
      "weight" | "mandatory" | "applicability" | "allowNotApplicable"
    >
  >;
const question = (q: QInput): QuestionDefinition => ({
  weight: 1,
  mandatory: true,
  applicability: "always",
  allowNotApplicable: false,
  ...q,
});
const web = (
  id: string,
  title: string,
  help: string,
  catalogueIds: string[],
  labels: [string, string, string, string],
) =>
  question({
    id,
    domain: "presence",
    title,
    help,
    catalogueIds,
    applicability: "website",
    options: options(labels),
  });
const process = (
  id: string,
  title: string,
  help: string,
  catalogueIds: string[],
  labels: [string, string, string, string],
) =>
  question({
    id,
    domain: id.split("-")[0] as DomainId,
    title,
    help,
    catalogueIds,
    options: options(labels),
  });

export const QUESTIONS: QuestionDefinition[] = [
  web(
    "presence-1",
    "Does your website make it clear whom you help?",
    "Think about the clients, legal problems and service geography stated on your main pages. This is your report, not an automated review.",
    ["GR-143", "GR-145"],
    [
      "It doesn't yet",
      "Some of that is clear",
      "Clients, services and geography are clearly stated",
      "We've also checked comprehension with intended clients",
    ],
  ),
  web(
    "presence-2",
    "Can a visitor find a clear way to contact you?",
    "Assess the contact path you provide. We will not call, submit forms or test it in this preview.",
    ["GR-150"],
    [
      "There is no clear contact path",
      "Contact details exist but can be hard to find",
      "Contact details and the next step are clear",
      "We regularly check the contact path and fix problems",
    ],
  ),
  web(
    "presence-3",
    "Have you checked the contact journey on a phone?",
    "A manual owner-reported mobile check; no speed or accessibility audit is performed.",
    ["GR-163"],
    [
      "We haven't checked",
      "Someone has looked at it informally",
      "We have completed the contact journey on a phone",
      "We repeat that check and track fixes",
    ],
  ),
  web(
    "presence-4",
    "Does the site explain what happens after contact?",
    "For example, consultation cost, the fee approach and the first steps. This does not ask you to publish a universal fixed price.",
    ["GR-149"],
    [
      "It doesn't yet",
      "It explains a few steps",
      "The next steps and fee approach are explained",
      "We review those explanations using questions clients ask",
    ],
  ),
  process(
    "intake-1",
    "Does every new inquiry have a clear owner?",
    "Include a backup for when the usual person is unavailable.",
    ["GR-104"],
    [
      "No one is clearly responsible",
      "We work it out as inquiries arrive",
      "There is a named owner and a backup",
      "We also review missed handoffs and fix them",
    ],
  ),
  process(
    "intake-2",
    "How do you manage the first substantive response?",
    "An acknowledgment alone is different from a useful response. There is no universal response-time benchmark in this rubric.",
    ["GR-095", "GR-098"],
    [
      "There is no agreed approach",
      "We try to respond quickly, without a shared expectation",
      "We have a clear response expectation and assigned coverage",
      "We measure actual responses and review exceptions",
    ],
  ),
  process(
    "intake-3",
    "What happens when you miss an inquiry?",
    "Consider missed calls, form requests and other channels you actually use.",
    ["GR-094", "GR-099"],
    [
      "Missed inquiries may go untracked",
      "Someone follows up when they notice",
      "There is a defined recovery queue and owner",
      "We review unrecovered inquiries and whether recovery worked",
    ],
  ),
  process(
    "intake-4",
    "Is follow-up useful and respectful?",
    "The number of attempts earns no points. Consider relevance, permission and a clear stopping rule.",
    ["GR-121", "GR-122"],
    [
      "We have no shared approach",
      "Each person decides how to follow up",
      "We use relevant follow-up with permission and stopping rules",
      "We review contact results, complaints and opt-outs",
    ],
  ),
  process(
    "service-1",
    "Do clients understand the plan and expectations?",
    "Think about the service process and what you need from them; this is separate from reviewing legal engagement requirements.",
    ["GR-198", "GR-203"],
    [
      "We don't have a clear explanation",
      "We explain it differently each time",
      "Clients receive a clear plan and expectations",
      "We check understanding and improve the explanation",
    ],
  ),
  process(
    "service-2",
    "How do clients receive progress updates?",
    "Useful communication can vary with the matter. More messages are not automatically better.",
    ["GR-209"],
    [
      "Usually only when clients ask",
      "We update clients when we remember",
      "We agree a useful update approach and follow it",
      "We review update delivery and client feedback",
    ],
  ),
  process(
    "service-3",
    "Is collecting client information organized?",
    "Think about clear requests, avoiding repetition and tracking what is outstanding. Do not upload client documents here.",
    ["GR-201"],
    [
      "Requests and documents are often scattered",
      "We use an informal checklist",
      "We have a clear checklist, secure route and owner",
      "We review delays, repeat requests and needed changes",
    ],
  ),
  process(
    "service-4",
    "Is there a consistent closing handover?",
    "For example, what is complete, next steps, documents and who to contact later.",
    ["GR-219"],
    [
      "There is no consistent handover",
      "We provide some closing information",
      "Clients receive a clear closing handover",
      "We check completion and learn from client questions",
    ],
  ),
  process(
    "cash-1",
    "Do clients understand the fees and their scope?",
    "This is about comprehension and scope, not rewarding one fee model or the highest price.",
    ["GR-052"],
    [
      "Fees or scope are often unclear",
      "We explain them informally",
      "We explain scope, assumptions and possible changes clearly",
      "We check understanding and review common surprises",
    ],
  ),
  process(
    "cash-2",
    "Are payment timing and choices clear?",
    "Use the timing appropriate to your fee model, including contingencies. Offering credit is not required.",
    ["GR-063"],
    [
      "We have no clear explanation",
      "We explain timing when clients ask",
      "Clients receive clear timing, choices and implications",
      "We check understanding and review payment friction",
    ],
  ),
  {
    ...process(
      "cash-3",
      "Is invoicing consistent and timely?",
      "Only applies where you issue invoices for fees. This preview does not calculate a billing-delay benchmark.",
      ["GR-258", "GR-259"],
      [
        "We have no consistent invoicing process",
        "We invoice when someone has time",
        "We use a clear schedule with an accountable owner",
        "We review actual delays and resolve exceptions",
      ],
    ),
    applicability: "invoiced_fees",
  },
  {
    ...process(
      "cash-4",
      "Do you review overdue invoices and next steps?",
      "Only applies to invoiced fees. Do not enter client names or upload a ledger.",
      ["GR-263", "GR-272"],
      [
        "We don't regularly review them",
        "We look when cash becomes tight",
        "We review aging with an owner and clear next steps",
        "We track follow-through, disputes and collection results",
      ],
    ),
    applicability: "invoiced_fees",
  },
  process(
    "operations-1",
    "Do financial reviews lead to decisions?",
    "Use aggregate business information. No revenue or compensation figures are required.",
    ["GR-049"],
    [
      "There is no regular review",
      "We review when a problem comes up",
      "We review cash and financial reports on a regular cadence",
      "We reconcile reports, record decisions and follow through",
    ],
  ),
  process(
    "operations-2",
    "Do you know where avoidable administration occurs?",
    "Necessary administration is valuable. Focus on unwanted repetition, not eliminating all business work.",
    ["GR-249", "GR-412"],
    [
      "We don't know where the burden comes from",
      "We have a rough sense",
      "We identify recurring avoidable work and choose improvements",
      "We measure whether changes reduce that burden",
    ],
  ),
  process(
    "operations-3",
    "Is work assigned at an appropriate level?",
    "A solo can use outside help or a good self-managed workflow. Extra headcount earns no points.",
    ["GR-296", "GR-306"],
    [
      "Work is allocated without a clear approach",
      "We delegate when overloaded",
      "Work goes to appropriately qualified people with supervision",
      "We review quality, capacity and whether the approach helps",
    ],
  ),
  process(
    "operations-4",
    "Do your records distinguish the main client stages?",
    "For example, inquiry, suitable inquiry, consultation, engaged client and first payment. A specific CRM is not required.",
    ["GR-317"],
    [
      "Stages aren't recorded consistently",
      "We use some labels with mixed meanings",
      "We use clear definitions in a shared record",
      "We check stage data and reconcile exceptions",
    ],
  ),
  process(
    "independence-1",
    "Can you take planned time off with suitable coverage?",
    "Assess the working arrangement, not how many days off you choose to take.",
    ["GR-407"],
    [
      "There is no workable arrangement",
      "We improvise when leave is needed",
      "We have an agreed coverage arrangement",
      "We have used it and reviewed what needed improvement",
    ],
  ),
  process(
    "independence-2",
    "Are your availability boundaries clear?",
    "Consider normal hours, response expectations and an appropriate route for urgent needs.",
    ["GR-408"],
    [
      "There are no clear boundaries",
      "They are mostly understood informally",
      "Clients and colleagues know the expectations and urgent route",
      "We review recurring exceptions and adjust the arrangement",
    ],
  ),
  process(
    "independence-3",
    "Does the firm control its essential accounts?",
    "Think about your domain, phone number and business tools. Never enter passwords or recovery codes here.",
    ["GR-035"],
    [
      "Ownership or access is uncertain",
      "Some access depends on a single person or supplier",
      "The firm controls key accounts and recovery arrangements",
      "We review the account inventory and recovery arrangements",
    ],
  ),
  process(
    "independence-4",
    "Do practice priorities reflect your chosen goals?",
    "A sustainable small practice is a valid goal. This assesses a review process, not income, growth or personal satisfaction.",
    ["GR-021", "GR-393"],
    [
      "We haven't set clear priorities",
      "We have goals but rarely revisit them",
      "We have clear goals and review priorities against them",
      "We track chosen outcomes and adjust priorities deliberately",
    ],
  ),
];

const action = (a: ActionTemplate): ActionTemplate => a;
export const ACTION_TEMPLATES: ActionTemplate[] = [
  action({
    id: "clarify-offer",
    domain: "presence",
    title: "Make your public offer easier to understand",
    summary:
      "Help a suitable prospective client recognize whether you can help.",
    steps: [
      "Write the client, service and geography in plain language.",
      "Check the description with someone in the intended audience.",
      "Revise anything they misunderstood.",
    ],
    effort: "About one focused working session",
    definitionOfDone:
      "The core public description names whom you help and the relevant service geography.",
    verification:
      "Ask intended readers to explain the offer back in their own words.",
    goalFit: ["more_clients", "better_conversion"],
    requiresCapacity: false,
    trigger: {
      type: "question_below",
      questionIds: ["presence-1", "presence-4"],
      threshold: 70,
    },
  }),
  action({
    id: "check-contact",
    domain: "presence",
    title: "Check the contact journey on a phone",
    summary: "Find friction before a prospective client encounters it.",
    steps: [
      "Open your public contact path on a phone.",
      "Check readability, contact details and the stated next step.",
      "Record and fix the problems you find.",
    ],
    effort: "One short check, plus any fixes",
    definitionOfDone:
      "An owner has completed the mobile contact journey and assigned fixes.",
    verification:
      "Repeat the check after changes; do not send test inquiries without permission.",
    goalFit: ["more_clients", "better_conversion"],
    requiresCapacity: false,
    trigger: {
      type: "question_below",
      questionIds: ["presence-2", "presence-3"],
      threshold: 100,
    },
  }),
  action({
    id: "public-presence-plan",
    domain: "presence",
    title: "Decide what public presence your practice needs",
    summary:
      "A website is one route. Start with how the right people currently find and contact you.",
    steps: [
      "List your main referral and discovery routes.",
      "Identify any difficulty finding reliable service and contact information.",
      "Choose the smallest useful public information improvement.",
    ],
    effort: "One planning session",
    definitionOfDone:
      "You have chosen a public-information next step, or documented why no change is currently needed.",
    verification:
      "Check whether intended clients can find accurate information through your chosen route.",
    goalFit: ["more_clients", "better_conversion", "sustainable_practice"],
    requiresCapacity: false,
    trigger: { type: "no_website" },
  }),
  action({
    id: "intake-owner",
    domain: "intake",
    title: "Give every inquiry an owner and a backup",
    summary: "Make responsibility explicit before adding more demand.",
    steps: [
      "Choose the person responsible for each inquiry channel.",
      "Agree who covers absences.",
      "Keep one visible queue of inquiries needing a next step.",
    ],
    effort: "One short team or solo planning session",
    definitionOfDone:
      "Each active channel has a named owner, a backup and a shared queue.",
    verification:
      "Review a recent period for inquiries without an owner or next step.",
    goalFit: ["more_clients", "better_conversion", "less_admin"],
    requiresCapacity: false,
    trigger: {
      type: "question_below",
      questionIds: ["intake-1", "intake-3"],
      threshold: 100,
    },
  }),
  action({
    id: "response-expectation",
    domain: "intake",
    title: "Set and measure a useful response expectation",
    summary:
      "Measure substantive help separately from automatic acknowledgments.",
    steps: [
      "Agree an appropriate expectation by channel and urgency.",
      "Record inquiry time and first useful response.",
      "Review unanswered inquiries and exceptions.",
    ],
    effort: "A setup session, then a short recurring review",
    definitionOfDone:
      "The expectation, owner and timestamp definitions are written down.",
    verification:
      "Compare response-time distributions and unanswered counts for the same channels and period.",
    goalFit: ["more_clients", "better_conversion"],
    requiresCapacity: false,
    trigger: {
      type: "question_below",
      questionIds: ["intake-2", "intake-4"],
      threshold: 100,
    },
  }),
  action({
    id: "service-plan",
    domain: "service",
    title: "Give clients a clear plan and update rhythm",
    summary: "Reduce uncertainty about what happens next.",
    steps: [
      "Describe the main stages and what the client needs to do.",
      "Agree useful update points.",
      "Check that the explanation makes sense to the client.",
    ],
    effort: "One template session and a first use",
    definitionOfDone: "A reusable plan and update approach are in use.",
    verification:
      "Review a small set of appropriate engagements for promised updates and repeated questions.",
    goalFit: ["better_conversion", "less_admin", "sustainable_practice"],
    requiresCapacity: false,
    trigger: {
      type: "question_below",
      questionIds: ["service-1", "service-2"],
      threshold: 100,
    },
  }),
  action({
    id: "client-handoffs",
    domain: "service",
    title: "Make information requests and closing handovers repeatable",
    summary: "Use clear checklists to reduce avoidable chasing.",
    steps: [
      "List the information required at each stage.",
      "Choose a suitable secure collection route.",
      "Create a closing handover with completion and next-step checks.",
    ],
    effort: "One focused workflow session",
    definitionOfDone:
      "The collection checklist and closing handover have accountable owners.",
    verification:
      "Check whether repeat requests and missing closing steps decrease.",
    goalFit: ["less_admin", "sustainable_practice"],
    requiresCapacity: false,
    trigger: {
      type: "question_below",
      questionIds: ["service-3", "service-4"],
      threshold: 70,
    },
  }),
  action({
    id: "fee-expectations",
    domain: "cash",
    title: "Explain fees and payment timing before surprises arise",
    summary:
      "Use the fee approach appropriate to your services and professional requirements.",
    steps: [
      "Describe scope, assumptions and reasons costs could change.",
      "Explain when payment is due and the available choices.",
      "Check the client's understanding.",
    ],
    effort: "One explanation and template review",
    definitionOfDone:
      "The fee and payment explanation is clear and consistently used.",
    verification:
      "Review common fee questions and unexpected-bill concerns; no client details are needed here.",
    goalFit: ["collect_cash", "better_conversion"],
    requiresCapacity: false,
    trigger: {
      type: "question_below",
      questionIds: ["cash-1", "cash-2"],
      threshold: 100,
    },
  }),
  action({
    id: "cash-review",
    domain: "cash",
    title: "Create a regular invoicing and receivables review",
    summary:
      "Give delayed bills and overdue balances an owner and an appropriate next step.",
    steps: [
      "Confirm the invoicing schedule.",
      "Review an aggregate aging report.",
      "Assign the next step for exceptions and disputes.",
    ],
    effort: "One setup session and a recurring short review",
    definitionOfDone:
      "Invoicing and aging reviews have owners, a cadence and recorded next steps.",
    verification:
      "Track billing delays and aging using consistent definitions and a comparable period.",
    goalFit: ["collect_cash", "less_admin"],
    requiresCapacity: false,
    trigger: {
      type: "question_below",
      questionIds: ["cash-3", "cash-4"],
      threshold: 100,
    },
  }),
  action({
    id: "reduce-admin",
    domain: "operations",
    title: "Remove one recurring source of unwanted administration",
    summary: "Choose a repeated burden that prevents useful work.",
    steps: [
      "Observe where the same work or information is repeated.",
      "Choose one small process change.",
      "Measure effort and errors before and after.",
    ],
    effort: "One observation period and a small improvement",
    definitionOfDone:
      "One change is in use, with a named way to assess its benefit.",
    verification:
      "Compare unwanted work and rework; necessary administration is not a failure.",
    goalFit: ["less_admin", "sustainable_practice"],
    requiresCapacity: false,
    trigger: {
      type: "question_below",
      questionIds: ["operations-2", "operations-3"],
      threshold: 100,
    },
  }),
  action({
    id: "shared-definitions",
    domain: "operations",
    title: "Use shared records and definitions for business decisions",
    summary:
      "A simple reliable record is more useful than a complicated inconsistent dashboard.",
    steps: [
      "Define inquiry, suitable inquiry, consultation, client and payment.",
      "Choose one shared record.",
      "Reconcile stage and financial exceptions at review time.",
    ],
    effort: "One definition session and a recurring review",
    definitionOfDone:
      "Stage definitions and review ownership are recorded and used.",
    verification:
      "Check a limited aggregate period for inconsistent counts and unresolved exceptions.",
    goalFit: ["collect_cash", "better_conversion", "less_admin"],
    requiresCapacity: false,
    trigger: {
      type: "question_below",
      questionIds: ["operations-1", "operations-4"],
      threshold: 100,
    },
  }),
  action({
    id: "planned-cover",
    domain: "independence",
    title: "Make planned time off workable",
    summary: "Match coverage and client expectations to the practice you want.",
    steps: [
      "Identify work that needs coverage during leave.",
      "Agree suitable help and an urgent-contact route.",
      "Communicate availability expectations.",
    ],
    effort: "A coverage planning session",
    definitionOfDone:
      "A practical coverage arrangement and availability message are documented.",
    verification:
      "After using the arrangement, review interruptions and unmet needs.",
    goalFit: ["sustainable_practice", "less_admin"],
    requiresCapacity: false,
    trigger: {
      type: "question_below",
      questionIds: ["independence-1", "independence-2"],
      threshold: 100,
    },
  }),
  action({
    id: "owner-priorities",
    domain: "independence",
    title: "Align the next improvement with your own goals",
    summary:
      "More staff, tools or clients are not automatically the right outcome.",
    steps: [
      "Choose the outcome that matters most now.",
      "Select one improvement that supports it.",
      "Review progress and access to essential business accounts.",
    ],
    effort: "One short planning session",
    definitionOfDone:
      "A chosen goal, next action and review point are written down.",
    verification:
      "Check progress against your chosen outcome and confirm essential account ownership.",
    goalFit: ["sustainable_practice", "less_admin", "collect_cash"],
    requiresCapacity: false,
    trigger: {
      type: "question_below",
      questionIds: ["independence-3", "independence-4"],
      threshold: 100,
    },
  }),
  action({
    id: "capacity-first",
    domain: "operations",
    title: "Resolve the capacity constraint before seeking more work",
    summary:
      "Your reported spare capacity is zero or below. Focus on fit, workload and the work you want to keep.",
    steps: [
      "Identify the work creating the constraint.",
      "Review appropriate delegation, scope and acceptance choices.",
      "Reassess capacity after the change.",
    ],
    effort: "One workload review",
    definitionOfDone:
      "You have chosen a realistic capacity or acceptance change.",
    verification:
      "Review workload and service commitments before increasing demand.",
    goalFit: ["more_clients", "less_admin", "sustainable_practice"],
    requiresCapacity: false,
    trigger: { type: "capacity_full" },
  }),
  ...(["deadline", "mfa", "ai_review", "client_funds"] as const).map(
    (id): ActionTemplate => {
      const details = {
        deadline: [
          "Review deadline capture and backup arrangements",
          "Confirm how deadlines are recorded, checked and covered.",
          "An appropriate owner has reviewed the deadline process and follow-up needs.",
        ],
        mfa: [
          "Review protection for important accounts",
          "Check whether suitable multifactor authentication and recovery are in place.",
          "High-risk account protection and recovery arrangements have been reviewed.",
        ],
        ai_review: [
          "Confirm qualified review of AI legal output",
          "Check the review process before relying on AI-generated legal work.",
          "The practice has a clear qualified-review process appropriate to its AI use.",
        ],
        client_funds: [
          "Review applicable client-funds reconciliation",
          "Use appropriate qualified help to confirm the applicable process and any discrepancies.",
          "The applicable reconciliation process and follow-up owner have been confirmed.",
        ],
      }[id];
      return {
        id: `control-${id}`,
        domain: id === "client_funds" ? "cash" : "operations",
        title: details[0],
        summary: details[1],
        steps: [
          "Confirm applicability and the actual working arrangement.",
          "Review concerns with an appropriately qualified person.",
          "Record the next step and review date without uploading sensitive records.",
        ],
        effort: "Depends on the control and any remediation",
        definitionOfDone: details[2],
        verification:
          "Keep suitable evidence within your firm's own systems; this preview does not certify compliance.",
        goalFit: [],
        requiresCapacity: false,
        trigger: { type: "control", controlId: id },
      };
    },
  ),
];

export const DEFAULT_RELEASE: ReleaseSnapshot = {
  id: "preview-r1",
  label: "Preview rubric · version 1",
  status: "approved",
  provisional: true,
  rubricNote:
    "Provisional product rubric, not a validated industry benchmark. Responses are owner-reported; no website scan or independent verification is performed.",
  minCoverage: 0.8,
  domains: DOMAIN_DEFINITIONS,
  questions: QUESTIONS,
  actions: ACTION_TEMPLATES,
};
