import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSalary } from '../src/salary.js';

test('explicit annual USD normalizes to monthly without rounding whole dollars', () => {
  assert.deepEqual(normalizeSalary({ raw: 'USD 48,000 - 72,000 per year' }).monthlyUsd, { min: 4000, max: 6000 });
  assert.deepEqual(normalizeSalary({ currency: 'USD', period: 'annually', min: 25000 }).monthlyUsd, { min: 2083.33, max: null });
});
test('explicit monthly and k suffix are supported', () => {
  assert.deepEqual(normalizeSalary({ raw: 'USD 2.5k–4k/month' }).monthlyUsd, { min: 2500, max: 4000 });
});
for (const [label, input] of Object.entries({
  'ambiguous dollar sign': { raw: '$48,000 - $72,000 per year' },
  'missing period': { raw: 'USD 48,000 - 72,000' },
  'non USD': { raw: 'EUR 48,000 - 72,000 per year' },
  'hourly needs hours': { raw: 'USD 40 - 60 per hour' },
  'weekly needs paid weeks': { raw: 'USD 1000 per week' },
  'invalid range': { currency: 'USD', period: 'month', min: 4000, max: 2000 },
  'negative bound': { currency: 'USD', period: 'month', min: -1000 },
  'mixed currencies': { raw: 'USD 48,000 or EUR 44,000 per year' },
  'multiple geographic bands': { raw: 'US USD 100000 per year; Africa USD 50000 per year' },
  'OTE': { raw: 'USD 100000 per year OTE including bonus' },
  'structured/raw conflict': { currency: 'USD', period: 'year', min: 50000, raw: 'EUR 50000 per year' },
})) test(`does not normalize ${label}`, () => assert.equal(normalizeSalary(input).monthlyUsd, null));

test('description salary extraction preserves uncertainty and separates scoped bands', async () => {
  const { salaryFromDescription } = await import('../src/salary.js');
  assert.deepEqual(normalizeSalary(salaryFromDescription('Base salary: USD 48,000–72,000 per year.')).monthlyUsd, { min: 4000, max: 6000 });
  assert.equal(normalizeSalary(salaryFromDescription('Total compensation including equity: USD 100000 per year.')).monthlyUsd, null);
  assert.equal(normalizeSalary(salaryFromDescription('Salary up to USD 60000 per year.')).monthlyUsd, null);
  assert.ok(salaryFromDescription('US salary: USD 120000 per year.').scope);
  assert.deepEqual(salaryFromDescription('Our payments API processes USD 5000 per month.'), {});
  assert.ok(salaryFromDescription('Salary: US USD 120000 per year; Nigeria USD 48000 per year.').scope);
});

test('structured salary does not erase a regional band restriction in the description', async () => {
  const { makeJob } = await import('../src/collectors/common.js');
  const { rankJob } = await import('../src/ranking.js');
  const now = new Date('2026-10-26T07:15:00Z');
  const j = makeJob({ source: 'lever', sourceId: 'regional', title: 'Backend Engineer', company: 'Example',
    description: 'TypeScript Node.js PostgreSQL. US base salary: USD 120000 per year.', location: 'Worldwide', remote: true,
    url: 'https://example.com/regional', salary: { min: 120000, max: 150000, currency: 'USD', period: 'year' } }, now);
  assert.ok(j.salary.scope); assert.equal(rankJob(j, now).ranked?.section, 'salary-review');
});
