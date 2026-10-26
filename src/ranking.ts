import type { Evidence, Job, RankedJob } from './types.js';

export type Profile = { experienceYears: number; minimumMonthlyUsd: number; preferredMonthlyUsd: number; priorityMonthlyUsd: number; maxAgeDays: number; minScore: number };
export const defaultProfile: Profile = { experienceYears: 4, minimumMonthlyUsd: 2000, preferredMonthlyUsd: 2500, priorityMonthlyUsd: 4000, maxAgeDays: 45, minScore: 45 };
export function rankJob(job: Job, now: Date, profile: Profile = defaultProfile): { ranked: RankedJob | null; rejection: string | null } {
  const reject = (rejection: string) => ({ ranked: null, rejection });
  if (job.eligibility.status !== 'eligible') return reject(`Eligibility ${job.eligibility.status}: ${job.eligibility.evidence[0]}`);
  if (job.remote !== true) return reject('Fully remote work not confirmed.');
  if (job.expiresAt && new Date(job.expiresAt) <= now) return reject('Posting expired.');
  const age = job.publishedAt ? (now.getTime() - Date.parse(job.publishedAt)) / 86_400_000 : null;
  if (age !== null && age > profile.maxAgeDays) return reject(`Posting is older than ${profile.maxAgeDays} days.`);
  if (age !== null && age < -1) return reject('Publication date is in the future.');
  if (/intern|volunteer|unpaid|apprentice/i.test(job.employmentType ?? '') || /\b(?:unpaid (?:role|position)|this (?:role|position) is unpaid|commission[- ]only)\b/i.test(job.description)) return reject('Employment/compensation type is obviously unsuitable.');
  const title = job.title.toLowerCase();
  const relevant = /\b(?:back[ -]?end|full[ -]?stack|node\.?js|typescript|product engineer|platform|software engineer|software developer)\b/.test(title);
  if (!relevant || /\b(?:intern|internship|graduate|junior|staff|principal|director|head of|manager|sales|data scientist|machine learning|embedded|android|ios|frontend|front-end)\b/.test(title)) return reject('Title is outside the target engineering roles/seniority.');
  const otherStack = title.match(/\b(?:elixir|erlang|ruby|rails|php|python|java(?!script)|golang|rust)\b|c\+\+|c#|\.net/);
  const nativeTitle = /\b(?:node(?:\.js|js)?|typescript|javascript)\b/.test(title);
  if (otherStack && !nativeTitle) return reject(`Title targets ${otherStack[0]}, outside the supplied backend stack.`);
  const text = `${job.title} ${job.description}`.toLowerCase();
  const experience = [...text.matchAll(/\b(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\+?\s+years?(?:\s+of)?\s+(?:(?:professional|relevant|commercial|software|engineering|development)\s+){0,3}experience\b/g)].map(m => Number(m[1]));
  const years = experience.length ? Math.max(...experience) : null;
  if (years !== null && years > profile.experienceYears + 2) return reject(`Posting asks for ${years}+ years of experience.`);
  let score = 10;
  const reasons: Evidence[] = [{ kind: 'verified', detail: job.eligibility.evidence[0] ?? 'Explicit location eligibility.' }];
  score += /\bnigeria\b/i.test(job.location.split(';')[0] ?? job.location) ? 18 : 15;
  if (otherStack) { score -= 8; reasons.push({ kind: 'unknown', detail: `Title also requires ${otherStack[0]}, not listed in your profile; review mandatory requirements.` }); }
  if (/\b(?:lead|founding)\b/.test(title)) { score -= 5; reasons.push({ kind: 'inference', detail: 'Lead/founding scope may stretch a 4+ year profile; review ownership and management expectations.' }); }
  const skills: [RegExp, string, number][] = [
    [/\btypescript\b/, 'TypeScript', 9], [/\bnode(?:\.js|js)?\b/, 'Node.js', 9],
    [/\b(?:postgresql|postgres|supabase)\b/, 'PostgreSQL/Supabase', 6],
    [/\b(?:react|next\.js|nextjs)\b/, 'React/Next.js', 4],
    [/\b(?:rest(?:ful)?|authentication|payments?|marketplace)\b/, 'API/auth/payment/marketplace experience', 5],
    [/\bjavascript\b/, 'JavaScript', 3],
  ];
  const matched: string[] = [];
  for (const [pattern, label, points] of skills) if (pattern.test(text)) { score += points; matched.push(label); }
  if (!matched.length) return reject('No relevant stack evidence.');
  reasons.push({ kind: 'verified', detail: `Posting mentions ${matched.join(', ')}.` });
  reasons.push({ kind: 'inference', detail: 'Mentioned skills suggest overlap with your backend/product and marketplace experience; proficiency fit needs review.' });
  if (years !== null) {
    score += years <= profile.experienceYears ? 7 : -8;
    reasons.push({ kind: 'verified', detail: `Posting mentions ${years}+ years of experience; profile baseline is ${profile.experienceYears}+.` });
  } else reasons.push({ kind: 'unknown', detail: 'Experience requirement not reliably extracted.' });
  if (/\bsenior\b/.test(title)) { score -= 3; reasons.push({ kind: 'inference', detail: 'Senior title may stretch a 4+ year profile; check scope.' }); }
  const pay = job.salary.monthlyUsd;
  let section: RankedJob['section'] = !job.salary.raw && job.salary.min === null && job.salary.max === null ? 'undisclosed' : 'salary-review';
  if (pay) {
    if (!job.salary.scope && pay.max !== null && pay.max < profile.minimumMonthlyUsd) return reject('Disclosed pay ceiling is below the minimum.');
    if (job.salary.scope) {
      reasons.push({ kind: 'unknown', detail: `Pay applies to ${job.salary.scope}; confirm the Nigeria band.` });
    } else if (pay.min !== null && pay.min >= profile.minimumMonthlyUsd) {
      section = 'disclosed';
      score += pay.min >= profile.priorityMonthlyUsd ? 20 : pay.min >= profile.preferredMonthlyUsd ? 15 : 10;
      reasons.push({ kind: 'verified', detail: `Disclosed base pay floor is USD ${pay.min}/month. ${job.salary.evidence}` });
    } else reasons.push({ kind: 'unknown', detail: 'Pay range overlaps the minimum or only a ceiling is disclosed; minimum is not verified.' });
  } else reasons.push({ kind: 'unknown', detail: job.salary.evidence });
  if (age !== null) {
    score += age <= 3 ? 8 : age <= 7 ? 5 : age <= 14 ? 2 : 0;
    reasons.push({ kind: 'verified', detail: `Published about ${Math.max(0, Math.floor(age))} days ago.` });
  } else reasons.push({ kind: 'unknown', detail: 'Publication date/timezone not disclosed; collection time is not publication time.' });
  score = Math.max(0, Math.min(100, score));
  if (score < profile.minScore) return reject(`Score ${score} is below ${profile.minScore}.`);
  return { ranked: { job, score, reasons, section }, rejection: null };
}
