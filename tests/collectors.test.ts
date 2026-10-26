import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureCollection } from '../src/fixtures.js';
import { collectAll } from '../src/collectors/index.js';
import { collectAshby } from '../src/collectors/ashby.js';
import { collectLever } from '../src/collectors/lever.js';
import { collectHimalayas } from '../src/collectors/himalayas.js';
import { collectRemotive } from '../src/collectors/remotive.js';
import { SourcesConfig } from '../src/config.js';
import { Http } from '../src/http.js';
import { now } from './helpers.js';

async function httpWith(fetcher: typeof fetch) {
  return new Http({ cacheDir: await mkdtemp(join(tmpdir(), 'jh-test-')), fetch: fetcher, sleep: async () => {} });
}
test('all five collectors validate contract fixtures, retain attribution, preserve date uncertainty', async () => {
  const c = await fixtureCollection(now);
  assert.equal(c.health.length, 5);
  assert.ok(c.health.every(h => h.status === 'ok'));
  assert.equal(c.jobs.length, 8);
  assert.ok(c.jobs.every(j => j.attributions.length > 0));
  assert.equal(c.jobs.find(j => j.source === 'greenhouse')?.publishedAt, null);
  assert.equal(c.jobs.find(j => j.source === 'remotive' && j.sourceId === '100')?.publishedAt, null);
  assert.equal(c.jobs.find(j => j.source === 'ashby')?.sourceId, 'fixture:synthetic-id');
  assert.ok(c.jobs.some(j => j.eligibility.status === 'ineligible'));
});
test('source failure does not stop another provider', async () => {
  const http = await httpWith(async input => String(input).includes('remotive.com') ? new Response('denied', { status: 403 }) : new Response(JSON.stringify({ jobs: [] })));
  const c = await collectAll(http, now, SourcesConfig.parse({ himalayas: false, ashby: [{ token: 'test', company: 'Test' }] }));
  assert.equal(c.health[0]?.status, 'failed');
  assert.equal(c.health[1]?.status, 'ok');
});
test('Ashby omits unlisted roles and tolerates missing id; invalid shape is rejected', async () => {
  const http = await httpWith(async () => new Response(JSON.stringify({ jobs: [{ title: 'bad' }] })));
  await assert.rejects(collectAshby(http, now, { token: 'test', company: 'Test' }), /All rows/);
});
test('Himalayas search walks pages through short results and marks budget caps', async () => {
  const urls: string[] = [];
  const http = await httpWith(async input => {
    urls.push(String(input));
    return new Response(JSON.stringify({ jobs: Array.from({ length: 1 }, (_, i) => ({ guid: `https://himalayas.app/companies/test/jobs/${urls.length}-${i}`, title: 'Backend Engineer', companyName: 'Company', description: 'Node.js', applicationLink: `https://example.com/${urls.length}/${i}`, locationRestrictions: [], timezoneRestrictions: [1] })) }));
  });
  const c = await collectHimalayas(http, now, 2);
  assert.equal(urls.length, 4);
  assert.ok(urls[1]?.endsWith('page=2'));
  assert.ok(urls[0]?.includes('country=Nigeria'));
  assert.equal(c.health[0]?.status, 'degraded');
  assert.ok(c.jobs.every(j => j.eligibility.status === 'eligible'));
});
test('Lever pagination follows documented skip/limit and marks publication unknown', async () => {
  let count = 0;
  const http = await httpWith(async input => {
    count++;
    if (count === 2) { assert.ok(String(input).includes('skip=100')); return new Response('[]'); }
    return new Response(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: String(i), text: 'Backend Engineer', hostedUrl: `https://jobs.lever.co/test/${i}`, applyUrl: `https://jobs.lever.co/test/${i}/apply`, categories: { location: 'Worldwide' }, descriptionPlain: 'Node.js', workplaceType: 'remote' }))));
  });
  const c = await collectLever(http, now, { token: 'test', company: 'Test' }, 3);
  assert.equal(count, 2); assert.equal(c.jobs.length, 100); assert.equal(c.jobs[0]?.publishedAt, null);
});
test('invalid rows are visible without discarding valid rows', async () => {
  const http = await httpWith(async () => new Response(JSON.stringify({ jobs: [{ id: 1, title: 'Backend Engineer', company_name: 'Test', description: 'Node.js', url: 'https://remotive.com/jobs/1' }, { id: 'invalid' }] })));
  const c = await collectRemotive(http, now);
  assert.equal(c.jobs.length, 1); assert.equal(c.health[0]?.invalid, 1); assert.equal(c.health[0]?.status, 'degraded');
});

