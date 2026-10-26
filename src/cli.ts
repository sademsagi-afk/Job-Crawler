import { resolve } from 'node:path';
import { recheckHimalayas } from './collectors/himalayas.js';
import { collectAll } from './collectors/index.js';
import { loadSources, notificationEnv, persistenceEnv } from './config.js';
import { fixtureCollection } from './fixtures.js';
import { Http } from './http.js';
import { SupabaseStore } from './persistence.js';
import { runPipeline } from './pipeline.js';
import { Status } from './types.js';

async function main(): Promise<void> {
  const [command = 'help', ...args] = process.argv.slice(2);
  const http = new Http();
  if (command === 'run' || command === 'sources:check') {
    const allowed = new Set(['--dry-run', '--send', '--fixtures']);
    if (args.some(a => !allowed.has(a))) throw new Error('Unknown argument. See npm start -- help.');
    if (args.includes('--send') && (args.includes('--dry-run') || args.includes('--fixtures') || command === 'sources:check')) throw new Error('--send cannot be combined with dry-run, fixtures, or sources:check.');
    const dryRun = !args.includes('--send');
    const now = args.includes('--fixtures') ? new Date('2026-10-26T07:15:00Z') : new Date();
    const config = await loadSources(process.env.SOURCES_CONFIG ?? 'config/sources.json');
    // Validate production credentials before spending API budget; dry-runs need none.
    const store = dryRun ? undefined : new SupabaseStore(http, persistenceEnv());
    const mail = dryRun ? undefined : notificationEnv();
    if (store) await store.verify();
    const collection = args.includes('--fixtures') ? await fixtureCollection(now) : await collectAll(http, now, config);
    const result = await runPipeline({ collection, now, limit: config.digestLimit, http, dryRun, artifactDir: 'artifacts',
      ...(store ? { store } : {}), ...(mail ? { mail } : {}), ...(args.includes('--fixtures') ? {} : { recheck: (job) => recheckHimalayas(http, job, now) }) });
    console.log(JSON.stringify({ ...result, data: args.includes('--fixtures') ? 'synthetic-fixtures' : 'live-public-APIs (may use HTTP cache)', artifacts: resolve('artifacts') }, null, 2));
    if (command === 'sources:check' && collection.health.some(h => h.status === 'failed' || h.invalid > 0)) process.exitCode = 1;
    return;
  }
  if (command === 'doctor') {
    for (const name of ['SUPABASE_URL', 'SUPABASE_PROJECT_REF', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'DIGEST_FROM', 'DIGEST_TO']) console.log(`${name}: ${process.env[name] ? 'present' : 'missing'}`);
    await new SupabaseStore(http, persistenceEnv()).verify();
    notificationEnv();
    console.log('Dedicated database identity verified; email configuration present. Email delivery has not been tested by doctor.');
    return;
  }
  if (command === 'track' || command === 'list') {
    const store = new SupabaseStore(http, persistenceEnv());
    await store.verify();
    if (command === 'list') {
      if (args.length > 1) throw new Error('Usage: list [status]');
      console.log(JSON.stringify(await store.list(args[0] ? Status.parse(args[0]) : null), null, 2));
    } else {
      const [id, status, ...notes] = args;
      if (!id || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Usage: track <full-job-id> <status> [notes]');
      await store.track(id, Status.parse(status), notes.join(' '));
      console.log('Application tracking updated. No application was submitted.');
    }
    return;
  }
  if (command !== 'help') throw new Error('Unknown command.');
  console.log('Commands:\n  run [--dry-run | --send] [--fixtures]\n  sources:check\n  doctor\n  list [status]\n  track <id> <New|Interested|Applied|Interviewing|Rejected|Offer> [notes]\n\nrun defaults to a read-only preview. Fixture mode cannot send.');
}
main().catch(error => {
  // Zod errors can contain supplied values; never dump environment validation or provider bodies.
  console.error(error instanceof Error && error.name !== 'ZodError' ? error.message : 'Configuration or payload validation failed. Check .env.example and provider contracts; values omitted.');
  process.exitCode = 1;
});
