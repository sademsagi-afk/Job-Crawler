import { z } from 'zod';
import type { Http } from '../http.js';
import { health, makeJob, nonempty, optionalText, rows, validatedRows } from './common.js';

export const remotiveRow = z.object({
  id: z.union([z.number().int(), nonempty]), url: nonempty, title: nonempty, company_name: nonempty,
  description: z.string(), candidate_required_location: optionalText, salary: optionalText,
  job_type: optionalText, publication_date: optionalText,
});
export async function collectRemotive(http: Http, now: Date) {
  // One request per run, cached 24h; never issue a query for each keyword.
  const body = z.object({ jobs: rows }).parse(await http.get('https://remotive.com/api/remote-jobs?category=software-dev', 86_400_000, 31_000));
  const result = validatedRows(remotiveRow, body.jobs, j => makeJob({
    source: 'remotive', sourceId: String(j.id), company: j.company_name, title: j.title,
    description: j.description, location: j.candidate_required_location ?? '', remote: true,
    salary: { raw: j.salary ?? '' }, employmentType: j.job_type ?? null,
    url: j.url, publishedAt: j.publication_date,
  }, now));
  return { jobs: result.jobs, health: [health('remotive', now, result.jobs.length, result.invalid, 'Remotive links and attribution retained; feed is delayed 24h. Salary units are never inferred from provider conventions.')] };
}