test('live-observed nullable Ashby remote flag uses explicit posting location, not a guess', async () => {
  const http = await httpWith(async () => new Response(JSON.stringify({ jobs: [{ title: 'Backend Engineer', location: 'Remote, Global', isRemote: null, descriptionPlain: 'TypeScript Node.js', jobUrl: 'https://jobs.ashbyhq.com/test/one', applyUrl: 'https://jobs.ashbyhq.com/test/one/application' }] })));
  const c = await collectAshby(http, now, { token: 'test', company: 'Test' });
  assert.equal(c.jobs[0]?.remote, true);
  assert.equal(c.jobs[0]?.eligibility.status, 'eligible');
});
test('Himalayas documented country and UTC+1 rules are applied, update time is never publication', async () => {
  const http = await httpWith(async input => {
    if (String(input).includes('page=2') || String(input).includes('q=developer')) return new Response('{"jobs":[]}');
    return new Response(JSON.stringify({ jobs: [
      { guid: 'https://himalayas.app/companies/test/jobs/one', title: 'Backend Engineer', companyName: 'Test', description: 'Node.js', applicationLink: 'https://himalayas.app/companies/test/jobs/one?utm_source=api', locationRestrictions: [], timezoneRestrictions: [0,1,2], pubDate: 1792886400 },
      { guid: 'https://himalayas.app/companies/test/jobs/two', title: 'Backend Engineer', companyName: 'Test', description: 'Node.js', applicationLink: 'https://example.com/two', locationRestrictions: [], timezoneRestrictions: [-5,-4] }
    ] }));
  });
  const c = await collectHimalayas(http, now, 3);
  assert.equal(c.jobs[0]?.publishedAt, null);
  assert.ok(c.jobs[0]?.sourceUpdatedAt);
  assert.equal(c.jobs[0]?.eligibility.status, 'eligible');
  assert.equal(c.jobs[1]?.eligibility.status, 'ineligible');
  assert.equal(c.jobs[0]?.applicationUrl, 'https://himalayas.app/companies/test/jobs/one?utm_source=api');
  assert.equal(c.jobs[0]?.salary.raw, '');
});

test('Ashby isRemote true does not override documented Hybrid workplace type', async () => {
  const http = await httpWith(async () => new Response(JSON.stringify({ jobs: [{ title: 'Backend Engineer', location: 'Remote, Global', isRemote: true, workplaceType: 'Hybrid', descriptionPlain: 'TypeScript Node.js', jobUrl: 'https://jobs.ashbyhq.com/test/hybrid', applyUrl: 'https://jobs.ashbyhq.com/test/hybrid/application' }] })));
  const c = await collectAshby(http, now, { token: 'test', company: 'Test' });
  assert.equal(c.jobs[0]?.remote, false); assert.equal(c.jobs[0]?.eligibility.status, 'ineligible');
});
test('Ashby structured salary excludes bonus/equity and preserves tier scope', async () => {
  const { ashbySalary } = await import('../src/collectors/ashby.js');
  const { normalizeSalary } = await import('../src/salary.js');
  const salary = normalizeSalary(ashbySalary({ compensationTierSummary: '$81K + bonus + equity', summaryComponents: [], compensationTiers: [{ title: 'Zone A', components: [
    { compensationType: 'Salary', interval: '1 YEAR', currencyCode: 'USD', minValue: 81000, maxValue: 87000 },
    { compensationType: 'Bonus', interval: '1 YEAR', currencyCode: 'USD', minValue: 5000, maxValue: 10000 }
  ] }] }));
  assert.deepEqual(salary.monthlyUsd, { min: 6750, max: 7250 });
  assert.ok(salary.scope?.includes('Zone A'));
});

test('Lever live onsite enum variant is retained as explicitly ineligible', async () => {
  const http = await httpWith(async () => new Response(JSON.stringify([{ id: 'onsite', text: 'Backend Engineer', hostedUrl: 'https://jobs.lever.co/test/onsite', applyUrl: 'https://jobs.lever.co/test/onsite/apply', categories: { location: 'Worldwide' }, descriptionPlain: 'Node.js', workplaceType: 'onsite' }])));
  const c = await collectLever(http, now, { token: 'test', company: 'Test' }, 2);
  assert.equal(c.health[0]?.invalid, 0); assert.equal(c.jobs[0]?.eligibility.status, 'ineligible');
});
