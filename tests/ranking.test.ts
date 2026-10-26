import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankJob } from '../src/ranking.js';
import { normalizeSalary } from '../src/salary.js';
import { job, now } from './helpers.js';

test('transparent deterministic ranking prioritizes strong pay and skill overlap', () => {
  const high = rankJob(job(), now).ranked;
  const low = rankJob(job({ salary: normalizeSalary({ currency: 'USD', period: 'month', min: 2500, max: 3000 }) }), now).ranked;
  assert.ok(high && low && high.score > low.score);
  assert.deepEqual(rankJob(job(), now), rankJob(job(), now));
  assert.ok(high.reasons.some(r => r.kind === 'inference'));
  assert.ok(high.reasons.some(r => r.kind === 'verified' && r.detail.includes('USD 4000')));
});
test('pay below minimum is rejected; overlapping/region-specific pay needs review', () => {
  assert.equal(rankJob(job({ salary: normalizeSalary({ currency: 'USD', period: 'month', min: 1000, max: 1900 }) }), now).ranked, null);
  for (const input of [
    { currency: 'USD', period: 'month', min: 1000, max: 5000 },
    { currency: 'USD', period: 'month', max: 5000 },
    { currency: 'USD', period: 'year', min: 120000, scope: 'US only pay band' },
  ]) assert.equal(rankJob(job({ salary: normalizeSalary(input) }), now).ranked?.section, 'salary-review');
});
test('missing pay is separated; date unknown does not become fresh', () => {
  const result = rankJob(job({ salary: normalizeSalary(), publishedAt: null }), now).ranked;
  assert.equal(result?.section, 'undisclosed');
  assert.ok(result?.reasons.some(r => r.kind === 'unknown' && r.detail.includes('Publication')));
});
test('expired, stale, implausible experience, irrelevant, junior, and ineligible jobs are rejected', () => {
  for (const overrides of [
    { expiresAt: '2026-10-01T00:00:00Z' }, { publishedAt: '2025-01-01T00:00:00Z' },
    { publishedAt: '2030-01-01T00:00:00Z' }, { description: 'TypeScript. 10+ years of experience.' },
    { title: 'Marketing Manager' }, { title: 'Junior Backend Engineer' },
    { eligibility: { status: 'unknown' as const, evidence: ['Remote only'] } },
  ]) assert.equal(rankJob(job(overrides), now).ranked, null);
});

test('explicit unsupported primary backend stack is rejected; mixed stack is labeled', () => {
  assert.equal(rankJob(job({ title: 'AI Product Engineer (Elixir)' }), now).ranked, null);
  assert.ok(rankJob(job({ title: 'Senior Full Stack Developer (Node.js + PHP)' }), now).ranked?.reasons.some(r => r.kind === 'unknown' && r.detail.includes('php')));
});

test('unpaid/volunteer/intern employment is excluded even if the title omits it', () => {
  for (const employmentType of ['Volunteer', 'Internship', 'Unpaid']) assert.equal(rankJob(job({ employmentType }), now).ranked, null);
});
