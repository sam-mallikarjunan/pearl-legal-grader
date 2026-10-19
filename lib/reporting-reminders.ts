export const REPORTING_REMINDER_VERSION = "outcome-reporting-reminders-v1";
export const REPORTING_REMINDER_CONSENT =
  "Email me up to two reporting reminders for each future month I register: one after the month closes and another at least seven days later if I have not reported it. Timing can vary with capacity and delivery. This is separate from other reminders, marketing and the Practice Foundations series. Do not include my results, scores or answers in email. I can stop these reminders at any time without affecting my grade or account.";
export const REPORTING_REMINDER_LIMITS = {
  day: 20,
  month: 100,
  batch: 10,
  attempts: 4,
  perPlan: 2,
  sampleDay: 1,
  sampleMonth: 3,
} as const;
export interface ReportingReminderPreference {
  id: string | null;
  granted: boolean;
  revision: number;
  version: typeof REPORTING_REMINDER_VERSION;
  generation: number;
  updatedAt: string | null;
}
export interface ReportingReminderState {
  available: boolean;
  paused: boolean;
  preference: ReportingReminderPreference;
  messages: Array<{
    id: string;
    kind: "closed" | "follow_up" | "sample";
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderReportingReminder(input: {
  kind: "closed" | "follow_up" | "sample";
  from: string;
  recipient: string;
  appUrl: string;
  unsubscribeUrl: string;
  outboxId: string;
  businessName: string;
  postalAddress: string;
  startDate?: string;
  endDate?: string;
}) {
  const sample = input.kind === "sample";
  const subject = sample
    ? "Sample: your Pearl reporting reminder"
    : "Your Pearl reporting month is ready to record";
  const heading = sample
    ? "This is your requested sample reminder"
    : input.kind === "follow_up"
      ? "A gentle follow-up on your planned month"
      : "Your planned month has closed";
  const period =
    !sample && input.startDate && input.endDate
      ? `The reporting period ${input.startDate} to ${input.endDate} is closed. `
      : "";
  const body = sample
    ? "You explicitly requested this sample to see how outcome-reporting reminders look. It is not a notification that a reporting month is due, and it does not change any plan or reporting date."
    : `${period}A month you registered is ready for your private business-period update. Record what you know and leave unknown measures blank. If the month is already reported or you withdraw its plan, future reminders for that plan stop.`;
  const link = `${input.appUrl}/account#business-outcomes`;
  const footer = `You enabled outcome-reporting reminders. This message does not enroll you in marketing or another email series. Stop only these reminders: ${input.unsubscribeUrl}`;
  const text = `PEARL · OUTCOME REPORTING${sample ? " · SAMPLE" : ""}\n\n${heading}\n\n${body}\n\nOpen your private account: ${link}\n\nKeep client names and matter details out of the reporting form. Your issued grade is unchanged.\n\n${footer}\n\n${input.businessName}\n${input.postalAddress}`;
  const html = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#f5f7f6;color:#172d2a;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:32px 24px;background:#fff;font-size:16px;line-height:1.6"><p>PEARL · OUTCOME REPORTING${sample ? " · SAMPLE" : ""}</p><h1>${escape(heading)}</h1><p>${escape(body)}</p><p><a href="${escape(link)}" style="display:inline-block;padding:14px 22px;background:#164d40;color:#fff;text-decoration:none;border-radius:6px">Open your private account</a></p><p>Keep client names and matter details out of the reporting form. Your issued grade is unchanged.</p><p style="font-size:13px">You enabled outcome-reporting reminders. This does not enroll you in marketing or another series. <a href="${escape(input.unsubscribeUrl)}">Stop only outcome-reporting reminders</a>.</p><p style="font-size:13px">${escape(input.businessName)}<br>${escape(input.postalAddress).replace(/\n/g, "<br>")}</p></div></body></html>`;
  return {
    from: input.from,
    to: [input.recipient],
    subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tags: [{ name: "pearl_grader_reporting", value: input.outboxId }],
  };
}
