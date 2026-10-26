# Personal Remote Engineering Job Hunter

A small TypeScript CLI that collects public job-board APIs, filters for a Nigeria-based backend/product engineer, ranks with explicit evidence, and prepares a daily email. It never submits applications. There is no dashboard or AI dependency.

**Deployment status:** implementation and local tests are available; hosted Supabase, live provider access, scheduled execution, and email delivery require the configuration and verification below. See [validation evidence](docs/VALIDATION.md). The current live-data check produced a 10-role preview from 1,009 normalized jobs; salary and source-coverage limits are recorded in the validation report. A fixture preview is synthetic and is not a list of real vacancies.

## Run a preview

Node.js 22.21+ (22 LTS recommended), npm, and HTTPS access are required. No database or email credentials are needed for previews.

```sh
npm ci
npm run check
npm run fixtures       # synthetic fixtures: no external APIs, persistence, or sending
npm run dry-run        # configured live APIs; never sends or writes to Supabase
```

Open `artifacts/digest.html` as a local file, or read `artifacts/digest.txt` and `artifacts/report.json`. The report includes source health, rejected-job reasons, salary evidence, and selected matches. Real previews use a provider response cache and include only observed source data. `npm run sources:check` returns nonzero for failed sources or invalid payload rows; intentional page-budget caps are reported as degraded coverage so you can verify coverage before deployment.

Dry-runs use the exact collectors, normalization, deduplication, ranking, and renderer used in production. They intentionally do **not** write to your database or contact Resend, and do not subtract previous notifications. The test suite separately exercises the actual SQL migration in PostgreSQL through PGlite and the HTTP persistence/delivery contracts. That is not proof of hosted integration or inbox delivery.

## What it looks for

The profile in `src/ranking.ts` targets backend, full-stack, Node.js, TypeScript, product, and suitable platform/software engineering roles with TypeScript/Node/PostgreSQL/React/API/auth/payment overlap. Baseline experience is 4 years; roles asking more than 6 years are excluded, and 5–6 years are a stretch. Irrelevant, junior, internship, staff/principal/management, expired, future-dated and >45-day-old dated postings are excluded.

Eligibility needs explicit Nigeria, Africa, EMEA, worldwide, or an explicit hiring statement plus confirmed remote work. “Remote” alone does not qualify. Country lists and restrictive prose take precedence; unrecognized restrictions require review. EMEA includes Nigeria geographically; neither that nor a “Worldwide” label guarantees an employer can contract/pay someone in Nigeria. Unknown eligibility is kept in the report, excluded from the email. Business-hour overlap alone is not treated as a residence requirement.

Pay sections are separate:

- **Verified minimum:** explicit USD annual/monthly base pay with a floor of at least $2,000/month. $2,500+ earns more points; $4,000+ is prioritized.
- **Undisclosed:** no compensation disclosure was found. The minimum is unverified.
- **Needs confirmation:** missing currency/period, non-USD, hourly/weekly pay, overlapping minimum, upper-bound-only, or location-specific bands. No FX, paid-week, or working-hour assumptions.

Scores combine explicit role/stack overlap, eligibility evidence, seniority/experience, compensation, and publication recency. Reasons label posting evidence, inference, and unknowns. Collection time, Himalayas' `pubDate` update time, and Greenhouse's update time are never substituted for publication time. See [architecture and limits](docs/ARCHITECTURE.md) for exact scoring and limitations.

## Configure source coverage

Edit `config/sources.json`. Himalayas and Remotive provide feeds. **Greenhouse, Ashby, and Lever do not offer a global job search:** they require an employer board token. Add companies you actually want to follow. The initial Canonical, PostHog, Supabase, and Palantir boards were exercised against real API data during setup; that does not mean all their roles accept Nigerians. Replace/add employers to suit your interests.

Collectors use only documented public read APIs, never application submission endpoints, browsers or scraping. Employer application URLs and source attributions are preserved. Remotive listings always link back to Remotive and identify the source. Review [provider API references, terms and verification status](docs/PROVIDERS.md) before live deployment. API contracts, company board tokens and provider terms can change.

Requests are sequential and paginated within explicit budgets. Himalayas searches `engineer` and `developer` with the Nigeria country filter, up to 10 pages per query by default; capped coverage is reported as degraded rather than complete. Increase the page budget if needed. API responses are cached locally: 24h for feeds and 6h for employer boards. Remotive uses one category request, not one per search title. GitHub Actions retains the public-response cache between runs. HTTP 429 `Retry-After` and transient error backoff are respected; permanent authorization errors do not loop.

## Deploy with a dedicated Supabase project

