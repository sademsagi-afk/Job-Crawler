import { makeJob, type JobInput } from '../src/collectors/common.js';
import { normalizeSalary } from '../src/salary.js';
import type { Job } from '../src/types.js';
export const now = new Date('2026-10-26T07:15:00Z');
export function job(overrides: Partial<Job> = {}): Job {
  return {
    ...makeJob({ source: 'lever', sourceId: 'one', company: 'Example', title: 'Backend Engineer',
      description: 'TypeScript Node.js PostgreSQL React REST authentication payments marketplace. 4 years of experience.',
      location: 'Remote - Nigeria', remote: true, url: 'https://jobs.lever.co/example/one', publishedAt: '2026-10-25T12:00:00Z' } satisfies JobInput, now),
    salary: normalizeSalary({ currency: 'USD', period: 'month', min: 4000, max: 6000, raw: 'USD 4000–6000 per month' }),
    ...overrides,
  };
}
