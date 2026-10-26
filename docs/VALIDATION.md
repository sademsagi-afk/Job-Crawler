# Validation evidence

Checked on **2026-10-26** in the cloud workspace. This is evidence for the current instance, not proof of a published environment snapshot or an executed GitHub schedule.

## Reproducible local checks

| Check | Result |
|---|---|
| `npm ci --no-audit --no-fund` | Passed with the committed lockfile |
| `npm run check` | Strict type check, **81 passed / 0 failed / 0 skipped** tests, and TypeScript build passed |
| `npm run fixtures` | Passed; 7 synthetic matches rendered, no database or email access |
| `npm run sources:check` | Passed against real source data; zero invalid rows after adapter corrections; bounded Himalayas coverage explicitly reported |
| `npm audit --audit-level=high` | **0 vulnerabilities** reported after dependency updates |
| Workflow YAML parse | Both `.github/workflows/*.yml` parsed successfully |

Tests cover explicit/ambiguous salary units and scope, Nigeria eligibility and restrictive prose, expiry/recency, unsupported roles/stack, deterministic ranking, canonical deduplication/attribution, external schemas/pagination, 429 retry guidance, source isolation, HTML escaping, Lagos dates, persistence failures, notification history and immutable delivery retries. The end-to-end synthetic preview exercises all five adapters and the real pipeline/renderer.

The actual migration was applied to a local PostgreSQL engine (PGlite), reapplied, and tested for: refusing an existing application database; restricted anon privileges/RLS; upsert preserving application status/notes; health persistence; leased reservations; stable resumed payloads; atomic receipt/history writes; and blocking unresolved sends older than 23h. The Supabase HTTP adapter was exercised against those actual SQL functions through a test transport. **This is not a hosted Supabase integration test.** Resend HTTP calls were simulated; no test email was sent.

## Real public-source run

The retained summary is [live-validation.json](live-validation.json). The final run generated a preview at **2026-10-26 17:40 Africa/Lagos** (16:40 UTC), using real responses fetched during this session and the configured response caches.

| Source | Valid normalized jobs | Invalid rows | Result |
|---|---:|---:|---|
| Himalayas | 303 | 0 | Search worked; 10-page/query cap reached, partial coverage |
| Remotive | 10 | 0 | Public feed worked |
| Greenhouse / Canonical | 314 | 0 | Public board worked |
| Ashby / PostHog | 11 | 0 | Public board worked |
| Ashby / Supabase | 64 | 0 | Public board worked |
| Lever / Palantir | 307 | 0 | Paginated public board worked |

**1,009 normalized jobs → 15 qualifying candidates → 10-role preview.** One selected role had a disclosed USD pay floor meeting the minimum; nine had undisclosed compensation and appear in the separate section. This is not a claim that all ten meet the compensation minimum. Nine shortlisted Himalayas jobs additionally passed its documented open-job API check; there were zero failed/closed shortlist checks. No company or offer was independently vetted.

Real-data testing found and corrected:

- Himalayas numeric UTC-offset restrictions, search pagination rules, and `pubDate` meaning update time.
- Ashby nullable legacy `isRemote`, the hybrid semantics of that boolean, and structured salary-tier scope.
- Lever's live `onsite` enum variant alongside the documented `on-site` value.
- An obsolete Mattermost Lever board (404); replaced with a working Palantir board.

The initial proxy restrictions changed during the session. Final API responses, rather than an assumed allowlist state, establish the source results above. Official docs were retrieved for Himalayas, Remotive, Ashby and Lever; Greenhouse's official documentation source was read from its GitHub repository because its direct documentation host was inaccessible. See [PROVIDERS.md](PROVIDERS.md).

## Still requiring external configuration and tests

- **Dedicated hosted Supabase project:** not created; URL, matching project ref and service-role key absent. Apply the migration only in a fresh isolated project, then run `doctor` and a real persistence/send run.
- **Resend delivery:** API key, verified sender domain and recipient absent. No message was sent or delivered. Check API acceptance, provider delivery event and receiving inbox after configuration.
- **GitHub scheduled execution:** workflow implemented for approximately 08:15 Africa/Lagos; disabled until `JOB_HUNTER_ENABLED=true`. Configure repository secrets, verify a manual send, enable it, then observe a real scheduled run. Local tests/YAML parsing do not verify GitHub execution.
- **Environment publication:** reusable instructions/domain requirements saved for review; only the product's publish operation can activate a snapshot. Fresh-task restoration was not tested.

Follow [OPERATIONS.md](OPERATIONS.md) to complete these steps. Never classify the hosted pipeline as fully configured until they have actually passed.

## GitHub publication blocker

The initial implementation was committed on local branch `main`. GitHub rejected `git push -u origin main` with HTTP 403: connected identity `austinmarklord-web` has no write permission to `sademsagi-afk/Job-Crawler`. Read access worked; that did not establish write access. No remote branch was created and GitHub CI/scheduling could not be verified. Grant that identity collaborator access or connect an account authorized to write to the target repository, then push `main`. Do not paste a token into chat.

A portable `artifacts/job-hunter.bundle` preserves the local commit/history and can be cloned with Git. Source files also remain in the workspace. Local-only commit restoration in a newly published cloud task was not verified; push access and snapshot/restoration remain external follow-ups.
