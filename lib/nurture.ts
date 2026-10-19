/** Curated business education. Versions are immutable so consent and delivered copy stay attributable. */
export const NURTURE_SERIES_VERSION = "practice-foundations-v1";
export const NURTURE_CONSENT_VERSION = "practice-foundations-consent-v1";
export const NURTURE_CONSENT_TEXT =
  "Email me Pearl’s four-part Practice Foundations series: four business education emails, scheduled about a week apart. The first lesson is scheduled after enrollment; timing can vary with capacity and delivery. The series includes optional invitations to ask Pearl for help. I agree to marketing email for this series and can unsubscribe at any time. My grade and access do not depend on subscribing.";
export const NURTURE_LIMITS = {
  messages: 4,
  day: 50,
  month: 500,
  batch: 20,
  attempts: 4,
} as const;
export const NURTURE_LESSONS = [
  {
    step: 1,
    subject: "Make your next client’s first step clear",
    title: "Turn first contact into a clear next step",
    paragraphs: [
      "A small practice can make its first-contact process as deliberate as a large firm’s. Start with one visible way to get in touch, a plain-language explanation of who you help, and an honest expectation for when someone will hear back.",
      "Choose a response window your team can consistently meet. Write down who owns each new inquiry, who covers absences, and what happens when the inquiry is not a fit. A fast automatic acknowledgment helps set expectations; it does not replace a useful human response.",
    ],
    action:
      "This week: send your own practice a test inquiry without including client information. Record the route, handoff and elapsed time, then fix one confusing step.",
    measure:
      "Measure inquiry-to-first-useful-response time and the share of inquiries that receive a clear next step. Keep the same definition and time period when comparing results.",
  },
  {
    step: 2,
    subject: "Find the gaps between inquiry and client",
    title: "Build a funnel you can actually learn from",
    paragraphs: [
      "A lead count alone cannot tell you whether marketing is working. Track a single group of inquiries through qualified, consultation booked, consultation attended and engagement accepted. Keep referral sources separate when their economics or fit differ.",
      "Count the people entering each stage and the people who move forward. Write down the cohort and period before calculating a rate. A consultation that has not happened yet is not a no-show, and a signed engagement is different from cash collected.",
    ],
    action:
      "This week: choose one recent, complete cohort and record the counts at each stage. Pick the largest avoidable drop-off and one process change to try.",
    measure:
      "Compare conversion and cost per engaged client within the same cohort. Include staff time and acquisition costs when they can be estimated reliably; label estimates.",
  },
  {
    step: 3,
    subject: "Make cash collection predictable",
    title: "Connect your pricing process to cash timing",
    paragraphs: [
      "A healthy pipeline can still leave a practice short of cash. Make the payment process understandable before work starts: what the client is being charged for, when bills arrive, what payment options exist, and whom to contact with a question.",
      "Review a small sample of completed matters using the same definitions: work performed, amount billed, adjustments, amount collected and days to collection. Compare like matters and fee arrangements. Revenue, profit and cash are different measures.",
    ],
    action:
      "This week: map the steps from completed work to collected payment. Remove one delay in issuing, explaining or following up on an invoice.",
    measure:
      "Track invoice age and the share of billed amounts collected for a defined period. Ask a qualified adviser about fee, trust-account, tax or jurisdiction-specific requirements.",
  },
  {
    step: 4,
    subject: "Give your practice a repeatable operating rhythm",
    title: "Turn one useful improvement into a habit",
    paragraphs: [
      "Large firms gain capacity from repeatable systems and clear ownership. A solo practice can begin with a short weekly review: new inquiries, upcoming commitments, overdue work, cash timing and one improvement to test.",
      "Document one recurring task as a checklist, identify who checks the result, and decide what must stay under professional judgment. If you try AI or another new tool, start with public or synthetic information and verify its output before relying on it.",
    ],
    action:
      "This week: choose one action in your dashboard, assign a next step and date, and record what changed. Reassess with fresh evidence when you are ready.",
    measure:
      "Track whether the change saved time, reduced missed handoffs or improved a defined client-facing step. Completing a task is useful progress; it does not by itself prove a better outcome or raise your grade.",
  },
] as const;

