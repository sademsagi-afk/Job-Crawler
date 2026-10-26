import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, deduplicate, jobId } from '../src/dedup.js';
import { job } from './helpers.js';

test('canonical URLs strip only known tracking fields and preserve requisition IDs', () => {
  assert.equal(canonicalUrl('https://jobs.lever.co/co/123/apply?utm_source=x&ref=y#top'), 'https://jobs.lever.co/co/123');
  assert.notEqual(jobId('https://example.com/job?id=1'), jobId('https://example.com/job?id=2'));
});
test('same application via multiple sources is one job, preserving source credits', () => {
  const a = job();
  const b = job({ source: 'remotive', sourceId: '2', applicationUrl: `${a.applicationUrl}/apply?utm_source=remotive`,
    attributions: [{ source: 'remotive', sourceId: '2', url: 'https://remotive.com/job/2', applyUrl: a.applicationUrl }] });
  const result = deduplicate([b, a]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.source, 'lever');
  assert.equal(result[0]?.attributions.length, 2);
  assert.equal(a.attributions.length, 1); // does not mutate its input
});
test('similar titles with distinct requisition URLs remain distinct', () => assert.equal(deduplicate([job(), job({ applicationUrl: 'https://jobs.lever.co/example/two' })]).length, 2));
