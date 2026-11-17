export const CALLBACK_WINDOWS = {
  "30": "30 covered minutes",
  "60": "1 covered hour",
  "120": "2 covered hours",
  "240": "4 covered hours",
} as const;

export type CallbackSetup = {
  coverage: "solo" | "team";
  target: keyof typeof CALLBACK_WINDOWS;
  retry: boolean;
};

export const DEFAULT_CALLBACK_SETUP: CallbackSetup = {
  coverage: "solo",
  target: "60",
  retry: false,
};

export const CALLBACK_ACTION_IDS = [
  "intake-owner",
  "response-expectation",
] as const;

export const CALLBACK_QUEUE_HEADINGS = [
  "Internal intake reference",
  "Received at (date time zone)",
  "Covered time starts at",
  "First callback due at",
  "Owner role",
  "First attempt at",
  "Next step or closed status",
] as const;

export const CALLBACK_SCRIPT =
  "Hello, this is [team member] returning a call to [office]. Is now a good time, and have I reached the person who called? Before we discuss anything private, I’ll explain our intake process and how to share information securely.";
export const CALLBACK_VOICEMAIL =
  "Hello, this is [team member] returning a call. If you’d still like to speak, please call [approved office number] during [covered hours]. Please don’t leave private details in a message. Thank you.";

export function callbackCoverage(mode: CallbackSetup["coverage"]) {
  return mode === "team"
    ? "The designated intake owner checks the queue. A named backup takes over during absences or if an item is at risk of missing its target."
    : "The owner checks the queue in scheduled callback blocks. During uncovered hours, the next covered block owns the queue; publish realistic office hours rather than imply continuous coverage.";
}

export function callbackStopRule(retry: boolean) {
  return retry
    ? "If the first attempt does not reach the caller, make at most one more attempt on the next covered day, and only if a return call is still appropriate and safe."
    : "If the first attempt does not reach the caller, close this follow-up unless they ask to be contacted again.";
}

const coveredClock =
  "Start the clock at receipt during covered hours, or at the next covered opening if the call came in while closed. Pause it outside covered hours.";
export const CALLBACK_CLOCK = coveredClock;

export function buildCallbackPlaybook(setup: CallbackSetup) {
  return [
    "MISSED-CALL FOLLOW-UP  |  PRACTICE GRADER",
    "",
    "SET UP ONCE",
    "Covered hours and time zone: [set in your intake system]",
    "Owner/backup and callback blocks: [set in your intake system]",
    callbackCoverage(setup.coverage),
    `Plan the first attempt within ${CALLBACK_WINDOWS[setup.target]}. ${coveredClock}`,
    "This is your practice’s chosen target, not an industry benchmark.",
    "",
    "AT EACH COVERED CHECK",
    "1. Put one genuine missed new-intake inquiry in your existing private queue. Merge duplicates; route existing clients, business callers and spam outside this workflow.",
    "2. Check safe contact, assign an owner and set the due time. If a call is at risk of going unanswered, move it to backup or the earliest covered callback block. Route any conflict, urgent or safety concern through the firm’s established procedure.",
    "3. Log the first attempt time before any later attempt. Don’t count an automated acknowledgment as a callback attempt. Use the firm’s safe channel and verify the person before discussing anything private.",
    "4. " + callbackStopRule(setup.retry),
    "Stop immediately if reached, opted out, wrong number, unsafe to contact, or the attempt limit is met. If reached, move to normal intake. Late or unanswered calls stay visible in the review.",
    "",
    "SAY THIS (ADAPT TO YOUR FIRM’S POLICY)",
    "Live callback: " + CALLBACK_SCRIPT,
    "Neutral voicemail, only if permitted and safe: " + CALLBACK_VOICEMAIL,
    "Never include matter details or make an engagement, advice or timing promise.",
    "",
    "CHECK WHAT HAPPENED",
    "For calls received in one defined window, wait until every callback deadline has passed. Count unique eligible missed new-intake calls, then count how many got a first human attempt within your target. Exclude duplicates, non-intake and calls with no safe return route; note exclusions separately. Include late and never-called eligible calls in the denominator.",
    "Compare the same definitions and coverage rule next time. A timely attempt is not a conversation, a retained client, or proof the change worked.",
    "",
    "QUEUE HEADINGS (USE YOUR OWN PRIVATE INTAKE SYSTEM)",
    CALLBACK_QUEUE_HEADINGS.join(" | "),
    "Keep all caller, contact and matter records out of the grader.",
  ].join("\n");
}

export function callbackTimeliness(eligible: string, timely: string) {
  const count = (value: string) => {
    if (!/^\d{1,7}$/.test(value)) return null;
    const n = Number(value);
    return n <= 1_000_000 ? n : null;
  };
  const total = count(eligible);
  const onTime = count(timely);
  if (total === null || onTime === null || onTime > total)
    return { status: "invalid" } as const;
  if (total === 0) return { status: "empty" } as const;
  return { status: "measured", onTime, total, ratio: onTime / total } as const;
}
