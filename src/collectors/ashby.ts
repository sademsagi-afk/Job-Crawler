import { z } from 'zod';
import type { Http } from '../http.js';
import type { SalaryInput } from '../salary.js';
import { health, makeJob, nonempty, optionalText, positive, rows, remoteFrom, validatedRows } from './common.js';

const component = z.object({ compensationType: z.string(), interval: z.string(), currencyCode: optionalText, minValue: positive, maxValue: positive, summary: optionalText });
const compensation = z.object({
  compensationTierSummary: optionalText,
  compensationTiers: z.array(z.object({ title: optionalText, tierSummary: optionalText, components: z.array(component) })).default([]),
  summaryComponents: z.array(component).default([]),
}).nullish();
export function ashbySalary(c: z.output<typeof compensation>): SalaryInput {
  if (!c) return {};
  const tiers = c.compensationTiers;
  const salary = tiers.length === 1 ? tiers[0]?.components.filter(c => c.compensationType === 'Salary') : [];
  if (salary?.length === 1) {
    const base = salary[0]!;
    const title = tiers[0]?.title ?? '';
    const period = ({ '1 YEAR': 'year', '1 MONTH': 'month', '1 WEEK': 'week', '1 DAY': 'day', '1 HOUR': 'hour' } as Record<string, string>)[base.interval] ?? null;
    return { raw: `${base.summary ?? `${base.minValue ?? '?'}–${base.maxValue ?? '?'}`} (${base.currencyCode ?? 'currency unknown'}; ${base.interval})`,
      currency: base.currencyCode ?? null, period, min: base.minValue ?? null, max: base.maxValue ?? null,
      scope: /^(?:global|worldwide|nigeria|all locations)$/i.test(title) ? null : `compensation tier '${title || 'unnamed'}'; Nigeria applicability not established` };
  }
  const raw = c.compensationTierSummary || tiers.map(t => t.tierSummary).filter(Boolean).join('; ');
  return { raw, scope: raw ? 'published compensation tier(s); Nigeria applicability unverified' : null };
}
export const ashbyRow = z.object({
  id: nonempty.optional(), title: nonempty, location: z.string(), isRemote: z.boolean().nullable(),
  workplaceType: z.enum(['Remote', 'Hybrid', 'OnSite']).nullish(),
  descriptionPlain: z.string(), jobUrl: nonempty, applyUrl: nonempty, publishedAt: optionalText,
  employmentType: optionalText, isListed: z.boolean().optional(), compensation,
});
export async function collectAshby(http: Http, now: Date, board: { token: string; company: string }) {
  const body = z.object({ jobs: rows }).parse(await http.get(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.token)}?includeCompensation=true`, 21_600_000));
  const result = validatedRows(ashbyRow, body.jobs, j => j.isListed === false ? null : makeJob({
    source: 'ashby', sourceId: `${board.token}:${j.id ?? new URL(j.jobUrl).pathname.split('/').filter(Boolean).at(-1)}`, title: j.title, company: board.company,
    description: j.descriptionPlain, location: j.location,
    // Current docs: isRemote=true ALSO includes Hybrid. It cannot establish fully remote work.
    remote: j.workplaceType === 'Remote' ? true : j.workplaceType === 'Hybrid' || j.workplaceType === 'OnSite' || j.isRemote === false ? false : remoteFrom(j.location, j.descriptionPlain),
    url: j.jobUrl, applyUrl: j.applyUrl, publishedAt: j.publishedAt, employmentType: j.employmentType ?? null,
    salary: ashbySalary(j.compensation),
  }, now));
  return { jobs: result.jobs, health: [health(`ashby:${board.token}`, now, result.jobs.length, result.invalid)] };
}
