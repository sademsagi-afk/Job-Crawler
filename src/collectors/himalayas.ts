import { z } from 'zod';
import type { Http } from '../http.js';
import { isoDate, type Job } from '../types.js';
import { health, makeJob, nonempty, optionalText, positive, rows, validatedRows } from './common.js';

export const himalayasRow = z.object({
  guid: nonempty, title: nonempty, companyName: nonempty,
  description: z.string(), applicationLink: nonempty, pubDate: z.number().finite().nullish(),
  expiryDate: z.number().finite().nullish(), employmentType: optionalText,
  locationRestrictions: z.array(z.string()).default([]),
  timezoneRestrictions: z.array(z.number().finite().min(-12).max(14)),
  minSalary: positive, maxSalary: positive, currency: optionalText, salaryPeriod: optionalText,
});
function normalize(j: z.output<typeof himalayasRow>, now: Date): Job {
  // Official API semantics: empty country list = all countries; UTC offsets are numeric.
  // Nigeria uses standard UTC+1 year round. Both dimensions must permit it.
  const allowsCountry = j.locationRestrictions.length === 0 || j.locationRestrictions.some(c => /^(?:Nigeria|NG)$/i.test(c));
  const allowsOffset = j.timezoneRestrictions.includes(1);
  const location = `${j.locationRestrictions.length ? j.locationRestrictions.join(', ') : 'Worldwide'}; remote; Nigeria UTC+1 ${allowsOffset ? 'permitted' : 'not permitted'}`;
  const job = makeJob({ source: 'himalayas', sourceId: j.guid, company: j.companyName,
    title: j.title, description: j.description, url: j.guid, applyUrl: j.applicationLink,
    location, countries: j.locationRestrictions, timezoneRestrictions: j.timezoneRestrictions, remote: true,
    salary: { raw: j.minSalary != null || j.maxSalary != null ? `${j.currency ?? 'currency unknown'} ${j.minSalary ?? '?'}–${j.maxSalary ?? '?'} ${j.salaryPeriod ?? 'period unknown'}` : '',
      min: j.minSalary ?? null, max: j.maxSalary ?? null, currency: j.currency ?? null, period: j.salaryPeriod ?? null },
    employmentType: j.employmentType ?? null,
    // Despite its name, current docs define pubDate as LAST UPDATED, not publication.
    sourceUpdatedAt: j.pubDate == null ? null : j.pubDate * 1000,
    expiresAt: j.expiryDate == null ? null : j.expiryDate * 1000,
  }, now);
  if (!allowsCountry || !allowsOffset) job.eligibility = { status: 'ineligible', evidence: [!allowsCountry ? 'Himalayas explicit country restrictions omit Nigeria.' : 'Himalayas allowed standard UTC offsets do not include Nigeria (UTC+1).'] };
  if (job.eligibility.status === 'eligible') job.eligibility.evidence.unshift('Himalayas country and standard UTC-offset rules explicitly permit Nigeria (UTC+1).');
  return job;
}
export async function collectHimalayas(http: Http, now: Date, maxPages: number) {
  const jobs: Job[] = []; let invalid = 0; let truncated = false;
  // Targeted public searches avoid walking an unrelated global feed. Country-filter semantics
  // are also validated locally; search results can shift and totalCount is only an estimate.
  for (const query of ['engineer', 'developer']) {
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({ q: query, country: 'Nigeria', sort: 'recent', page: String(page) });
      const body = z.object({ jobs: rows }).parse(await http.get(`https://himalayas.app/jobs/api/search?${params}`, 86_400_000));
      if (!body.jobs.length) break;
      const result = validatedRows(himalayasRow, body.jobs, j => normalize(j, now));
      jobs.push(...result.jobs); invalid += result.invalid;
      if (page === maxPages) truncated = true;
    }
  }
  const unique = [...new Map(jobs.map(j => [j.sourceId, j])).values()];
  const h = health('himalayas', now, unique.length, invalid, 'Country + UTC offset semantics validated; pubDate is update time, not publication.');
  if (truncated) { h.status = 'degraded'; h.detail += ` Search page budget ${maxPages}/query reached; coverage is partial.`; }
  return { jobs: unique, health: [h] };
}
export async function recheckHimalayas(http: Http, job: Job, now: Date): Promise<Job> {
  if (job.source !== 'himalayas') return job;
  const url = new URL(job.originalUrl);
  if (url.hostname !== 'himalayas.app' || !url.pathname.startsWith('/companies/')) throw new Error('Unexpected Himalayas guid path.');
  const data = z.object({ job: himalayasRow }).parse(await http.get(`https://himalayas.app/jobs/api${url.pathname}`, 300_000));
  const refreshed = normalize(data.job, now);
  refreshed.openCheckedAt = isoDate(now.toISOString());
  return refreshed;
}
