import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Http } from '../src/http.js';
import { SupabaseStore } from '../src/persistence.js';
import { renderDigest } from '../src/email.js';
import { rankJob } from '../src/ranking.js';
import { persistenceEnv } from '../src/config.js';
import { job, now } from './helpers.js';

const db = new PGlite();
const migration = await readFile('supabase/migrations/001_job_hunter.sql', 'utf8');
const key = 'not-a-real-secret-for-local-tests';
const store = new SupabaseStore(new Http({ fetch: async (url, init) => {
  assert.equal(new Headers(init?.headers).get('apikey'), key);
  const name = new URL(String(url)).pathname.split('/').at(-1)!;
  assert.match(name, /^jh_[a-z_]+$/);
  const params = JSON.parse(String(init?.body)) as Record<string, unknown>;
  const keys = Object.keys(params);
  for (const k of keys) assert.match(k, /^p_[a-z_]+$/);
  const result = await db.query<{ value: unknown }>(`select public.${name}(${keys.map((k, i) => `${k}=>$${i + 1}`).join(',')}) as value`,
    Object.values(params).map(v => v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v));
  if (['jh_upsert_jobs','jh_record_health','jh_complete_digest','jh_release_digest'].includes(name)) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(result.rows[0]?.value));
}, sleep: async () => {} }), { url: 'https://local-test.supabase.co', key });
const to = 'owner@example.com'; const from = 'jobs@example.com';
const content = () => renderDigest([rankJob(job(), now).ranked!], [], now);

before(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(migration);
});
beforeEach(async () => { await db.exec('truncate jh_notifications,jh_digests,jh_jobs,jh_source_health restart identity cascade;'); });
after(async () => { await db.close(); });

test('actual PostgreSQL migration is repeatable and anon cannot execute/write', async () => {
  await db.exec(migration);
  const r = await db.query<{ allowed: boolean }>("select has_function_privilege('anon','public.jh_upsert_jobs(jsonb)','execute') as allowed");
  assert.equal(r.rows[0]?.allowed, false);
  assert.equal((await db.query<{ allowed: boolean }>("select has_table_privilege('anon','public.jh_jobs','insert') as allowed")).rows[0]?.allowed, false);
  assert.equal((await db.query<{ rls: boolean }>("select relrowsecurity as rls from pg_class where oid='public.jh_jobs'::regclass")).rows[0]?.rls, true);
});
test('refuses migration into another application database', async () => {
  const other = new PGlite();
  try {
    await other.exec('create table public.other_app(id int);');
    await assert.rejects(other.exec(migration), /public schema is not empty/);
  } finally { await other.close(); }
});
test('upsert preserves tracking/notes and records source health', async () => {
  await store.verify();
  await store.saveJobs([job()]);
  await store.track(job().id, 'Applied', 'Manually applied');
  await store.saveJobs([job({ title: 'Updated Backend Engineer' })]);
  const r = await db.query<{ status: string; notes: string; title: string }>("select status,notes,payload->>'title' as title from jh_jobs");
  assert.deepEqual(r.rows[0], { status: 'Applied', notes: 'Manually applied', title: 'Updated Backend Engineer' });
  assert.ok((await store.notificationState(to)).tracked.has(job().id));
  await store.saveHealth([{ source: 'lever', status: 'failed', count: 0, invalid: 0, checkedAt: now.toISOString(), detail: 'HTTP 503' }]);
  assert.equal((await db.query<{ n: number }>('select count(*)::int n from jh_source_health')).rows[0]?.n, 1);
});
test('reservation lease isolates concurrent attempts and persists immutable content', async () => {
  await store.saveJobs([job()]);
  const first = await store.prepare('2026-10-26', to, from, content());
  assert.equal(first.state, 'pending');
  const second = await store.prepare('2026-10-26', to, from, { ...content(), html: 'CHANGED' });
  assert.equal(second.state, 'busy');
  if (first.state !== 'pending') return;
  await store.release(first.digest.id, first.digest.leaseToken!);
  const third = await store.prepare('2026-10-26', to, from, { ...content(), html: 'CHANGED' });
  assert.equal(third.state, 'pending');
  if (third.state !== 'pending') return;
  assert.equal(third.digest.html, first.digest.html);
  assert.equal(third.digest.id, first.digest.id);
  await assert.rejects(store.complete(third.digest.id, randomUUID(), 'email-id'));
  assert.equal((await store.notificationState(to)).notified.size, 0);
  await store.complete(third.digest.id, third.digest.leaseToken!, 'email-id');
  await store.complete(third.digest.id, third.digest.leaseToken!, 'email-id');
  assert.ok((await store.notificationState(to)).notified.has(job().id));
  assert.equal((await store.prepare('2026-10-26', to, from, content())).state, 'sent');
  assert.equal((await store.prepare('2026-10-27', to, from, content())).state, 'stale');
});
test('ambiguous pending send beyond 23h blocks a new digest', async () => {
  await store.saveJobs([job()]);
  const d = await store.prepare('2026-10-25', to, from, content());
  assert.equal(d.state, 'pending');
  await db.exec("update jh_digests set created_at=now()-interval '24 hours',lease_until=null");
  assert.equal((await store.prepare('2026-10-26', to, from, content())).state, 'needs_reconciliation');
});
test('project reference validation prevents accidental cross-project use', () => {
  const base = { SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co', SUPABASE_PROJECT_REF: 'bbbbbbbbbbbbbbbbbbbb', SUPABASE_SERVICE_ROLE_KEY: key };
  assert.throws(() => persistenceEnv(base), /exactly match/);
  assert.equal(persistenceEnv({ ...base, SUPABASE_PROJECT_REF: 'aaaaaaaaaaaaaaaaaaaa' }).ref, 'aaaaaaaaaaaaaaaaaaaa');
});
