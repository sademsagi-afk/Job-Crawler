import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessEligibility } from '../src/eligibility.js';

const eligibility = (location: string, description = '', countries: string[] = [], remote: boolean | null = true) => assessEligibility({ location, description, countries, remote }).status;
for (const location of ['Remote — Nigeria', 'Remote Africa', 'Remote EMEA', 'Worldwide', 'Remote - Anywhere in the world']) {
  test(`explicit eligibility: ${location}`, () => assert.equal(eligibility(location), 'eligible'));
}
for (const location of ['Remote', 'Distributed', 'South Africa', 'Remote - US', 'Remote Europe', 'Remote UK', 'Remote Americas']) {
  test(`does not assume Nigeria from ${location}`, () => assert.notEqual(eligibility(location), 'eligible'));
}
test('explicit country list controls eligibility', () => {
  assert.equal(eligibility('Worldwide', '', ['US', 'GB']), 'ineligible');
  assert.equal(eligibility('Remote', '', ['NG']), 'eligible');
});
test('remote is required even for Nigeria or worldwide', () => {
  assert.notEqual(eligibility('Nigeria', '', [], null), 'eligible');
  assert.equal(eligibility('Hybrid - Worldwide'), 'ineligible');
  assert.equal(eligibility('Worldwide', '', [], false), 'ineligible');
});
for (const restriction of [
  'We hire worldwide except Nigeria.',
  'We cannot hire in Africa.',
  'Candidates must reside in the United States.',
  'Candidates must have US citizenship.',
]) test(`explicit restriction wins: ${restriction}`, () => assert.equal(eligibility('Worldwide', restriction), 'ineligible'));
test('business hours do not mean US residence', () => assert.equal(eligibility('Worldwide', 'Work US business hours.'), 'eligible'));
test('global mission wording is insufficient', () => assert.equal(eligibility('Remote', 'We help customers worldwide.'), 'unknown'));
test('conflicting location labels do not prove eligibility', () => assert.notEqual(eligibility('Worldwide / US only'), 'eligible'));
for (const restriction of [
  'Only US applicants can apply.',
  'You must have the right to work in Canada.',
  'Eligible countries: Germany, France, United Kingdom.',
  'This role is hybrid with office days every week.',
  'Applicants must have U.S. citizenship.',
]) test(`does not override restrictive prose with worldwide: ${restriction}`, () => assert.notEqual(eligibility('Worldwide', restriction), 'eligible'));
