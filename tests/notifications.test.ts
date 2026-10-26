import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Http } from '../src/http.js';
import { renderDigest, lagosDay } from '../src/email.js';
import { sendDigest, type PreparedDigest } from '../src/notifications.js';
import { runPipeline } from '../src/pipeline.js';
import { rankJob } from '../src/ranking.js';
import { fixtureCollection } from '../src/fixtures.js';
import type { Store, Preparation } from '../src/persistence.js';
import type { Job, SourceHealth } from '../src/types.js';
import { job, now } from './helpers.js';

const config = { key: 'not-a-real-key', to: 'owner@example.com', from: 'jobs@example.com' };
function prepared(): PreparedDigest {
  return { ...renderDigest([rankJob(job(), now).ranked!], [], now), id: randomUUID(), leaseToken: randomUUID(), createdAt: new Date().toISOString(), recipient: config.to, sender: config.from, state: 'pending' };
}
test('Resend transient retry uses same idempotency key and exact persisted payload', async () => {
  const requests: { key: string | null; body: BodyInit | null | undefined }[] = [];
  const d = prepared();
  const http = new Http({ sleep: async () => {}, fetch: async (_input, init) => {
    requests.push({ key: new Headers(init?.headers).get('idempotency-key'), body: init?.body });
    return requests.length === 1 ? new Response('', { status: 503 }) : new Response('{"id":"email-123"}');
  } });
  assert.equal(await sendDigest(http, d, config), 'email-123');
  assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0]?.key, `job-hunter/${d.id}`);
});
test('stale ambiguous send and address changes are blocked before HTTP', async () => {
  let calls = 0;
  const http = new Http({ fetch: async () => { calls++; return new Response('{}'); } });
  await assert.rejects(sendDigest(http, { ...prepared(), createdAt: new Date(Date.now() - 24 * 3_600_000).toISOString() }, config), /manual reconciliation/);
  await assert.rejects(sendDigest(http, { ...prepared(), recipient: 'other@example.com' }, config), /differs/);
  assert.equal(calls, 0);
});
test('HTML escapes untrusted content and includes evidence, source credit and separate salary sections', () => {
  const malicious = job({ title: '<img src=x onerror=alert(1)> Backend Engineer' });
  const disclosed = rankJob(malicious, now).ranked!;
  const unknown = rankJob(job({ id: 'other', salary: { ...malicious.salary, raw: '', min: null, max: null, monthlyUsd: null } }), now).ranked!;
  const content = renderDigest([disclosed, unknown], [], now, true);
  assert.ok(!content.html.includes('<img'));
  assert.ok(content.html.includes('&lt;img'));
  assert.ok(content.html.includes('Compensation not disclosed'));
  assert.ok(content.html.includes('minimum verified'));
  assert.ok(content.html.includes('inference:'));
  assert.ok(content.html.includes('Sources:'));
  assert.ok(content.subject.startsWith('[PREVIEW]'));
});
test('digest day follows Africa/Lagos across UTC midnight', () => assert.equal(lagosDay(new Date('2026-10-25T23:15:00Z')), '2026-10-26'));

test('fixture end-to-end dry-run writes a real preview and does not touch credentials, persistence or delivery', async () => {
  let calls = 0;
  const dir = await mkdtemp(join(tmpdir(), 'jh-preview-'));
  const result = await runPipeline({ collection: await fixtureCollection(now), now, limit: 10, artifactDir: dir,
    dryRun: true, http: new Http({ fetch: async () => { calls++; throw new Error('must not send'); } }) });
  assert.equal(result.delivery, 'preview-only'); assert.ok(result.selected >= 5); assert.equal(calls, 0);
  const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')) as { selected: { job: Job }[] };
  assert.ok(report.selected.every(m => m.job.eligibility.status === 'eligible'));
  assert.ok((await readFile(join(dir, 'digest.html'), 'utf8')).includes('SYNTHETIC'));
});

test('notification history and application statuses exclude known jobs; sent reservation never sends twice', async () => {
  let sent = 0; let saved = 0;
  const one = job();
  const http = new Http({ fetch: async () => { sent++; return new Response('{"id":"email-id"}'); } });
  const store: Store = {
    verify: async () => {}, saveJobs: async () => { saved++; }, saveHealth: async () => {},
    notificationState: async () => ({ notified: new Set([one.id]), tracked: new Set() }),
    prepare: async (_day, _to, _from, content): Promise<Preparation> => { assert.equal(content.jobIds.length, 0); return { state: 'sent' }; },
    complete: async () => { throw new Error('must not complete'); }, release: async () => {},
  };
  const health: SourceHealth[] = [{ source: 'lever', status: 'ok', checkedAt: now.toISOString(), count: 1, invalid: 0, detail: 'Test' }];
  const result = await runPipeline({ collection: { jobs: [one], health }, now, limit: 10, artifactDir: await mkdtemp(join(tmpdir(), 'jh-pipeline-')), store, mail: config, http, dryRun: false });
  assert.equal(result.delivery, 'sent'); assert.equal(sent, 0); assert.equal(saved, 1);
});

test('failed persistence blocks email, failed delivery leaves pending content available', async () => {
  let sent = 0; let released = 0;
  const d = prepared();
  const store: Store = {
    verify: async () => {}, saveJobs: async () => { throw new Error('Database unavailable'); }, saveHealth: async () => {},
    notificationState: async () => ({ notified: new Set(), tracked: new Set() }),
    prepare: async () => ({ state: 'pending', digest: d }), complete: async () => {}, release: async () => { released++; },
  };
  const health: SourceHealth[] = [{ source: 'lever', status: 'ok', checkedAt: now.toISOString(), count: 1, invalid: 0, detail: 'Test' }];
  const options = { collection: { jobs: [job()], health }, now, limit: 10, artifactDir: await mkdtemp(join(tmpdir(), 'jh-pipeline-')), store, mail: config,
    http: new Http({ sleep: async () => {}, fetch: async () => { sent++; return new Response('', { status: 401 }); } }), dryRun: false };
  await assert.rejects(runPipeline(options), /Database unavailable/); assert.equal(sent, 0);
  store.saveJobs = async () => {};
  await assert.rejects(runPipeline(options), /HTTP 401/); assert.equal(sent, 1); assert.equal(released, 1);
});
test('all-source outage fails the run and sends nothing', async () => {
  await assert.rejects(runPipeline({ collection: { jobs: [], health: [{ source: 'remotive', status: 'failed', count: 0, invalid: 0, checkedAt: now.toISOString(), detail: 'denied' }] }, now, limit: 10, dryRun: true,
    artifactDir: await mkdtemp(join(tmpdir(), 'jh-outage-')), http: new Http() }), /No source succeeded/);
});

test('fresh shortlist check drops a closed role and retains other verified matches', async () => {
  const c = await fixtureCollection(now);
  const dir = await mkdtemp(join(tmpdir(), 'jh-freshness-'));
  let rechecks = 0;
  await runPipeline({ collection: c, now, limit: 10, artifactDir: dir, dryRun: true, http: new Http(), recheck: async j => {
    if (j.source === 'himalayas') { rechecks++; throw new Error('HTTP 410 closed'); }
    return j;
  } });
  const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')) as { selected: { job: Job }[]; rejected: { reason: string }[] };
  assert.equal(rechecks, 1);
  assert.ok(report.selected.every(r => r.job.source !== 'himalayas'));
  assert.ok(report.rejected.some(r => r.reason.includes('failed/closed')));
});
