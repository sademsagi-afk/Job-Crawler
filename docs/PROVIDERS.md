# Providers and API use

Documentation and live API checks performed on **2026-10-26**. Documentation retrieval, payload validation, application availability and employer legitimacy are distinct checks.

| Provider | Official reference reviewed | Read endpoint used | Live test |
|---|---|---|---|
| Himalayas | https://himalayas.app/api and https://himalayas.app/terms#api; https://himalayas.app/docs/openapi.json | `/jobs/api/search?q={engineer,developer}&country=Nigeria&sort=recent&page=N`; `/jobs/api/companies/{company}/jobs/{slug}` | Real search payloads and selected-role open checks validated; bounded search coverage |
| Remotive | https://github.com/remotive-com/remote-jobs-api | `GET https://remotive.com/api/remote-jobs?category=software-dev` | Real feed payload validated |
| Greenhouse | https://github.com/grnhse/greenhouse-api-docs/tree/master/source/includes/job-board (official documentation source; direct docs host inaccessible) | `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | Canonical board validated |
| Ashby | https://developers.ashbyhq.com/docs/public-job-posting-api | `GET https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true` | PostHog and Supabase boards validated |
| Lever | https://github.com/lever/postings-api | `GET https://api.lever.co/v0/postings/{site}?mode=json&skip=N&limit=100` (or EU host) | Palantir board validated, including live `onsite` enum variant |

Official documentation source HEADs observed: Remotive `191c5048b38c480c1e0a0843d70e7fc720199cb2`, Lever `f61aac5831a193bc66e1183c3ad102739dfd9f56`, Greenhouse `271cd888061d3428575eba2f626fe3e1996485c3`. Provider contracts and terms can change; review the links periodically. Read-only public APIs require no employer credentials. Greenhouse/Ashby docs describe integrations for employer boards, not an unrestricted global search or a commercial redistribution license. This app uses configured public boards for the owner's personal job discovery and retains original links/credits.

## Rules implemented

- **Himalayas:** retain the supplied `applicationLink` unchanged for Apply actions, show a visible Himalayas job/source link, cache data, honor rate limits and exclude expired jobs. Terms §113 permit personal/commercial API integrations under these conditions and prohibit redistribution to third-party aggregators/search engines. This app does not redistribute feeds. Search results use pages until empty (not `totalCount` or a short page); a budget cap is explicit partial coverage. Browse `offset` is deprecated and is not used. Empty `locationRestrictions` explicitly means worldwide, but allowed numeric standard UTC offsets must also include Nigeria's +1. A no-timezone-restriction job enumerates all offsets. `pubDate` is documented as **last updated**, so publication is unknown. Shortlisted jobs are refreshed with the documented one-job endpoint, where 410 means closed. The provider may cache that answer for 10min; local cache is 5min.
- **Remotive:** normally one category request/day, backed by a 24h cache and >=31s retry spacing; never a query per keyword. Its guidance recommends max four requests/day. Retain listing URLs, name Remotive visibly and acknowledge its 24h feed delay. Never post the data to other job boards, build a signup gate, or monetize this personal listing. The README says salaries are "usually" yearly/USD; neither is silently assumed for a particular job.
- **Ashby:** omit `isListed=false` jobs. Its docs state `isRemote=true` also includes hybrid work; require `workplaceType=Remote` or a separately explicit remote location/statement when the type is unavailable. Hybrid/OnSite are excluded. Salary components use explicit currency, interval and values, excluding bonus/equity. A named or ambiguous compensation tier is not assumed to apply to Nigeria. Publication is the posting's last-published date as documented.
- **Greenhouse:** public GET endpoints do not need authentication; only application submission needs a key. Use `content=true`, preserve absolute posting links, retain `updated_at` separately and leave publication unknown. Salary disclosure can be extracted conservatively from description text; the app does not invent a period for `pay_input_ranges` or make per-job compensation-detail calls without need.
- **Lever:** HTTPS JSON mode, documented pagination, original hosted/apply links. No POST application endpoint is called. The application-POST rate limit is not mistaken for a published GET quota. The docs name `on-site`, while live data also uses `onsite`; both are validated and excluded. Its documented response has no publication date, so freshness is unknown.
- **All:** sequential requests with >=1.1s host pacing, bounded retries/page budgets and source attribution. HTTP 429 `Retry-After` up to 60s is honored; longer instructions defer the source rather than retry early. Do not assume public API access grants permission to scrape websites, republish commercially or bypass controls. No HTML website scraping/browser automation is used; any future scraper needs its own terms/robots review.

Application URLs are validated as credential-free HTTPS, not fetched or submitted. An open/public posting is not independent verification of an employer or offer. Review the employer's own site before sharing sensitive information or applying. Source health records exactly which requests/payloads worked; a partial scan is never reported as exhaustive.

## Other integration documentation reviewed

- Supabase REST/RPC: https://supabase.com/docs/guides/api
- Resend send API: https://resend.com/docs/api-reference/emails/send-email
- Resend idempotency: https://resend.com/docs/dashboard/emails/idempotency-keys

These pages were retrieved successfully. Resend documents `Idempotency-Key` retention for 24h and returning the original response for the same request/key; the app uses persisted payloads and a safer 23h retry cutoff. Hosted Supabase access, email sending/domain verification and GitHub scheduled execution still need actual credentials/configuration and operational verification. Documentation review is not proof those integrations have run.
