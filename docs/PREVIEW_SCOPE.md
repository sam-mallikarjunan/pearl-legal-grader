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

Requested report emails contain a scoped summary and a private workspace link. Provider acceptance is distinct from confirmed delivery. Educational marketing is sent only after separate four-part course enrollment; no existing account is enrolled automatically. Requested Pearl contact requires a separate explicit choice and can be withdrawn; no automatic CRM writing or outbound contact occurs.

The private business-outcome tracker records closed, non-overlapping aggregate periods, explicit source/currency and matched-cohort definitions. Unknown measures stay blank. Owners can correct, delete and export periods. A separately selected baseline must have been assessed and saved before the period began; outcome entry does not change the issued assessment. Research use requires separate outcome permission plus current assessment-benchmarking permission. It never follows from saving an account, requesting contact or joining a leaderboard.

Quick reporting starts with inquiries, accepted engagements and the owner's administrative hours. Optional detail expands the funnel and same-invoice-cohort cash measures. Date presets and reuse of reporting setup do not carry forward business numbers. A strict one-row aggregate CSV template is parsed and previewed in browser memory before an explicit save; the CSV itself is never uploaded. Unsupported columns, individual client rows and unknown values cannot silently become submitted measures. Source labels remain owner-reported even when totals were copied from an export.

The separate multi-period import wizard supports local CSV/TSV and pasted aggregate sheets, limited to 128 KiB and 24 rows. Owners review mappings, date format, money units and currency, then every normalized period before saving. Identifying or narrative source columns are rejected generically; no raw file, custom heading or unselected cell reaches the server. Only canonical reviewed totals are submitted. Imports are add-only and atomic: a conflict in any row saves none of the rows. An exact retry returns the existing receipt and preserves later edits or deletions. The current 24-period limit remains; receipt history has a separate 100-import preview allowance. Opening a local aggregate file is not permission to upload client records or enable a third-party integration.

The separate **automation totals connection** accepts direct authenticated server-to-server JSON deliveries into a private review inbox. It does not upload a file or automatically import outcomes. A recently signed-in owner explicitly creates a narrowly scoped one-time key; the server derives ownership from the verified connection, not a caller-supplied owner field. The key permits aggregate delivery only, with no account reads, score changes, consent writes or overwrite access. The displayed key stays masked and in page memory, has deliberate copy/forget controls, and never enters an example URL, snippet, browser storage or account export. Copying uses the user's clipboard. Revocation stops new deliveries immediately.

Only canonical aggregate fields, a stable request UUID and up to 24 closed non-overlapping periods are accepted, within 64,000 request bytes. Source is export-informed owner reporting and baseline is null. Unknown stays null, money stays integer minor units, and currency/cohort rules remain unchanged. Unknown fields, client/matter rows, credentials and browser-origin requests are refused without echoing their contents. An accepted receipt means **received for review**, not imported or independently verified. Exact retries are neutral; changing an existing request's payload conflicts. Expired or revoked keys cannot replay deliveries.

Owners separately open each pending delivery, review every normalized period and unknown, and explicitly confirm atomic add-only import. A conflict in any row imports none; revisions prevent stale review. A processed delivery never recreates subsequently deleted outcomes. Discard clears pending totals without importing. Limits are 3 active keys, 24 retained key records, 5 pending deliveries, 10 new deliveries per rolling 24 hours and 100 retained delivery receipts per account, alongside existing outcome/import allowances. Keys are valid for 30 days. Pending payloads expire after 7 days and are cleared on expiry, import or discard; reads and scheduled cleanup enforce expiry. Minimal receipt/history metadata remains until account deletion and retained allowances do not silently reset. Owner exports include normalized still-pending totals and safe history, never secrets, digests or raw HTTP bodies.

Advanced recipes explain dedicated credential storage in Make HTTP v4, n8n Bearer Auth and API by Zapier Static Headers, with official links and placeholders. A recipe is not an installed provider workflow; external plans or source permissions may be required. This is a generic automation connection. Native Clio and Google OAuth are not connected, and no external account or provider permission is created by choosing a recipe. Connection setup, receipt and import never grant research, leaderboard, marketing, reporting-email or requested-contact permission. HubSpot remains deferred.

Private progress insights expose the dates, counts, denominators, window lengths, gaps, source and currency behind a comparison. Incompatible windows, mixed currencies/sources, unresolved practice scope and unknown or zero denominators withhold change calculations. Percentage-point differences are not relative percentage growth. Same-inquiry-cohort acquisition measures and same-invoice-cohort collection measures are never stitched together. Readiness-score differences require the same canonical saved practice, context, rubric, applicability and answered evidence. More complete evidence alone is not business improvement.

Personalized next actions reorder the explicitly selected report's issued templates using reported control gaps, goal, capacity, existing commitments, target dates and compatible observations. Explanations name their source and suggest a measurement; they do not claim causation or promised savings. At most three next steps appear. Completed, deferred or irrelevant actions remain set aside until the owner reopens them. Using unlinked outcome periods for the selected practice requires a separate unchecked, in-memory scope confirmation; it changes no baseline link or research permission. Action updates retain existing ownership and revision guards. No new AI/provider request or automatic score change is introduced.

Optional future monthly plans register the baseline, reporting dates, source and currency before the period starts. Those fields stay locked; later numeric corrections do not permit changing the original comparison. Deleting the baseline invalidates that plan's evidence. A withdrawn plan or a deleted linked period never restarts automatically. Registration and reminders grant no research permission.

