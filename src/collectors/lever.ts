import { z } from 'zod';
import type { Http } from '../http.js';
import { health, makeJob, nonempty, optionalText, positive, rows, validatedRows } from './common.js';

export const leverRow = z.object({
  id: nonempty, text: nonempty, hostedUrl: nonempty, applyUrl: nonempty,
  categories: z.object({ location: z.string(), commitment: optionalText, allLocations: z.array(z.string()).optional() }),
  descriptionPlain: z.string(), additionalPlain: optionalText,
  lists: z.array(z.object({ text: z.string(), content: z.string() })).default([]),
  workplaceType: z.enum(['unspecified', 'on-site', 'onsite', 'remote', 'hybrid']).optional(),
  salaryRange: z.object({ currency: nonempty, interval: nonempty, min: positive, max: positive }).nullish(),
  salaryDescriptionPlain: optionalText,
});
export async function collectLever(http: Http, now: Date, board: { token: string; company: string; region?: 'global' | 'eu' }, maxPages: number) {
  const jobs = []; let invalid = 0; let truncated = false;
  for (let page = 0; page < maxPages; page++) {
    const host = board.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co';
    const body = rows.parse(await http.get(`https://${host}/v0/postings/${encodeURIComponent(board.token)}?mode=json&skip=${page * 100}&limit=100`, 21_600_000));
    const result = validatedRows(leverRow, body, j => makeJob({
      source: 'lever', sourceId: `${board.token}:${j.id}`, title: j.text, company: board.company,
      description: [j.descriptionPlain, ...j.lists.map(l => `${l.text}: ${l.content}`), j.additionalPlain].filter(Boolean).join('\n'),
      location: j.categories.allLocations?.join('; ') || j.categories.location,
      remote: j.workplaceType === 'remote' ? true : j.workplaceType === 'hybrid' || j.workplaceType === 'on-site' || j.workplaceType === 'onsite' ? false : null,
      salary: { raw: j.salaryDescriptionPlain || (j.salaryRange ? `${j.salaryRange.currency} ${j.salaryRange.min ?? '?'}–${j.salaryRange.max ?? '?'} ${j.salaryRange.interval}` : ''),
        currency: j.salaryRange?.currency ?? null, period: j.salaryRange?.interval ?? null,
        min: j.salaryRange?.min ?? null, max: j.salaryRange?.max ?? null,
        scope: j.salaryDescriptionPlain && /\b(?:US|United States|Canada|UK|location|geograph)/i.test(j.salaryDescriptionPlain) ? 'location-specific salary disclosure' : null },
      url: j.hostedUrl, applyUrl: j.applyUrl, employmentType: j.categories.commitment ?? null,
      // Lever's documented public response does not supply a publication date.
    }, now));
    jobs.push(...result.jobs); invalid += result.invalid;
    if (body.length < 100) break;
    if (page === maxPages - 1) truncated = true;
  }
  const h = health(`lever:${board.token}`, now, jobs.length, invalid);
  if (truncated) { h.status = 'degraded'; h.detail = 'Page budget reached; coverage is partial.'; }
  return { jobs, health: [h] };
}
