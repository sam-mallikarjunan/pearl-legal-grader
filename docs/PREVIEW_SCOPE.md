# Hybrid preview scope

## Experience promise

**Build a practice that works for you.** Identify friction around legal work, understand what the available evidence shows, and choose a useful next improvement.

This version combines a browser-local operating assessment with an optional live scan of a public website. Source implementation and local verification do not by themselves establish hosted availability or successful deployed integration. Deployment claims require separate end-to-end evidence.

## Entry and assessment

- Primary action: **Start my assessment**.
- First field: **What's your practice's website?**
- Equal alternative: **I don't have a website yet**.
- The configured live scanner starts at the public homepage while the questionnaire continues. Users can finish the assessment even when the scan is blocked or incomplete.
- A deployment without scan configuration explicitly explains that website checks are unavailable. It does not show an invented analyzing animation or findings.
- **Explore a fictional example** remains a separate route; its URL is never scanned.

Context covers the owner's goal, practice area, jurisdiction, stage, fee model and capacity. It selects relevant questions and recommendations; it does not earn points. Questions ask about a current process. Answer labels distinguish an absent process, an informal practice, a consistent process, a reviewed process, unknown and not applicable.

Unknown answers, omitted answers and failed measurements do not establish a gap. Not applicable is an explicit owner assertion or a defined context rule. No-site and contingency routes exclude inapplicable questions without a penalty. Guest questionnaire progress and answers remain device-local. Account uploads are explicit and selective.

## Public website scan

The first release inspects the homepage and at most four same-origin contact, services, about/team and fees/FAQ pages. It collects bounded static HTML signals and a separate mobile Lighthouse laboratory audit. It does not follow the whole site, log in, submit forms, call the practice, complete bookings or bypass challenges.

Observable checks cover:

- Validated HTTPS on the scanned homepage.
- Contact routes and an explicit consultation/enquiry invitation.
- Availability of service, people and location information in inspected pages.
- Titles, descriptions, main headings, indexing directives and viewport declarations.
- Limited static image alternative-text and form-label signals.
- Mobile laboratory performance and automated accessibility findings when available.
- Recognizable analytics, advertising, chat, booking and website-platform markers as context only.

These are presence and laboratory checks. They do not prove that forms, calendars or analytics work; that copy persuades; that every accessibility barrier is found; or that a lawyer is licensed, competent or compliant. English-language wording checks can miss other wording or languages. Suggested firm names, practice areas and locations require owner confirmation and never silently replace questionnaire answers.

The static scanner does not execute scripts. JavaScript shells and blocked pages remain identifiable evidence gaps. A disposable Vercel Sandbox browser executes the page for Lighthouse when Google PageSpeed is not configured. Its identity is shown accurately; a self-run Lighthouse result is not described as a Google-hosted audit. Laboratory measurements vary and do not establish real-user Core Web Vitals. No CrUX field-data collection is implemented.

Each scan records its page scope, timestamps, scanner/rubric versions, sources, measured values and limitations. It retains selected structured observations rather than raw HTML, cookies, form contents, screenshots or complete traces. Technology detection carries no scoring bonus.

## Reports and evidence language

Display owner-reported maturity and observed website checks separately. A site scan must not answer operating questions about response speed, client conversion, billing discipline or whether a review process exists.

Reports show:

1. Assessment and scan dates, scope and evidence types.
2. An owner-goal takeaway supported by the answers.
3. Up to three prioritized operating actions and a separate list of website fixes.
4. Applicable category scores with evidence coverage and remaining uncertainty.
5. Sources, limitations, detected tools and owner-confirmable context suggestions.
6. Controls to reassess, save a new dated website snapshot, export or clear device data.

Use **Based on your answers — not independently verified** for owner maturity. Use **Observed on [page], [date]** for scan evidence. Use **Fictional example** for sample content. Do not attach fictional findings to a real submitted URL.

Unknown, unavailable, blocked and inapplicable checks do not receive failing points. The provisional website score normalizes over measured checks only, and evidence coverage is shown separately. If too little is measured, no website score is issued. A partial scan can appear stronger than a complete one, so scores with different coverage are not direct progress comparisons. A failed scan must never appear as a zero-quality practice.

Avoid “Your firm is compliant,” “Best lawyer,” “AI verified,” invented savings and unsupported peer comparisons. Neither a partial operating assessment nor a website score is a whole-practice certification.

## Actions, history and shared scoring controls

Actions explain the finding, why it matters, what to do and effort. Operating action completion reads **Completed by you**, not **Verified improvement**. Empty history invites a baseline rather than fabricating a chart. Reassessment preserves original rubric versions and distinguishes newly supplied evidence from business improvement.

Saved questionnaire history and report copies stay in this browser. Users can save another dated website snapshot; earlier reports are not rewritten. Server records and local copies have separate retention behavior.

The protected administration page edits shared questionnaire wording, weights and supported applicability rules. Every publication has a reason, immutable release and audit record. Administrators preview six fictional contexts and can roll back through an atomic active-release pointer. Earlier assessments keep their original version. Local draft changes cannot become canonical account grades.