Private action observations can prospectively register an action actually issued in the selected plan's owned canonical assessment, a known closed baseline period and one fixed measure. The plan must cover a future full calendar month; registration precedes the change date, which is no later than the month begins. Source and currency must match, with a known numerator and positive denominator. Unlinked baseline scope needs a separate default-off declaration and is never written back as a period link. The action, measure, selected baseline observation/revision, context and future window are fixed. Up to 72 retained observations per account and 3 registrations per plan are allowed, without registering the same action twice in a plan.

The sole possible follow-up is the outcome reported against that exact plan. The result remains waiting until the future period genuinely closes and suitable figures exist. Missing, revised or deleted baselines, withdrawn plans and unknown/incompatible follow-ups withhold comparison; frozen historical values are labeled rather than silently compared against revised data. Follow-up corrections retain visible revision/date context. Enum-only implementation and other-change check-ins are owner claims, use revision checks and never mark the source action complete or alter a grade. Withdrawal is explicit and terminal; concurrent registrations are disclosed conservatively.

These owner-only before/after descriptions show dates, numerators, denominators and percentage-point or normalized-time changes. They do not establish an untreated comparison, significance, independently verified implementation, guaranteed savings or a causal effect. Exports include private registration/check-in history; account deletion cascades it. Existing research preferences do not authorize pooling these private action observations across firms.

Reporting reminders have a separate, specific opt-in with two messages at most per registered period: one after closing and a follow-up seven days later if unreported. Existing reminder, marketing or course preferences do not enroll anyone. Current permission, verified recipient, plan state, suppression and operator pause are rechecked before dispatch. A labeled owner-requested sample uses the same delivery pipeline and its own small quota. Reminder mail contains no reported business totals, scores or offers. Its signed unsubscribe stops only reporting reminders; GET requests never change a choice. Acceptance is distinct from provider-confirmed delivery.

Protected score-validation diagnostics compare independent baseline/outcome pairs within compatible monthly windows, rubric, stage, fee model, currency and source. Genuine prospective registrations and retrospective links stay separately labeled and are never pooled. Small groups, unknown measures and truncated extracts do not produce statistics. A newly registered period must actually finish before it can supply prospective evidence. Exploratory candidate-weight comparisons require a separate workspace holdout and remain unpublished; the existing scoring publication flow governs any production change. These observations do not establish causality, legal quality or a validated prediction model.

New opted-in contact requests enter Pearl's private follow-up queue. An operator must explicitly open contact details; the service rechecks permission and verified identity and audits that access. The user can choose to share a limited report summary. Detailed answers, website observations and outcome records are excluded. Older consent is never upgraded into new sharing permission. HubSpot integration remains deferred.

Research consent, recognition interest and marketing preference are independent and default off. Eligible research requires current consent, one recent sufficiently complete report per workspace and a matching approved release. Raw answers, contact information, location and website URLs are excluded from research rows. General readiness aggregate medians require 30 qualifying known scores per metric and use rounded values with banded counts. Anonymous leaderboard publication requires a separate explicit choice and ten eligible participants in the same broad stage/fee/rubric cohort. We do not infer representative benchmarks or verified firms from workspace counts.

Practice-specific participant comparisons additionally require both current assessment-benchmarking and outcome-research permissions. One earliest eligible calendar-month baseline/outcome pair per workspace in the last 366 days is selected, with genuine prospective registrations taking priority; unknown outcomes never justify substituting a later favorable period. The canonical baseline predates the month, is no more than 90 days old and has at least 80% coverage. Exact supported main-practice labels map into nine fixed groups; free-text, Other and blank labels are excluded. The analysis mapping is versioned, currently supports `preview-r1` only and requires review for future rubrics. It does not claim a historically recorded capture-form edition.

The practice catalogue separates exact group, calendar month, prospective/retrospective track, stage, fee model, currency, reporting source, rubric and mapping. It exposes no arbitrary public filtering. Every published metric needs at least 30 known distinct workspaces; incomplete data or unsupported mappings withhold all statistics. Participant counts are bands of ten, rate medians round to five percentage points, readiness medians to five points and owner hours/day to half an hour. Readiness-band breakdowns require all three cells to contain at least five known values, otherwise the entire breakdown is withheld. Each workspace has equal weight. Inquiry conversion, issued-invoice collection and owner administration hours/day retain their distinct cohorts, cutoffs and denominators.

Small practice cohorts honestly show **forming**; no invented seed participants or medians fill the gap. These self-selected owner-reported descriptions are not representative market estimates, verified legal specialties, personal percentiles or legal-quality rankings. Jurisdiction and firm size are not matched and currency does not establish location. Permissions, corrections, deletions and newly eligible registrations can change membership; this is not a fixed longitudinal cohort. No production grading weights, automatic ML model, causal conclusion or new research permission follows from publication.

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

Named public profiles and legal-quality rankings, ML-adjusted production grades, continuous monitoring, document uploads, native Clio/Google OAuth connections, teammate invitations, general marketing campaigns and CRM synchronization remain deferred. The direct automation totals interface is separate from named-provider connectivity; a documented recipe is not a proven third-party setup. The anonymous opt-in leaderboard and separately enrolled four-part educational series are implemented with the disclosed limits. Preferences alone never send a message, create a CRM record or publish a profile. AI stays off until a key is securely configured and the provider is tested.

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
- Automation keys are one-time, owner-derived and write-only; missing/revoked/expired keys, browser origins, unknown fields, oversized payloads and changed-request replays fail safely.
- Delivery receipt, explicit review and atomic import are distinct; payload expiry/discard, safe pending-data export and no-overwrite/retry semantics remain observable without exposing keys or raw requests.
- Practice comparisons withhold small, incompatible, incomplete or unmapped cohorts; prospective private action observations never invent elapsed follow-ups or causal effects.
