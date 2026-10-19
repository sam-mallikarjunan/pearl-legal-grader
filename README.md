# Independent Law Practice Grader

A Next.js and React assessment with browser-local history, optional private accounts, and a bounded live website scanner. Owner-reported practice maturity and observed website checks have separate scores, evidence and histories.

The live-scan implementation is in this repository. Availability on a particular deployment depends on its database, worker and environment configuration; this document does not assert that hosted end-to-end verification has been completed.

## Run locally

Use Node.js 24 and the pnpm version pinned in `package.json`:

```sh
pnpm install
pnpm dev
```

`pnpm build` creates a production build; `pnpm start` serves it. Run `pnpm typecheck` and `pnpm test` for the automated checks. Without backend configuration, the questionnaire, local reports and fictional example remain available. Unavailable scans, account services and AI reviews are identified explicitly.

## Experience

1. Enter a public practice website or choose the no-website route.
2. When scanning is configured, a bounded website check runs while the owner answers practice questions. The questionnaire remains usable if a scan is blocked or unavailable.
3. Confirm practice context, goals and capacity, then answer questions about concrete operating practices.
4. View a scoped owner-reported assessment, separate website findings, evidence coverage and prioritized actions.
5. Track actions, target dates and owner-reported outcomes. Reassess to create a new dated snapshot; a completion checkbox does not establish a business improvement.
6. Optionally sign in with an emailed one-time code, explicitly save a selected report, import it on another device, or request its summary by email. Guest history is never uploaded automatically.
7. Administrators can preview, publish and roll back shared questionnaire versions. Issued reports retain their original rules. Separate research, recognition, marketing and requested-help choices default to off.

**Juniper Family Law** is an explicitly fictional solo-practice example. Its reserved `.example` URL is never scanned, and its answers are not attached to a user's real website.

## Live website checks

The scanner starts at the public homepage and follows up to four relevant same-origin contact, services, about/team and fees/FAQ links. It does not perform a whole-site crawl. Checks include contact and consultation elements, service/people/location wording, page metadata, indexing directives, main headings, viewport declarations, limited image/form-label signals and detectable technology markers.

Static HTML is parsed without executing website scripts. A separate mobile Lighthouse laboratory audit runs through Google PageSpeed Insights when a server-side key is configured; otherwise it uses an isolated, disposable Vercel Sandbox worker. The sandbox worker executes the public page's scripts in a fresh browser without application credentials. Laboratory scores differ from real-user field data and can vary between runs. This version does not collect CrUX field data.

Each result records page URLs, timestamps, scanner and rubric versions, bounded evidence, source/provider information, measurements, limitations and action suggestions. Raw HTML, cookies, form submissions, screenshots and full browser traces are not retained. Technology detection indicates a marker's presence, not a working integration, and earns no scoring bonus.

Unknown, blocked, unavailable and inapplicable evidence does not become zero. A partial scan can have a higher score than a more complete scan, so the report displays weighted evidence coverage separately. The website score is a provisional assessment of observed checks; it does not measure legal skill, licensing, compliance or overall firm quality.

## Backend setup

The backend uses Vercel Workflow for scan execution and Supabase for jobs, access grants, caching and usage counters. Apply the SQL migration in `supabase/migrations/` to a dedicated project. Keep service credentials server-side; never commit them or expose them through `NEXT_PUBLIC_` variables.

Copy `.env.example` to an ignored `.env.local` for local configuration. Configure the corresponding server environment on Vercel:

| Variable                         | Purpose                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                   | Dedicated project's HTTPS endpoint                                                            |
| `SUPABASE_SECRET_KEY`            | Server secret key; the service-role key is also supported through `SUPABASE_SERVICE_ROLE_KEY` |
| `SCAN_HASH_SECRET`               | Random secret of at least 32 characters for HMAC request-limit identifiers                    |
| `SCAN_OPERATOR_SECRET`           | Random secret of at least 32 characters for internal maintenance endpoints                    |
| `CRON_SECRET`                    | Set to the same value as `SCAN_OPERATOR_SECRET` so Vercel's cleanup cron can authenticate     |
| `SCANS_ENABLED`                  | Explicitly set `true` after database and worker setup                                         |
| `PAGESPEED_API_KEY`              | Optional server-side Google PageSpeed key                                                     |
| `LIGHTHOUSE_SANDBOX_SNAPSHOT_ID` | Optional prepared browser-worker snapshot for faster isolated audits                          |

On Vercel, the sandbox SDK uses the deployment's scoped OIDC authorization. Local sandbox execution requires supported Vercel sandbox authentication. The application does not pass its database, operator or provider credentials into the audit VM. Native firewall rules deny private and reserved IPv4 destinations. IPv6 is disabled through privileged operating-system settings and both settings are verified before every audit, including when restoring a snapshot; failure leaves the audit unmeasured.

