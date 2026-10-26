# Working on this repository

Use the existing checkout; each cloud task is already isolated. Do not create a worktree unless the user requests it.

Use Node 22.21+ and `npm ci`. Run `npm run check` for code changes and `npm run fixtures` for a safe end-to-end preview. `npm run dry-run` uses live public APIs but never writes Supabase or sends email. Sending requires explicit `run --send` and configured credentials.

Keep eligibility and compensation conservative. “Remote” is not Nigeria eligibility. Do not invent currency, period, pay floors, publication dates, or employer authorization. Label evidence vs inference. Keep Remotive listing links and all source credits. Do not add scraping or application submissions casually.

Never log secrets or API response bodies that may contain them. Preserve proxy/CA trust. Use only a dedicated Supabase project and retain the migration/isolation guards. Preserve immutable pending email payloads and idempotency keys; never delete notification history to make a test pass.

Do not claim live APIs, hosted Supabase, scheduled execution or email delivery are verified from fixture tests. Update docs/VALIDATION.md when actual verification is performed.
