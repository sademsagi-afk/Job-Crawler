import { z } from 'zod';
import type { Http } from './http.js';
import type { DigestContent } from './email.js';

export type PreparedDigest = DigestContent & { id: string; createdAt: string; recipient: string; sender: string; state: 'pending' | 'sent'; leaseToken: string | null };
export type MailConfig = { key: string; from: string; to: string };
export async function sendDigest(http: Http, digest: PreparedDigest, config: MailConfig): Promise<string> {
  if (digest.state === 'sent') throw new Error('Digest already sent.');
  if (digest.recipient !== config.to || digest.sender !== config.from) throw new Error('Pending digest address differs from configuration; recover manually.');
  if (Date.now() - Date.parse(digest.createdAt) >= 23 * 3_600_000) throw new Error('Pending digest exceeds safe Resend idempotency window; manual reconciliation required.');
  const body = await http.request('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${config.key}`, 'content-type': 'application/json', 'idempotency-key': `job-hunter/${digest.id}` },
    // Persist the entire payload before sending. Every retry must send exactly these bytes/fields.
    body: JSON.stringify({ from: digest.sender, to: [digest.recipient], subject: digest.subject, html: digest.html, text: digest.text }),
  });
  return z.object({ id: z.string().min(1) }).parse(body).id;
}