The operator-only `POST /api/internal/scans/warm` endpoint prepares a browser-worker snapshot. It creates billable infrastructure and returns a snapshot ID for server configuration. Prepared snapshots expire after 30 days and must be renewed. A failed audit produces an unmeasured result rather than a fabricated score. The scheduled cleanup endpoint removes expired records and marks stale jobs unavailable.

The scan API fails closed when required configuration is missing. Email, accounts or an OpenAI key are not prerequisites for this feature.

## Safety, access and usage limits

- Only public HTTP/HTTPS websites on their standard ports are accepted. Credentials, query parameters, private/local/reserved addresses and sign-in/account/payment paths are rejected. The audit starts at the homepage.
- Native HTML requests pin validated DNS results into the actual connection. Every redirect is revalidated; follow-up pages stay on the final homepage's origin. HTTPS-to-HTTP downgrades are rejected.
- The scanner respects `robots.txt`, uses bounded requests, body sizes and time windows, and stops when a robots policy cannot safely be established. It does not bypass access challenges or submit forms.
- The browser audit runs inside a temporary VM with private/special network ranges denied, bounded runtime and request controls. It is not a vulnerability scanner.
- Scan access uses a random 256-bit capability token stored separately on the initiating device. Only its hash is stored on the server. Polling requires that token in an authorization header; there is no public scan directory. Attaching website evidence to an account requires the original private scan capability, which is verified and never included in an account export.
- Supabase tables and RPCs are unavailable to anonymous/authenticated client roles; the application uses server-only service access.
- Per client request identifier: **3 submissions per rolling hour and 10 per rolling 24 hours**, including cache hits. The identifier is an HMAC of the proxy-provided client IP, not a raw IP stored in the database.
- Across the pilot: **30 new jobs per UTC day and 300 per UTC calendar month**. Failed or unavailable new jobs still consume that allowance. Database reservations serialize quota checks to prevent concurrent overspend.
- Existing active jobs are shared for the same origin. Usable results may be reused for 24 hours under the same scanner/rubric versions. An explicit fresh rescan has a 15-minute origin cooldown. Request limits are enforced even when a cached result is available.

## Data and privacy

Guest questionnaire answers, owner context, action progress and report copies remain in browser local storage. Another person using the same browser profile can access them. An account backs up only explicitly selected reports. Reports are immutable and recomputed against a known server-approved release; action progress and separately versioned preferences can be updated. Local changes to a rubric cannot become canonical cloud grades. There is no automatic merge or upload of device history.

Starting a live check sends the public website URL to the scan backend. Public website evidence, scan status, hashed access grants and hashed request-limit identifiers have a **30-day server retention window**. Results become inaccessible at expiry; the daily cleanup removes expired records. Aggregate day/month counters retain no website URL, scan ID or client identifier. Saving or clearing a local report does not change the server retention window.

Private scan access tokens are stored separately from report data and are excluded from normal and recovery exports. Clearing this device's data removes local answers, reports, rules and tokens. It does not immediately erase server scan records or stop an already queued scan. Server expiry and cleanup handle those records separately.

Do not enter credentials, client identities, matter narratives, privileged information, payment details or individual employee compensation. Inspect report exports before sharing them. Protected administration requires a verified sign-in and a server-side email allowlist. Browser-local state remains editable by its owner and is not independently verified.

## Private accounts, administration and email

Apply every committed migration in order to the dedicated Supabase project. Server-only account settings are `SUPABASE_PUBLISHABLE_KEY` (Auth API identifier), `ACCOUNTS_ENABLED=true`, and `GRADER_ADMIN_EMAILS` (exact verified addresses permitted to administer). Use the same existing server secret for database RPCs and the Auth admin API. Closed RLS and restricted RPC grants prevent direct anonymous or authenticated database access; owner authorization happens on the server. Sessions use HttpOnly, Secure production cookies and same-site mutation checks. Do not expose a service credential in browser code.

Enable `AUTH_EMAIL_ENABLED` and `REPORT_EMAIL_ENABLED` only after configuring `RESEND_API_KEY`, `GRADER_EMAIL_FROM` and the trusted HTTPS `GRADER_APP_URL`. The sending key should be restricted to the verified sender domain. Supabase generates a one-time code; the server delivers it through Resend. No SMTP password is required. Requested reports use an idempotent durable outbox and authenticated delivery-status webhook (`RESEND_WEBHOOK_SECRET`). Provider acceptance and confirmed delivery are distinct states. Email contains a scoped summary and a private workspace link, not the full private operating answers. The optional educational series has its own enrollment and controls described below.

Sign-in request limits are 3 per email per rolling hour, 10 per client identifier per hour, and 50/day plus 500/month across the preview. Verification attempts are separately limited. Report email limits are 3/account/hour, 10/account/day, and 100/day plus 1,000/month globally. HMAC-only request identifiers expire after 48 hours; aggregate usage counters cannot be reset by deleting a report. Operator health shows aggregate consumption, not a provider billing statement.

