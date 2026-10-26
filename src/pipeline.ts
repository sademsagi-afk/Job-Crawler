import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deduplicate } from './dedup.js';
import { lagosDay, renderDigest } from './email.js';
import { rankJob } from './ranking.js';
import { sendDigest, type MailConfig } from './notifications.js';
import type { Http } from './http.js';
import type { Store } from './persistence.js';
import type { Collection, Job, RankedJob } from './types.js';

export type PipelineOptions = {
  collection: Collection; now: Date; limit: number; artifactDir: string;
  store?: Store; mail?: MailConfig; http: Http; dryRun: boolean; recheck?: (job: Job) => Promise<Job>;
};
export async function runPipeline(options: PipelineOptions) {
  const { now, collection, store, mail, http, dryRun } = options;
  if (!dryRun && (!store || !mail)) throw new Error('Sending requires persistence and email credentials.');
  const jobs = deduplicate(collection.jobs);
  const rejected: { id: string; reason: string }[] = [];
  const candidates: RankedJob[] = [];
  for (const job of jobs) {
    const result = rankJob(job, now);
    if (result.ranked) candidates.push(result.ranked);
    else rejected.push({ id: job.id, reason: result.rejection ?? 'Rejected' });
  }
  // Prefer verified minimum compensation, then rank; unknown salary does not displace known strong matches.
  const sectionOrder = { disclosed: 0, undisclosed: 1, 'salary-review': 2 };
  candidates.sort((a, b) => sectionOrder[a.section] - sectionOrder[b.section] || b.score - a.score || a.job.id.localeCompare(b.job.id));
  let selected = candidates;
  if (!dryRun && store && mail) {
    await store.verify();
    await store.saveJobs(jobs);
    const state = await store.notificationState(mail.to);
    selected = selected.filter(m => !state.notified.has(m.job.id) && !state.tracked.has(m.job.id));
  }
  selected = selected.slice(0, options.limit);
  if (options.recheck) {
    const refreshed: RankedJob[] = []; let checked = 0; let failed = 0;
    for (const candidate of selected) {
      try {
        const updated = await options.recheck(candidate.job);
        if (candidate.job.source === 'himalayas') checked++;
        const result = rankJob(updated, now);
        if (result.ranked) refreshed.push(result.ranked);
        else rejected.push({ id: candidate.job.id, reason: `Fresh API check: ${result.rejection}` });
      } catch {
        failed++;
        rejected.push({ id: candidate.job.id, reason: 'Shortlist freshness check failed/closed; excluded.' });
      }
    }
    selected = refreshed.sort((a, b) => sectionOrder[a.section] - sectionOrder[b.section] || b.score - a.score || a.job.id.localeCompare(b.job.id));
    if (checked || failed) collection.health.push({ source: 'himalayas:shortlist-check', status: failed ? 'degraded' : 'ok', count: checked, invalid: failed, checkedAt: now.toISOString(), detail: `${checked} open listings rechecked; ${failed} failed/closed checks excluded.` });
    if (!dryRun && store && mail) {
      await store.saveJobs(selected.map(m => m.job));
      const state = await store.notificationState(mail.to);
      selected = selected.filter(m => !state.notified.has(m.job.id) && !state.tracked.has(m.job.id));
    }
  }
  if (!dryRun && store) await store.saveHealth(collection.health);
  const content = renderDigest(selected, collection.health, now, dryRun);
  await mkdir(options.artifactDir, { recursive: true });
  await Promise.all([
    writeFile(join(options.artifactDir, 'digest.html'), content.html),
    writeFile(join(options.artifactDir, 'digest.txt'), content.text),
    writeFile(join(options.artifactDir, 'report.json'), JSON.stringify({ generatedAt: now.toISOString(), dryRun, rawJobs: collection.jobs.length, uniqueJobs: jobs.length, candidates: candidates.length, selected, rejected, health: collection.health }, null, 2)),
  ]);
  const healthy = collection.health.some(h => h.status === 'ok' || h.status === 'degraded');
  if (!healthy) throw new Error('No source succeeded. See artifacts/report.json; no email sent.');
  if (dryRun) return { selected: selected.length, delivery: 'preview-only' as const };
  if (!store || !mail) throw new Error('Missing production dependencies.');
  const reservation = await store.prepare(lagosDay(now), mail.to, mail.from, content);
  if (reservation.state === 'sent' || reservation.state === 'empty' || reservation.state === 'abandoned') return { selected: selected.length, delivery: reservation.state };
  if (reservation.state !== 'pending') throw new Error(`Digest reservation: ${reservation.state}. See operations recovery documentation.`);
  const d = reservation.digest;
  if (!d.leaseToken) throw new Error('Digest not leased.');
  try {
    const id = await sendDigest(http, d, mail);
    await store.complete(d.id, d.leaseToken, id);
  } catch (error) {
    // Preserve the immutable pending payload, allowing an identical idempotent retry within 23h.
    try { await store.release(d.id, d.leaseToken); } catch { /* Lease expires automatically in 5min. */ }
    throw error;
  }
  return { selected: d.jobIds.length, delivery: 'accepted-by-resend' as const };
}