Optional accounts use emailed one-time codes and server-managed private sessions. Only a selected report is uploaded; importing a report on another device is explicit. Private saved assessments are immutable; action status, target date and self-reported outcomes are separate. Revision checks detect concurrent edits. Cloud exports and individual report/account deletion are supported. Account deletion requires a recent sign-in and explicit confirmation.

Requested report emails contain a scoped summary and a private workspace link. Provider acceptance is distinct from confirmed delivery. No marketing is sent. Requested Pearl contact requires a separate explicit choice and can be withdrawn; no automatic CRM writing or outbound contact occurs.

Research consent, recognition interest and marketing preference are independent and default off. Eligible research requires current consent, one recent sufficiently complete report per workspace and a matching approved release. Raw answers, contact information, location and website URLs are excluded from research rows. Aggregate statistics are suppressed below 30 qualifying unverified workspaces, and public peer rankings remain unavailable. We do not infer representative benchmarks or verified firms from workspace counts.

Optional AI explanations require configuration and an explicit owner request. Only bounded public website excerpts are submitted; explanations must cite matching evidence and do not change scores. Unknown, unsupported and refused analysis remains unavailable. Live provider operation requires a separate successful provider test.

## Access, limits and retention

The scan backend uses Supabase and durable Vercel jobs. It accepts public standard-port HTTP/HTTPS URLs, rejects credentials/query parameters/private or reserved addresses and sensitive account/payment paths, pins DNS during native fetches, revalidates every redirect and respects robots policies. Public page failures stay unmeasured.

An initiating device receives a random private capability token. Server polling requires it in an authorization header; only token hashes are stored on the server. Tokens live separately from reports and never appear in normal or recovery exports. There is no public result directory. Saving public evidence to a private account requires possession of its original private access grant; the grant is not retained in exports.

The pilot limits submissions to **3 per rolling hour and 10 per rolling 24 hours per hashed client identifier**, including cache hits. New jobs are capped at **30 per UTC day and 300 per UTC calendar month**. Active origin jobs are shared, usable results can be cached for 24 hours under matching versions, and explicit fresh rescans have a 15-minute origin cooldown. Failed jobs count toward the new-job allowance. Atomic reservations enforce these limits under concurrency.

Public website evidence, job records, access grants and hashed request-limit records expire after **30 days**. The daily cleanup removes expired records; expired results cannot be retrieved while awaiting cleanup. Aggregate usage counters retain no URL, scan ID or client hash. Raw IP addresses are not stored in the scan database.

Clear removes browser-local answers, progress, reports, rules and scan tokens. It does not immediately delete server evidence or cancel an existing background job. Explain server expiry separately rather than implying a local clear is an immediate remote erasure request.

No credentials, client identities, privileged matter details, payment information or individual compensation belong in this preview. Questionnaire answers are not sent to the scanner or AI provider. Selected reports may be saved privately with explicit user action. Requested email contains a summary rather than private answers. CRM synchronization is not implemented.

## Fictional example

**Juniper Family Law** is an invented established solo practice in Portland, Oregon with part-time administrative support, mixed hourly/scoped-flat fees, a goal of collecting cash more predictably and capacity for roughly two additional suitable matters next month. Its reserved website is `https://juniper-family.example`.

Every example selection is fictional. It is not an industry benchmark, a verified practice outcome or a live scan. Its example never writes an actual `.example` scan job.

## Deferred capabilities

Public profiles and named rankings, ML-adjusted production grades, continuous monitoring, uploads, teammate invitations, automated marketing and CRM synchronization remain deferred. Preferences alone never send a message, create a CRM record or publish a profile. AI stays off until a key is securely configured and the provider is tested.

## Review checklist

- Questionnaire works when scanning is disabled, blocked, partial or temporarily unavailable.
- Real website observations and fictional examples cannot be confused.
- No-site, prelaunch, contingency, unknown and not-applicable routes remain useful.
- Missing evidence is never silently zero; scores remain finite and coverage stays visible.
- Detected context requires confirmation; no operating maturity answer is inferred from a website.
- Pages, evidence timestamps, providers and provisional rule versions are inspectable.
- Safe URL, DNS, redirect, robots, body, runtime and network controls are exercised.
- No form submission, authenticated crawling or challenge bypass is introduced.
- Anonymous database access fails; valid capabilities work; invalid/expired capabilities fail.
- Concurrent quota reservations cannot exceed caps; stale/failed workflows recover without claiming completion.
- Local clear and export exclude tokens and accurately describe remote retention.
- Saved results survive reload and retain original rules after shared publication, rollback or new scans.
- Mobile and keyboard users can reach questions, reports, actions and data controls.
- Hosted functionality is claimed only after browser → API → job → database → report verification.

- Account and admin routes enforce identity, owner scope and same-origin mutation checks.
- Canonical cloud reports are recomputed from approved rules and reject forged scores or unproved website evidence.
- Consent choices remain separate; current withdrawal affects research eligibility.
- Outbox retries are idempotent, webhook signatures are checked and accepted email is not mislabeled as delivered.
- Hosted email and cross-device account claims require actual provider and fresh-browser verification.
