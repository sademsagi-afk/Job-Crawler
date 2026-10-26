import { z } from 'zod';

export const Source = z.enum(['himalayas', 'remotive', 'greenhouse', 'ashby', 'lever']);
export type Source = z.infer<typeof Source>;
export const Status = z.enum(['New', 'Interested', 'Applied', 'Interviewing', 'Rejected', 'Offer']);
export type Status = z.infer<typeof Status>;
export type Evidence = { kind: 'verified' | 'inference' | 'unknown'; detail: string };
export type Salary = {
  raw: string; currency: string | null; period: 'year' | 'month' | 'week' | 'day' | 'hour' | null;
  min: number | null; max: number | null;
  monthlyUsd: { min: number | null; max: number | null } | null;
  evidence: string; scope: string | null;
};
export type Eligibility = { status: 'eligible' | 'ineligible' | 'unknown'; evidence: string[] };
export type Attribution = { source: Source; sourceId: string; url: string; applyUrl: string };
export type Job = {
  id: string; source: Source; sourceId: string; company: string; title: string; description: string;
  salary: Salary; location: string; countries: string[]; timezoneRestrictions: number[] | null; remote: boolean | null;
  eligibility: Eligibility; employmentType: string | null; originalUrl: string; applicationUrl: string;
  publishedAt: string | null; sourceUpdatedAt: string | null; openCheckedAt: string | null; collectedAt: string; expiresAt: string | null;
  attributions: Attribution[];
};
export type RankedJob = { job: Job; score: number; reasons: Evidence[]; section: 'disclosed' | 'undisclosed' | 'salary-review' };
export type SourceHealth = {
  source: string; status: 'ok' | 'degraded' | 'failed' | 'skipped'; count: number;
  invalid: number; checkedAt: string; detail: string;
};
export type Collection = { jobs: Job[]; health: SourceHealth[] };
export type Clock = () => Date;
export const safeUrl = (input: string): string => {
  const u = new URL(input);
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Expected credential-free HTTPS URL');
  return u.href;
};
export const isoDate = (value: string | number | null | undefined): string | null => {
  if (value === undefined || value === null || value === '') return null;
  // Never invent a timezone for provider strings without one; date-only dates are explicit calendar dates.
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(value) && !/(Z|[+-]\d\d:\d\d)$/i.test(value)) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
export function plainText(html: string): string {
  let decoded = html;
  for (let i = 0; i < 2; i++) decoded = decoded
    .replace(/&amp;/gi, '&').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (original: string, token: string) => {
      const n = Number.parseInt(token.startsWith('x') || token.startsWith('X') ? token.slice(1) : token, /^[xX]/.test(token) ? 16 : 10);
      return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : original;
    });
  return decoded.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