1. Create a **new Supabase project used only by this job hunter**. Do not reuse any marketplace or other application project. No project was automatically created by this repository.
2. Run [001_job_hunter.sql](supabase/migrations/001_job_hunter.sql) in that project's SQL editor. It refuses an existing application schema, creates only `jh_*` objects, enables RLS, and limits RPC/table access to `service_role`. The migration can be reapplied. Do not remove the isolation guard to force it into another database.
3. Copy `.env.example` to `.env` locally and fill in `SUPABASE_URL`, the **same project's** 20-character `SUPABASE_PROJECT_REF`, and its service-role key. The client rejects mismatched URLs/project refs and checks a database app identity before writes. Never use a service-role key in a frontend.
4. Create a Resend API key with permission to send emails. Verify a sending domain with Resend, then configure `DIGEST_FROM` on that domain and your `DIGEST_TO` address. Production delivery needs an authorized sending domain; the Resend test domain restricts recipients.
5. Store secrets in `.env` locally and in **GitHub repository Actions secrets** for deployment. Do not put them in JSON source config, workflow files, commits, issues, or chat. Each environment has its own configuration; Codex environment settings do not automatically create GitHub secrets.
6. Allow the provider API domains and **your exact** `<project-ref>.supabase.co` hostname in a restricted cloud environment. The GitHub-hosted runner normally has Internet access. See [operations](docs/OPERATIONS.md).

```sh
npm run build
npm start -- doctor            # verifies dedicated DB identity; reports presence only for secrets
npm run sources:check          # real API checks, with per-source health
npm run dry-run                # inspect the real shortlist before authorizing delivery
npm start -- run --send         # explicit send; persists jobs/health first
```

A successful send result means **accepted by Resend**, not delivered to your inbox. Check the provider email event and your inbox before declaring delivery verified. No test email is sent implicitly by `doctor`, tests, CI or previews.

## Schedule and daily operation

[discover.yml](.github/workflows/discover.yml) is configured for `15 7 * * *` UTC: approximately **8:15 AM Africa/Lagos** every day. GitHub can delay scheduled jobs; the workflow must exist on the default branch and the repository must allow Actions. Inactive public repositories may have schedules disabled by GitHub.

Add these six GitHub Actions secrets:

```text
SUPABASE_URL
SUPABASE_PROJECT_REF
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
DIGEST_FROM
DIGEST_TO
```

First run the workflow manually in `sources-check`, then `dry-run` mode. Inspect its downloadable artifacts. After a successful manual `send` and inbox verification, set repository Actions variable **`JOB_HUNTER_ENABLED=true`** to activate scheduled sends. Manual execution defaults to preview; the scheduled workflow is gated off until enabled. The next actual scheduled run still needs to be observed to verify scheduling.

The digest sends up to 10 strongest new matches (configurable 5–15). It may contain fewer than 5 when there are insufficient qualifying jobs; it never fabricates or pads results. If there are no new matches, it sends nothing. An all-source outage fails without sending; partial outages are shown in source health. Unsuitable/unknown eligibility does not get upgraded to make the list longer.

Jobs, source health, manual application statuses and notification history are persisted. Database reservations and Resend's 24h idempotency window protect repeat sends, including a crash after acceptance but before saving the receipt. The app uses a safer 23h cutoff and refuses to guess about older unresolved sends. See the [recovery procedure](docs/OPERATIONS.md#recovering-an-uncertain-email).

## Track applications

```sh
npm start -- list
npm start -- list Interested
npm start -- track FULL_JOB_ID Interested "Review company and salary"
npm start -- track FULL_JOB_ID Applied "Applied manually on company site"
npm start -- track FULL_JOB_ID Interviewing "Technical interview booked"
```

Statuses: `New`, `Interested`, `Applied`, `Interviewing`, `Rejected`, `Offer`. Full IDs are in the email/report/list output. Updating a status never submits an application. Non-`New` jobs are suppressed from future digests. Setting `New` does not erase notification history or force a repeat email.

## Repository structure

```text
src/collectors/     one validated public-API adapter per provider
src/eligibility.ts conservative Nigeria eligibility evidence
src/salary.ts      explicit compensation normalization
src/ranking.ts     deterministic fit scoring
src/dedup.ts       canonical application URL identity
src/persistence.ts Supabase RPC adapter
src/notifications.ts / email.ts   delivery and rendering
src/pipeline.ts / cli.ts         orchestration and commands
supabase/migrations/             dedicated-project migration
config/sources.json              employer boards and request budgets
tests/                           unit, contract, PostgreSQL and end-to-end fixture tests
```

No AI enrichment, analytics, third-party job reposting, automated applications, scraping framework or background web server is included.
