# Architecture and boundaries

The CLI runs collectors → validation/normalization → canonical URL deduplication → hard filters → scoring → selection → persistence/reservation → email. A dry-run stops at an HTML/text/JSON artifact and never connects to Supabase or Resend.

## Data and evidence

`Job` retains source ID, original/application URLs, all duplicate source attributions, company/title/description, disclosed pay units, normalized monthly USD, remote/location/country evidence, employment type, publication/expiry dates and collection timestamp. Source containers and each row are runtime validated with Zod. Invalid rows are counted and discarded, not silently coerced; an entirely invalid payload fails the source. Pagination caps and partial schema failures make source health degraded.

Only currently collected jobs enter selection. Old database rows are retained for history/tracking; they are not recycled into a digest when a source disappears. Missing jobs are not globally marked expired on a partial/failed collection. Explicit expirations and old known publication dates are filtered. Undated roles are allowed with no freshness points and a visible unknown-publication warning. Up to 24h of response caching means feed removal can take up to that interval to be observed. Shortlisted Himalayas jobs are rechecked through its documented open-job endpoint (up to a 5min local / 10min provider cache); failed/closed checks are excluded. Other APIs expose currently published jobs. There is no claim that application pages were scraped or employers independently verified.

Salary disclosure extraction is conservative. Structured amounts still need explicit currency and pay period. USD annual base pay is divided by 12; monthly USD is retained directly. Nothing assumes currency from `$`, period from provider conventions, working hours, paid weeks, or exchange rates. Multiple amounts, total compensation, stock, OTE, regional bands, and phrases such as "up to" stay review items. Regional salary ceilings cannot establish a Nigeria pay floor. Prose heuristics can miss disclosures; the source link remains the authority.

## Scoring v1

Hard filters run first: confirmed remote; explicit geographic eligibility; relevant role/seniority and at least one relevant stack signal; no explicit expiry; known age <=45 days; no publication date >1 day in the future; no stated experience >6 years; no title targeting an unsupported primary backend language without a Node.js/TypeScript/JavaScript title signal. Requirement extraction is conservative and does not assert that every mention is a mandatory minimum.

| Component | Points |
|---|---:|
| Qualifying role | 10 |
| Explicit Nigeria location / other explicit eligible region | 18 / 15 |
| TypeScript | 9 |
| Node.js | 9 |
| PostgreSQL/Supabase | 6 |
| React/Next.js | 4 |
| REST/auth/payment/marketplace | 5 |
| JavaScript | 3 |
| Stated experience <=4 years / 5–6 years | +7 / −8 |
| Senior title | −3 |
| Mixed title stack outside profile (e.g. Node.js + PHP) | −8 |
| Lead/founding title | −5 |
| Verified USD pay floor >=$2k / >=$2.5k / >=$4k monthly | +10 / +15 / +20 |
| Publication <=3 / <=7 / <=14 days | +8 / +5 / +2 |

Scores are clamped to 0–100; minimum 45. No pay/freshness points are awarded for missing evidence. Verified-minimum salary matches are selected first, then undisclosed, then salary-review, with score and stable ID breaking ties. Within the configured limit (5–15, default 10), fewer matches is acceptable. No AI invents missing facts.

## Duplicate and lifecycle semantics

A SHA-256 of a canonical HTTPS application URL identifies a job. Known tracking parameters, Lever `/apply`, and Ashby `/application` suffixes are normalized; meaningful requisition query parameters are retained. For exact matches across providers, employer ATS data takes precedence over aggregators and all attributions survive. Similar titles with different application links remain distinct: aggressive fuzzy merging could hide a different role or jurisdiction. Two aggregator listings with no shared application URL may therefore survive as possible duplicates; this is a known conservative limit.

Supabase jobs upsert payload/last-seen only, preserving first-seen, application status and notes. Already-notified jobs are excluded per recipient. Any non-`New` status is also suppressed. No job application calls are present.

## Transactional notification protocol

1. Save jobs and health; query notified/tracked IDs and render the candidate digest.
2. `jh_prepare_digest` takes an advisory transaction lock per recipient. It resumes any unresolved pending digest first, or reserves one daily payload if its job IDs remain unnotified/New. A same-day sent/abandoned record cannot produce a second digest.
3. The database stores HTML, plaintext, subject, sender, recipient, job IDs and a content hash before any send. A 5min lease prevents simultaneous workers. Replaying the prepare RPC with the same lease token is idempotent if its response was lost.
4. Resend receives the same persisted payload and key `job-hunter/<digest UUID>` on every retry. A provider error or ambiguous network outcome retains the pending snapshot; the lease is released when possible.
5. Once Resend returns an email ID, one transaction marks the digest sent and writes notification history. A later retry after a lost database receipt resumes the original payload/key, rather than constructing a different email.
6. Pending digests older than 23h block automatic sending; there is no exactly-once claim beyond Resend's retention. Operators must reconcile using the provider dashboard. "Sent" in the database means API acceptance, not inbox delivery.

All tables have RLS enabled with no anon/authenticated policies. RPC EXECUTE is explicitly revoked from those roles and PUBLIC. Only `service_role` gets access. The migration refuses an existing public application schema, the URL must match the configured dedicated project ref, and the app checks a DB identity. These safeguards reduce accidental project crossover; an operator still must actually create and use a separate project.

## Operations kept outside the app

GitHub Actions starts the CLI daily, supports manual previews/sends, persists the public response cache, serializes workflows and retries a failed send run after six minutes. Application logs omit keys/provider bodies. CI uses synthetic data only. No live process, dashboard, crawler daemon, browser, or external scheduler server is required.