Account export, individual report deletion and recent-sign-in-protected account deletion are available. Deleting an account removes its Auth identity and cascades its private workspace data. Device copies, shared public website scans, provider delivery records and backups have separate retention. Daily cleanup handles expiring scanner, authentication, email and AI allowance records. AI request allowances retain owner identifiers for 48 hours; cached explanations are attached to private saved reports and cascade on report or account deletion. A clear-device action is not an account deletion.

Protected scoring administration validates drafts, compares six fictional contexts, requires a reason, atomically publishes an immutable release and supports audited rollback. New assessments use the active release; earlier reports are not rewritten. Minimum coverage and context applicability are validated. Shared website-scanner rules are not editable through this questionnaire editor.

## Research and requested help

Benchmark research uses only current, separate opt-in consent, the latest eligible report per workspace, an approved active release, sufficient coverage and recent original assessment dates. Research rows exclude contact details, URLs, location and raw answers. A per-workspace pseudonym supports withdrawal and prevents counting repeat reports as additional workspaces. Counts describe unverified workspaces, not verified independent firms. Public descriptive medians require at least 30 qualifying known scores per metric and are rounded; counts are banded. These are whole-cohort participant descriptions, not matched peer percentiles. The separate anonymous leaderboard has its own explicit publication permission and eligibility rules. No ML adjustment automatically changes production grading.

A separate requested-help form records the user's topic and explicit contact request. Protected administrators can review its status and export a minimal handoff. Withdrawal is supported. A help request does not create marketing consent, contact anyone automatically, or create a HubSpot contact or deal.

## Optional AI explanations

`AI_REVIEW_ENABLED=true` and a server-only `OPENAI_API_KEY` are both required. Without them, AI stays unavailable; there is no substitute account, provider or invented review. An authenticated owner must explicitly request a review of a saved website report and agree to sending its bounded public-page excerpts. Private operating answers, raw HTML, capabilities and contact details are excluded. Reviews provide at most three source-grounded explanations; returned quotations and source IDs must match supplied evidence. Unsupported or invalid responses abstain. AI does not change grades or claim legal quality or compliance.

The configured model, prompt/schema versions and evidence hash are recorded. Calls have a 25-second timeout, no provider retries, a 1,200-token output cap, caching and atomic quotas of 3/account/day, 100/day and 500/month. Provider `store` and SDK telemetry are disabled. These invocation limits bound volume, not the full provider bill. Live provider verification is required before describing AI as operational.

## Benchmarks, anonymous recognition and educational nurturing

`/benchmarks` separates source-backed industry observations from technical guidance and community readiness scores. Each reference states its source, period, cohort, denominator and limitation. Funnel and cash calculators keep inputs in page memory. Published cohort descriptors are fixed and unsliced; unknown scores, small groups, mixed releases and incomplete data never become invented statistics or grading weights.

`/leaderboard` uses generated aliases and one explicitly selected canonical report per workspace. Publication requires a separate consent action, current rubric, at least 80% coverage, all applicable modules scored and a report within 90 days. Stage/fee cohorts stay hidden below ten eligible participants. Withdrawal is immediate; deleting the selected report removes the entry. No law firm identity, license verification, legal-quality certification or peer percentile is implied.

`/learn` provides the complete four-part Practice Foundations course without enrollment. Optional email delivery requires its own versioned consent, `NURTURE_EMAIL_ENABLED=true`, valid `GRADER_BUSINESS_NAME` and `GRADER_POSTAL_ADDRESS`, and existing verified Resend configuration. Preview deployments never send. Existing marketing or recognition choices do not start a course. Course-only consent is excluded from the general marketing export. Stop/unsubscribe withdraws all grader marketing permission; requested sign-in and report email remain separate.

The daily `/api/cron/nurture` scheduler uses `CRON_SECRET`, reserves at most 20 due lessons per batch, 50 new messages per UTC day and 500 per UTC month. Lessons are spaced about weekly and capacity can delay sending. Durable steps pass only outbox IDs, recheck current recipient/permission/pause/suppression, freeze payloads, retry at most four times within a one-hour provider window, and preserve the same idempotency key. Signed webhooks distinguish accepted and delivered states. One-click unsubscribe follows RFC8058; GET does not change permission. Protected `/admin/insights` exposes operational counts and audited pause/resume. Recipient suppression survives account deletion as a purpose-bound digest. Account exports include enrollment and consent records; account deletion cascades course and leaderboard data.

## Still outside this preview

Named public profiles, ML-derived production scoring, general marketing campaigns, CRM synchronization, teammate invitations, document uploads, custom domains and continuous monitoring remain outside this release. A recognition-interest preference alone publishes nothing.

See [Preview scope](docs/PREVIEW_SCOPE.md) for evidence language and review boundaries. Deployment and test receipts are maintained separately from this public repository.
