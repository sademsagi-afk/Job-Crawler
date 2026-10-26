# Deployment and operation

## Configuration checklist

Use Node 22.21+ and the lockfile (`npm ci`). `npm start` enables Node's supported environment-proxy handling, preserving `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` and the configured CA trust. Do not disable TLS verification. The cloud environment includes a session CA via `NODE_EXTRA_CA_CERTS`; keep it inherited.

The selected application workflow needs public HTTPS access to:

```text
himalayas.app
remotive.com
boards-api.greenhouse.io
api.ashbyhq.com
api.lever.co
api.resend.com
<your-dedicated-project-ref>.supabase.co
```

Use `api.eu.lever.co` if a configured employer uses Lever EU. Documentation review additionally needs `developers.greenhouse.io`, `developers.ashbyhq.com`, `resend.com`, `supabase.com` and `github.com`. npm installation needs `registry.npmjs.org`. Only add the exact Supabase host after creating the dedicated project. No access to your other projects is needed.

The Codex environment draft contains the provider-domain additions, but draft persistence does not apply network changes. Review/save in environment settings and publish the prepared environment separately when appropriate. Configure Supabase/Resend credentials there for cloud validation, and independently in GitHub repository Actions secrets for scheduling. Never paste secret values into chat or commit them. `doctor` reports only missing/present states and checks the DB identity.

## First deployment

1. Create a fresh Supabase project and apply `supabase/migrations/001_job_hunter.sql`. Confirm no other application uses that project. The migration guard rejects a populated `public` schema.
2. Configure the six variables in `.env.example` securely. Use the actual dedicated project ref; never just change the ref to match an unrelated URL. Verify the Resend sending domain, including DNS authentication required by Resend.
3. Run `npm ci && npm run check`. Run `npm run sources:check` with real network access and review the current official provider docs in `PROVIDERS.md`. Replace invalid employer-board tokens or remove their configs. Fix schema changes before activation.
4. Run `npm start -- doctor`. This verifies the database identity and that email config exists; it does not send a test message.
5. Run `npm run dry-run`. Inspect the entire `artifacts/digest.html` and source-health report. Check several source listings manually for Nigeria eligibility and pay applicability. Unknown eligibility must stay excluded.
6. Run `npm start -- run --send` once. Inspect the Resend event and receiving inbox. API acceptance is not inbox delivery. Resolve bounces or sending-domain issues before scheduling.
7. Ensure this code is on the GitHub default branch. Add GitHub Actions secrets and run the discovery workflow manually in preview and send modes. Set Actions variable `JOB_HUNTER_ENABLED=true` only after that verification.
8. Observe the next scheduled run after approximately 08:15 Africa/Lagos and its delivery event. GitHub schedules can be delayed. A configured cron is not evidence that scheduling has executed.

CI runs tests and a synthetic preview only. It does not need secrets or contact job APIs. The discovery workflow serializes manual/scheduled runs and retries a failure once after six minutes. The public API cache is saved even if delivery fails. Manual previews also use the cache, protecting provider request budgets. Cache eviction and runs from multiple independent machines are not a globally enforced provider quota: avoid repeated manual runs across separate machines, especially for Remotive.

## What failures mean

- `failed` source health: payload/network/authorization failure; another source can still supply jobs. All sources failing makes the CLI fail without sending. Partial coverage is visible in both preview and email. Check the Actions logs/report regularly; no second notification channel is configured.
- `degraded`: invalid rows discarded or page budget reached. Increase a budget only after checking provider limits; payload drift needs an adapter fix, not looser validation.
- `HTTP 401/403`: verify the destination policy and operation-specific authorization. Missing `GH_TOKEN` is unrelated to these public APIs. Do not add GitHub tokens for public job feeds.
- Network/TLS/timeout: inspect the cloud runtime's supported diagnostics and configured CA/proxy; never unset the proxy to bypass policy. The code deliberately omits response bodies and credentials from errors.
- Supabase identity mismatch: verify the dedicated project, migration and key. Do not bypass the identity or migration guard.
- `busy`: another worker holds a 5min database lease. Allow it to finish; a crashed runner's lease expires. GitHub's retry waits six minutes.
- `stale`: jobs changed status or were already notified between selection and reservation. Retry the run; selection will re-read history. No email was sent for that new reservation.
- Empty shortlist: there may be no new eligible roles. The system sends no empty email and does not relax eligibility/pay evidence to fill slots.
- Resend failure: pending content remains persisted. Correct configuration and retry promptly with the same addresses. Do not delete its reservation or change the payload to force a send.

## Recovering an uncertain email

The provider's idempotency guarantee has finite retention. A pending digest older than 23h blocks all new sends for its recipient. It does not assume that a request failed just because the response or database receipt was lost.

Inspect pending records in the **dedicated** project's SQL editor:

```sql
select id, day, state, created_at, lease_until, provider_id, job_ids
from public.jh_digests where state='pending' order by created_at;
```

Look up the exact recipient, subject, time and idempotency key `job-hunter/<id>` in Resend. Keep its HTML/text private: it contains your preferences and shortlist.

If Resend confirms acceptance, mark the corresponding digest complete using its actual email ID, in the dedicated SQL editor (replace the placeholders):

```sql
select public.jh_complete_digest(
  'DIGEST_UUID'::uuid,
  (select lease_token from public.jh_digests where id='DIGEST_UUID'::uuid),
  'CONFIRMED_RESEND_EMAIL_ID'
);
```

This atomically records notification history. It does not send an email. The current lease token can be NULL if a failed attempt released it; reconciliation is privileged SQL performed after verification.

If Resend conclusively confirms that no request was accepted, you may mark that digest `abandoned` to stop retrying it:

```sql
update public.jh_digests set state='abandoned',lease_token=null,lease_until=null
where id='DIGEST_UUID'::uuid and state='pending';
```

An abandoned daily record still prevents another send that same day. On a later day, currently collected/unnotified jobs can qualify again. If the outcome is uncertain, leave it pending and investigate; do not reset/delete history or resend outside the retention window.

## Maintenance

Review source coverage, provider terms and compensation/eligibility heuristics periodically. Add employer boards intentionally. Audit dependencies (`npm audit`) and keep action SHAs current. Inspect Actions failures and source health. Track legitimate opportunities manually after reviewing the employer's own site; never pay an application/recruitment fee or send sensitive identity documents solely on an aggregator listing.

Back up the dedicated project and follow its storage limits. Health is an append-only small daily history; descriptions can be large. If necessary, archive old descriptions while retaining job IDs, application status/notes and notification history. Do not delete idempotency/history records to clear an operational error. No other application's database or secrets should be needed for this tool.