export type NurtureStatus = "active" | "withdrawn" | "completed" | "suppressed";
export interface NurtureEnrollment {
  id: string;
  status: NurtureStatus;
  seriesVersion: string;
  consentVersion: string;
  enrolledAt: string;
  nextSendAt: string | null;
  messagesAccepted: number;
  messagesDelivered: number;
  generation: number;
}
export interface NurtureAccountState {
  available: boolean;
  paused: boolean;
  enrollment: NurtureEnrollment | null;
}
export interface NurtureMessage {
  from: string;
  to: [string];
  subject: string;
  html: string;
  text: string;
  headers: {
    "List-Unsubscribe": string;
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click";
  };
  tags: [{ name: "pearl_grader_nurture"; value: string }];
}
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** Content is curated and uniform: no report answers, client details, score, tracking pixel or inferred personalization. */
export function renderNurtureEmail(input: {
  step: number;
  recipient: string;
  outboxId: string;
  unsubscribeUrl: string;
  from: string;
  appUrl: string;
  businessName: string;
  postalAddress: string;
}): NurtureMessage {
  const lesson = NURTURE_LESSONS.find((item) => item.step === input.step);
  if (!lesson) throw new Error("Unknown practice foundations lesson.");
  const dashboard = `${input.appUrl}/account`;
  const footer = `${input.businessName}\n${input.postalAddress}\nYou requested this four-part educational marketing series from Pearl. One email each week; no additional series enrollment. Unsubscribe from grader marketing: ${input.unsubscribeUrl}\nBusiness education, not legal advice or a certification of professional ability.`;
  const text = `PEARL · PRACTICE FOUNDATIONS\nPart ${lesson.step} of 4\n\n${lesson.title}\n\n${lesson.paragraphs.join("\n\n")}\n\n${lesson.action}\n\n${lesson.measure}\n\nOpen your private dashboard: ${dashboard}\nWant help applying this? Sign in and use “Ask Pearl for help”: ${dashboard}#request-help . Asking is optional; no sales contact is requested by reading this email.\n\n${footer}`;
  const html = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(lesson.subject)}</title></head><body style="margin:0;background:#f5f7f6;color:#172d2a;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:32px 24px;background:#fff;font-size:16px;line-height:1.6"><p style="color:#42645b;font-size:14px">PEARL · PRACTICE FOUNDATIONS · ${lesson.step}/4</p><h1 style="font-size:28px;line-height:1.2">${escapeHtml(lesson.title)}</h1>${lesson.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}<h2 style="font-size:21px">Try one useful change</h2><p>${escapeHtml(lesson.action)}</p><p>${escapeHtml(lesson.measure)}</p><p><a href="${escapeHtml(dashboard)}" style="display:inline-block;padding:14px 22px;background:#164d40;color:#fff;text-decoration:none;border-radius:6px">Open your private dashboard</a></p><p>Want help applying this? <a href="${escapeHtml(dashboard)}#request-help">Ask Pearl for help</a> in your signed-in dashboard. Asking is optional; reading this email does not request sales contact.</p><hr style="border:0;border-top:1px solid #d9e3df"><p style="font-size:13px">${escapeHtml(input.businessName)}<br>${escapeHtml(input.postalAddress).replace(/\n/g, "<br>")}</p><p style="font-size:13px">You requested this four-part educational marketing series from Pearl. One email each week. <a href="${escapeHtml(input.unsubscribeUrl)}">Unsubscribe from grader marketing</a>.</p><p style="font-size:13px">Business education, not legal advice or a certification of professional ability.</p></div></body></html>`;
  return {
    from: input.from,
    to: [input.recipient.toLowerCase()],
    subject: lesson.subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tags: [{ name: "pearl_grader_nurture", value: input.outboxId }],
  };
}
