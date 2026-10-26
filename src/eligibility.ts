import type { Eligibility } from './types.js';

export function assessEligibility(input: { location: string; countries: string[]; description: string; remote: boolean | null }): Eligibility {
  const { countries, description, remote } = input;
  const location = input.location.toLowerCase();
  const evidence: string[] = [];
  if (remote === false || /\b(?:on[ -]?site|hybrid)\b/i.test(input.location)) {
    return { status: 'ineligible', evidence: ['Posting requires on-site or hybrid work.'] };
  }
  // Evaluate restrictive sentences before global claims. Business-hour overlap alone is not a residence restriction.
  const sentences = description.replace(/\bU\.S\.(?:A\.)?/gi, 'United States').split(/[.!?;\n]/).map(s => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    if (/\b(?:not (?:available|open) (?:in|to)|excluding|except|cannot (?:hire|employ) (?:in|from))\b[^.!?;]{0,100}\b(?:nigeria|africa)\b/i.test(sentence)
      || /\b(?:must|required to|only)\b[^.!?;]{0,70}\b(?:US|U\.S\.|United States|UK|United Kingdom|EU|European Union|Canada|Canadian|European)\b[^.!?;]{0,50}\b(?:citizen|citizenship|work authori[sz]ation|residen[ct])\b/i.test(sentence)
      || /\b(?:must|required to)\s+(?:be\s+)?(?:based|reside|located|live)\s+in\s+(?:the\s+)?(?:US|USA|United States|UK|United Kingdom|EU|European Union|Europe|Canada|Australia)\b/i.test(sentence)) {
      return { status: 'ineligible', evidence: [`Explicit restriction: ${sentence.slice(0, 300)}`] };
    }
  }
  for (const sentence of sentences) {
    if (/\b(?:this (?:role|position|job) (?:is|requires)|must (?:work|be)|required to (?:work|be))\b[^.!?;]{0,60}\b(?:on[ -]?site|hybrid|in[ -]?office)\b/i.test(sentence)) {
      return { status: 'ineligible', evidence: [`Work arrangement restriction: ${sentence.slice(0, 300)}`] };
    }
    if (/\b(?:must|only|required|restricted|unable to|cannot)\b[^.!?;]{0,100}\b(?:residency|residence|citizen|citizenship|eligible countries|right to work|work authori[sz]ation|based in|located in|reside|hire (?:in|from))\b/i.test(sentence)
      || /\b(?:only|restricted to)\s+(?:candidates|applicants|residents|hiring|available|open|US|USA|EU|UK|United States|Canada)\b/i.test(sentence)
      || /\b(?:eligible|supported|permitted|allowed) countries\s*:/i.test(sentence)) {
      return { status: 'unknown', evidence: [`Additional eligibility restriction needs review: ${sentence.slice(0, 300)}`] };
    }
  }
  const normalizedCountries = countries.map(c => c.toLowerCase().trim());
  const nigeriaListed = normalizedCountries.some(c => c === 'ng' || c === 'nigeria');
  if (countries.length && !nigeriaListed) {
    return { status: 'ineligible', evidence: [`Explicit eligible country list omits Nigeria: ${countries.join(', ')}.`] };
  }
  // A label such as "South Africa" must never be mistaken for continent-wide eligibility.
  const africaRegion = /\bafrica\b/.test(location.replace(/\b(?:south|north|east|southern|northern|eastern) africa\b/g, ''));
  const global = /\b(?:worldwide|anywhere in the world|global|anywhere|all countries)\b/.test(location);
  const nigeria = /\bnigeria\b/.test(location) || nigeriaListed;
  const emea = /\bemea\b/.test(location);
  const restrictedLocation = /\b(?:US|USA|United States|UK|United Kingdom|Canada|Europe|European Union|EU|Australia|South Africa)\b/i.test(input.location);
  if (!nigeria && !africaRegion && !emea && restrictedLocation) {
    return { status: 'ineligible', evidence: [`Location restricts hiring: ${input.location}.`] };
  }
  if (global && restrictedLocation && !nigeria) {
    return { status: 'unknown', evidence: ['Conflicting global and country/region location labels; confirm Nigeria eligibility.'] };
  }
  // Location is authoritative; prose contributes only explicit hiring statements, not mission/benefit wording.
  const explicitHiring = sentences.find(s => /\b(?:hire|hiring|work remotely|work from)\b[^.!?;]{0,60}\b(?:worldwide|anywhere in the world|nigeria|across africa)\b/i.test(s)
    && !/\b(?:not|cannot|except|excluding|unable)\b/i.test(s));
  if (remote === true && (nigeria || africaRegion || emea || global || explicitHiring)) {
    evidence.push(nigeria ? 'Posting explicitly lists Nigeria.' : africaRegion ? 'Posting explicitly permits Africa; Nigeria is in Africa.'
      : emea ? 'Posting explicitly permits EMEA; Nigeria is in that region.' : global ? `Posting location explicitly says ${input.location}.` : `Explicit hiring statement: ${explicitHiring}`);
    evidence.push('Posting eligibility evidence is not a guarantee of employer contracting/payroll support; confirm before applying.');
    return { status: 'eligible', evidence };
  }
  return { status: 'unknown', evidence: [remote !== true ? 'Fully remote work is not explicitly confirmed.' : 'Remote alone does not establish Nigeria eligibility.'] };
}
