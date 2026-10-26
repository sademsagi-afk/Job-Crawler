import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Http } from './http.js';
import type { DigestContent } from './email.js';
import type { PreparedDigest } from './notifications.js';
import type { Job, SourceHealth, Status } from './types.js';

export type NotificationState = { notified: Set<string>; tracked: Set<string> };
export type Preparation = { state: 'pending'; digest: PreparedDigest } | { state: 'sent' | 'abandoned' | 'busy' | 'empty' | 'stale' | 'needs_reconciliation' };
export interface Store {
  verify(): Promise<void>;
  saveJobs(jobs: Job[]): Promise<void>;
  saveHealth(health: SourceHealth[]): Promise<void>;
  notificationState(recipient: string): Promise<NotificationState>;
  prepare(day: string, to: string, from: string, content: DigestContent): Promise<Preparation>;
  complete(id: string, leaseToken: string, providerId: string): Promise<void>;
  release(id: string, leaseToken: string): Promise<void>;
}
const pendingSchema = z.object({
  id: z.string().uuid(), created_at: z.string().datetime({ offset: true }), recipient: z.string().email(), sender: z.string().email(),
  state: z.literal('pending'), lease_token: z.string().uuid(), subject: z.string(), html: z.string(), plain_text: z.string(),
  job_ids: z.array(z.string()), content_hash: z.string(),
});
export class SupabaseStore implements Store {
  constructor(private readonly http: Http, private readonly config: { url: string; key: string }) {}
  async rpc(name: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.request(`${this.config.url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: this.config.key, authorization: `Bearer ${this.config.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
  }
  async verify(): Promise<void> {
    if (await this.rpc('jh_identity') !== 'personal-remote-job-hunter/v1') throw new Error('Dedicated job-hunter database identity missing.');
  }
  async saveJobs(jobs: Job[]): Promise<void> {
    for (let i = 0; i < jobs.length; i += 100) await this.rpc('jh_upsert_jobs', { p_jobs: jobs.slice(i, i + 100) });
  }
  async saveHealth(health: SourceHealth[]): Promise<void> { await this.rpc('jh_record_health', { p_health: health }); }
  async notificationState(recipient: string): Promise<NotificationState> {
    const body = z.object({ notified: z.array(z.string()), tracked: z.array(z.string()) }).parse(await this.rpc('jh_notification_state', { p_recipient: recipient }));
    return { notified: new Set(body.notified), tracked: new Set(body.tracked) };
  }
  async prepare(day: string, to: string, from: string, content: DigestContent): Promise<Preparation> {
    const body = await this.rpc('jh_prepare_digest', {
      p_lease_token: randomUUID(), p_day: day, p_recipient: to, p_sender: from, p_job_ids: content.jobIds,
      p_subject: content.subject, p_html: content.html, p_text: content.text, p_content_hash: content.contentHash,
    });
    const state = z.object({ state: z.enum(['pending', 'sent', 'abandoned', 'busy', 'empty', 'stale', 'needs_reconciliation']) }).parse(body).state;
    if (state !== 'pending') return { state };
    const d = pendingSchema.parse(body);
    return { state, digest: { id: d.id, createdAt: d.created_at, recipient: d.recipient, sender: d.sender, state: 'pending',
      leaseToken: d.lease_token, subject: d.subject, html: d.html, text: d.plain_text, jobIds: d.job_ids, contentHash: d.content_hash } };
  }
  async complete(id: string, leaseToken: string, providerId: string): Promise<void> {
    await this.rpc('jh_complete_digest', { p_id: id, p_lease_token: leaseToken, p_provider_id: providerId });
  }
  async release(id: string, leaseToken: string): Promise<void> {
    await this.rpc('jh_release_digest', { p_id: id, p_lease_token: leaseToken });
  }
  async track(id: string, status: Status, notes: string): Promise<void> {
    const updated = await this.rpc('jh_track', { p_id: id, p_status: status, p_notes: notes });
    if (updated !== true) throw new Error('Job not found. Use list to find the full tracking ID.');
  }
  async list(status: Status | null): Promise<unknown> { return this.rpc('jh_list_jobs', { p_status: status }); }
}
