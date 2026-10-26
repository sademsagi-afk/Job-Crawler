import type { Salary } from './types.js';

export type SalaryInput = {
  raw?: string; min?: number | null; max?: number | null; currency?: string | null;
  period?: string | null; scope?: string | null;
};
export function normalizeSalary(input: SalaryInput = {}): Salary {
  const raw = input.raw?.trim() ?? '';
  const periodText = (input.period ?? '').toLowerCase();
  const period: Salary['period'] = /^(year|yearly|annual|annually|per year)$/.test(periodText) ? 'year'
    : /^(month|monthly|per month)$/.test(periodText) ? 'month'
    : /^(week|weekly|per week)$/.test(periodText) ? 'week'
    : /^(day|daily|per day)$/.test(periodText) ? 'day'
    : /^(hour|hourly|per hour)$/.test(periodText) ? 'hour' : null;
  let detectedPeriod = period;
  const matches = [...raw.matchAll(/\b(?:per\s+)?(annually|annual|yearly|year|monthly|month|weekly|week|hourly|hour|daily|day)\b|\/(yr|mo|hr)\b/gi)];
  if (!detectedPeriod && matches.length) {
    const periods = new Set(matches.map(m => {
      const t = (m[1] ?? m[2] ?? '').toLowerCase();
      return /year|annual|yr/.test(t) ? 'year' : /month|mo/.test(t) ? 'month' : /week/.test(t) ? 'week' : /hour|hr/.test(t) ? 'hour' : 'day';
    }));
    if (periods.size === 1) detectedPeriod = [...periods][0] as Salary['period'];
  }
  const currencyCodes = [...raw.matchAll(/\b(USD|EUR|GBP|NGN|CAD|AUD)\b|US\$/gi)].map(m => (m[1] ?? 'USD').toUpperCase());
  let currency = input.currency?.toUpperCase() ?? null;
  if (!currency && new Set(currencyCodes).size === 1) currency = currencyCodes[0] ?? null;
  let min = input.min ?? null;
  let max = input.max ?? null;
  // Only parse a salary expression consisting entirely of an amount/range plus explicit units.
  // Descriptive prose, multiple bands, bonuses and "$" without a currency remain unnormalized.
  if (min === null && max === null && raw && new Set(currencyCodes).size <= 1) {
    const cleaned = raw.replace(/\/\s*(?:year|month|week|day|hour|yr|mo|hr)\b|\b(?:USD|EUR|GBP|NGN|CAD|AUD|per|annually|annual|yearly|year|monthly|month|weekly|week|hourly|hour|daily|day)\b|US\$|[,$€£]|\/(?:yr|mo|hr)\b/gi, '').trim();
    const m = cleaned.match(/^(\d+(?:\.\d+)?)(k)?\s*(?:[-–—]\s*(\d+(?:\.\d+)?)(k)?)?$/i);
    if (m) {
      min = Number(m[1]) * (m[2] ? 1000 : 1);
      max = m[3] ? Number(m[3]) * (m[4] ? 1000 : 1) : min;
    }
  }
  const validAmount = (v: number | null) => v === null || (Number.isFinite(v) && v > 0);
  const valid = validAmount(min) && validAmount(max) && (min === null || max === null || min <= max);
  const ambiguous = (currencyCodes.length > 0 && currency !== null && currencyCodes.some(c => c !== currency)) || new Set(currencyCodes).size > 1 || /(?:OTE|on.target|including|bonus|equity|depending on location)/i.test(raw);
  const factor = detectedPeriod === 'year' ? 1 / 12 : detectedPeriod === 'month' ? 1 : null;
  const monthlyUsd = valid && !ambiguous && currency === 'USD' && factor !== null && (min !== null || max !== null)
    ? { min: min === null ? null : Math.round(min * factor * 100) / 100, max: max === null ? null : Math.round(max * factor * 100) / 100 } : null;
  return {
    raw, currency, period: detectedPeriod, min, max, monthlyUsd, scope: input.scope ?? null,
    evidence: monthlyUsd ? 'Explicit USD base pay and pay period; annual amounts divided by 12. No FX or work-hour assumptions.'
      : !raw && min === null && max === null ? 'No compensation disclosed.'
      : 'Compensation disclosed but not reliably comparable to monthly USD; confirm currency, period, scope and base pay.',
  };
}

/** Preserve explicit pay statements in descriptions without treating examples/benefits as base salary. */
export function salaryFromDescription(description: string): SalaryInput {
  const pattern = /(?:\b(?:USD|EUR|GBP|NGN|CAD|AUD)\s*\$?|US\$|[$€£])\s*\d[\d,.]*k?(?:\s*(?:[-–—]|\bto\b)\s*(?:(?:USD|EUR|GBP|NGN|CAD|AUD|US\$|[$€£])\s*)?\d[\d,.]*k?)?\s*(?:(?:per\s+)?(?:annually|annual|yearly|year|monthly|month|weekly|week|hourly|hour|daily|day)|\/(?:year|month|hour|yr|mo|hr))?/gi;
  const matches = [...description.matchAll(pattern)].filter(m => /\b(?:salary|compensation|base pay|pay range|paid|we offer)\b/i.test(description.slice(Math.max(0, (m.index ?? 0) - 150), (m.index ?? 0) + m[0].length + 80)));
  if (!matches.length) return {};
  const snippets = matches.map(m => description.slice(Math.max(0, (m.index ?? 0) - 100), Math.min(description.length, (m.index ?? 0) + m[0].length + 120)));
  if (matches.length !== 1) return { raw: snippets.join(' | ').slice(0, 2000), scope: 'multiple compensation amounts/bands; applicability needs confirmation' };
  const context = snippets[0] ?? '';
  if (/\b(?:up to|from|starting at|OTE|on.target|total compensation|including bonus|equity)\b/i.test(context)) return { raw: context, scope: 'base pay floor/range not isolated from the compensation statement' };
  const scope = /\b(?:US|U\.S\.|United States|UK|United Kingdom|Canada|Europe|geographic|location.based|depending on location)\b/i.test(context)
    ? 'location-specific or potentially scoped salary statement; confirm Nigeria applicability' : null;
  return { raw: matches[0]![0].trim(), scope };
}
