import { createHash } from 'node:crypto';
import type { RankedJob, SourceHealth } from './types.js';

export type DigestContent = { subject: string; html: string; text: string; jobIds: string[]; contentHash: string };
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function lagosDay(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function renderDigest(matches: RankedJob[], health: SourceHealth[], now: Date, preview = false): DigestContent {
  const subject = `${preview ? '[PREVIEW] ' : ''}Remote engineering shortlist — ${lagosDay(now)} (${matches.length} new)`;
  const sections: [RankedJob['section'], string][] = [
    ['disclosed', 'Disclosed USD pay: minimum verified'], ['undisclosed', 'Compensation not disclosed'], ['salary-review', 'Disclosed compensation needs confirmation'],
  ];
  const lines = [subject, 'Personal discovery only. Review employer legitimacy, eligibility and compensation before applying. No applications are submitted.', ''];
  let html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Remote engineering shortlist</title></head><body style="font-family:Arial,sans-serif;line-height:1.6;max-width:760px;margin:auto;padding:24px;color:#152638">';
  html += `<h1>${escapeHtml(subject)}</h1><p>Evidence-based matches for a Nigeria-based backend/product engineer. Review employer eligibility and compensation before applying. No applications are submitted.</p>`;
  if (matches.length < 5) {
    const message = `Only ${matches.length} new qualifying matches were found. The list is not padded with unsuitable jobs.`;
    html += `<p>${message}</p>`; lines.push(message);
  }
  for (const [section, heading] of sections) {
    const group = matches.filter(m => m.section === section);
    if (!group.length) continue;
    html += `<h2>${heading}</h2>`; lines.push(`\n${heading}`);
    for (const { job, score, reasons } of group) {
      const pay = job.salary.monthlyUsd;
      const salary = pay ? `USD ${pay.min ?? '?'}–${pay.max ?? '?'}/month${job.salary.scope ? `; scope: ${job.salary.scope}` : ''}; disclosed: ${job.salary.raw}`
        : job.salary.raw ? `Disclosed (not normalized): ${job.salary.raw}` : 'Not disclosed; minimum pay not verified';
      html += `<article style="border-top:1px solid #ccc;margin-top:20px"><h3>${escapeHtml(job.title)} — ${escapeHtml(job.company)} (${score}/100)</h3>`;
      html += `<p><strong>Pay:</strong> ${escapeHtml(salary)}<br><strong>Location:</strong> ${escapeHtml(job.location)}<br><strong>Employment:</strong> ${escapeHtml(job.employmentType ?? 'not disclosed')}<br><strong>Published:</strong> ${escapeHtml(job.publishedAt ?? 'unknown')}<br><strong>Collected (may be cached):</strong> ${escapeHtml(job.collectedAt)}${job.sourceUpdatedAt ? `<br><strong>Source updated:</strong> ${escapeHtml(job.sourceUpdatedAt)}` : ''}${job.openCheckedAt ? `<br><strong>Open status rechecked:</strong> ${escapeHtml(job.openCheckedAt)}` : ''}</p>`;
      html += `<p>${job.eligibility.evidence.map(escapeHtml).join(' ')}</p><ul>${reasons.map(r => `<li><strong>${r.kind}:</strong> ${escapeHtml(r.detail)}</li>`).join('')}</ul>`;
      html += `<p><a href="${escapeHtml(job.applicationUrl)}" rel="noopener noreferrer">${job.source === 'remotive' ? 'View on Remotive and apply' : 'View role / application'}</a></p>`;
      html += `<p>Sources: ${job.attributions.map(a => `<a href="${escapeHtml(a.url)}">${escapeHtml(a.source)}</a>`).join(' · ')}</p>`;
      for (const a of job.attributions.filter(a => a.source === 'himalayas')) html += `<p><a href="${escapeHtml(a.applyUrl)}">Apply via Himalayas</a> · <a href="${escapeHtml(a.url)}">Source: Himalayas</a></p>`;
      if (job.attributions.some(a => a.source === 'remotive')) html += '<p>Remotive listings are delayed by 24 hours. Source: Remotive.</p>';
      html += `<p style="font-size:12px">Tracking ID: ${job.id}</p></article>`;
      lines.push(`\n${job.title} — ${job.company} (${score}/100)`, salary, job.location, ...job.eligibility.evidence, ...reasons.map(r => `${r.kind}: ${r.detail}`), job.applicationUrl, `Sources: ${job.attributions.map(a => `${a.source}: ${a.url}`).join('; ')}`, `Tracking ID: ${job.id}`, ...job.attributions.filter(a => a.source === 'himalayas').map(a => `Apply via Himalayas (original supplied link): ${a.applyUrl}`));
    }
  }
  const sourceSummary = health.map(h => `${h.source}: ${h.status}; ${h.count} jobs; ${h.detail}`);
  html += `<h2>Source health / coverage</h2><ul>${sourceSummary.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul><p>“Verified” means supported by the posting/API, not independent verification of the employer, offer, or application-page availability. Listings can close after collection.</p></body></html>`;
  lines.push('\nSource health / coverage', ...sourceSummary, '\nVerified means supported by source evidence, not independent verification of an employer or offer.');
  const text = lines.join('\n');
  const contentHash = createHash('sha256').update(JSON.stringify({ subject, html, text })).digest('hex');
  return { subject, html, text, contentHash, jobIds: matches.map(m => m.job.id) };
}
