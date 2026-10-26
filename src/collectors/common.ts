import { z } from 'zod';
import { assessEligibility } from '../eligibility.js';
import { jobId } from '../dedup.js';
import { normalizeSalary, salaryFromDescription, type SalaryInput } from '../salary.js';
import { isoDate, plainText, safeUrl, type Job, type Source, type SourceHealth } from '../types.js';

export type JobInput = {
  source: Source; sourceId: string; company: string; title: string; description: string;
  location: string; countries?: string[]; timezoneRestrictions?: number[]; remote: boolean | null; salary?: SalaryInput;
  employmentType?: string | null; url: string; applyUrl?: string;
  sourceUpdatedAt?: string | number | null; publishedAt?: string | number | null | undefined; expiresAt?: string | number | null | undefined;
};
export function makeJob(input: JobInput, now: Date): Job {
  const description = plainText(input.description).slice(0, 100_000);
  const originalUrl = safeUrl(input.url);
  const applicationUrl = safeUrl(input.applyUrl ?? input.url);
  const countries = input.countries ?? [];
  const descriptionPay = salaryFromDescription(description);
  const suppliedPay = input.salary && (input.salary.raw || input.salary.min != null || input.salary.max != null) ? input.salary : descriptionPay;
  const salaryInput: SalaryInput = suppliedPay.scope || !descriptionPay.scope ? suppliedPay : { ...suppliedPay, scope: descriptionPay.scope };
  return {
    id: jobId(applicationUrl), source: input.source, sourceId: input.sourceId,
    company: plainText(input.company).trim(), title: plainText(input.title).trim(), description,
    location: input.location, countries, timezoneRestrictions: input.timezoneRestrictions ?? null, remote: input.remote,
    salary: normalizeSalary(salaryInput),
    eligibility: assessEligibility({ location: input.location, countries, remote: input.remote, description }),
    employmentType: input.employmentType ?? null, originalUrl, applicationUrl,
    sourceUpdatedAt: isoDate(input.sourceUpdatedAt), openCheckedAt: null, publishedAt: isoDate(input.publishedAt), expiresAt: isoDate(input.expiresAt), collectedAt: now.toISOString(),
    attributions: [{ source: input.source, sourceId: input.sourceId, url: originalUrl, applyUrl: applicationUrl }],
  };
}
export function validatedRows<S extends z.ZodTypeAny>(schema: S, rows: unknown[], map: (row: z.output<S>) => Job | null): { jobs: Job[]; invalid: number } {
  const jobs: Job[] = [];
  let invalid = 0;
  for (const row of rows) {
    const result = schema.safeParse(row);
    if (!result.success) { invalid++; continue; }
    try { const job = map(result.data); if (job) jobs.push(job); } catch { invalid++; }
  }
  if (rows.length && invalid === rows.length) throw new Error('All rows failed payload validation; source schema may have changed.');
  return { jobs, invalid };
}
export function health(source: string, now: Date, count: number, invalid: number, detail = ''): SourceHealth {
  return { source, checkedAt: now.toISOString(), count, invalid, status: invalid ? 'degraded' : 'ok', detail: detail || (invalid ? `${invalid} invalid rows discarded.` : 'Public API response validated.') };
}
export const text = z.string();
export const nonempty = z.string().min(1);
export const optionalText = z.string().nullish();
export const positive = z.number().finite().nonnegative().nullish();
export const rows = z.array(z.unknown());
export const remoteFrom = (location: string, description = ''): boolean | null =>
  /\b(?:hybrid|on[ -]?site)\b/i.test(location) ? false
    : /\bremote\b/i.test(location) || /\b(?:fully remote|100% remote|work from anywhere|remote.first)\b/i.test(plainText(description)) ? true : null;
