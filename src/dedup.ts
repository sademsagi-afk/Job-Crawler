import { createHash } from 'node:crypto';
import type { Job } from './types.js';

export function canonicalUrl(value: string): string {
  const u = new URL(value);
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (/^(?:utm_.*|source|ref|gh_src|lever-source)$/i.test(key)) u.searchParams.delete(key);
  if (/(?:^|\.)lever\.co$/.test(u.hostname)) u.pathname = u.pathname.replace(/\/apply\/?$/, '');
  if (u.hostname === 'jobs.ashbyhq.com') u.pathname = u.pathname.replace(/\/application\/?$/, '');
  u.pathname = u.pathname.replace(/\/$/, '');
  u.searchParams.sort();
  return u.href;
}
export const jobId = (url: string): string => createHash('sha256').update(canonicalUrl(url)).digest('hex');
export function deduplicate(jobs: Job[]): Job[] {
  const byId = new Map<string, Job>();
  // Prefer employer ATS evidence to aggregator data when a canonical application URL matches.
  const priority = { ashby: 0, greenhouse: 1, lever: 2, himalayas: 3, remotive: 4 };
  for (const job of [...jobs].sort((a, b) => priority[a.source] - priority[b.source] || a.sourceId.localeCompare(b.sourceId))) {
    const id = jobId(job.applicationUrl);
    const existing = byId.get(id);
    if (existing) {
      for (const a of job.attributions) if (!existing.attributions.some(b => b.source === a.source && b.sourceId === a.sourceId)) existing.attributions.push(a);
    } else byId.set(id, { ...job, id, attributions: [...job.attributions] });
  }
  return [...byId.values()];
}
