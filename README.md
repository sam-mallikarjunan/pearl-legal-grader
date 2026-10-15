# Independent Law Practice Grader

A Next.js and React assessment with browser-local practice history and an optional live website scanning backend. Owner-reported practice maturity and observed website checks have separate scores, evidence and histories.

The live-scan implementation is in this repository. Availability on a particular deployment depends on its database, worker and environment configuration; this document does not assert that hosted end-to-end verification has been completed.

## Run locally

Use Node.js 24 and the pnpm version pinned in `package.json`:

```sh
pnpm install
pnpm dev
```

`pnpm build` creates a production build; `pnpm start` serves it. Run `pnpm typecheck` and `pnpm test` for the automated checks. Without scan configuration, the questionnaire, local reports, fictional example and local scoring editor remain available; no live scan is invented.

## Experience

1. Enter a public practice website or choose the no-website route.
2. When scanning is configured, a bounded website check runs while the owner answers practice questions. The questionnaire remains usable if a scan is blocked or unavailable.
3. Confirm practice context, goals and capacity, then answer questions about concrete operating practices.
4. View a scoped owner-reported assessment, separate website findings, evidence coverage and prioritized actions.
5. Save dated reports, mark actions completed or deferred, and reassess later. A completion checkbox does not establish a business improvement.
6. Explore local scoring controls to change question wording and weights and publish a new browser-local rubric version without rewriting earlier reports.

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
- Scan access uses a random 256-bit capability token stored separately on the initiating device. Only its hash is stored on the server. Polling requires that token in an authorization header; there is no public scan directory or user-account system.
- Supabase tables and RPCs are unavailable to anonymous/authenticated client roles; the application uses server-only service access.
- Per client request identifier: **3 submissions per rolling hour and 10 per rolling 24 hours**, including cache hits. The identifier is an HMAC of the proxy-provided client IP, not a raw IP stored in the database.
- Across the pilot: **30 new jobs per UTC day and 300 per UTC calendar month**. Failed or unavailable new jobs still consume that allowance. Database reservations serialize quota checks to prevent concurrent overspend.
- Existing active jobs are shared for the same origin. Usable results may be reused for 24 hours under the same scanner/rubric versions. An explicit fresh rescan has a 15-minute origin cooldown. Request limits are enforced even when a cached result is available.

## Data and privacy

Questionnaire answers, owner context, action progress, assessment history, local scoring rules and saved report copies remain in this browser's local storage. They have no account backup or cross-device synchronization. Another person using the same browser profile can access them.

Starting a live check sends the public website URL to the scan backend. Public website evidence, scan status, hashed access grants and hashed request-limit identifiers have a **30-day server retention window**. Results become inaccessible at expiry; the daily cleanup removes expired records. Aggregate day/month counters retain no website URL, scan ID or client identifier. Saving or clearing a local report does not change the server retention window.

Private scan access tokens are stored separately from report data and are excluded from normal and recovery exports. Clearing this device's data removes local answers, reports, rules and tokens. It does not immediately erase server scan records or stop an already queued scan. Server expiry and cleanup handle those records separately.

Do not enter credentials, client identities, matter narratives, privileged information, payment details or individual employee compensation. Inspect report exports before sharing them. The local scoring editor is a demonstration without authenticated administration or protection against deliberate local changes.

## Deferred features

Email delivery, magic-link/login accounts, cross-device questionnaire storage, protected shared administration, AI-generated copy review, ML or peer-derived scoring, public leaderboards/profiles, CRM/HubSpot sync, teammate invitations, uploads, custom domains and continuous monitoring remain outside this release. A leaderboard preference does not publish anything.

See [Preview scope](docs/PREVIEW_SCOPE.md) for the evidence language and review checklist.
