import type { SourcesConfig } from '../config.js';
import type { Http } from '../http.js';
import type { Collection } from '../types.js';
import { collectHimalayas } from './himalayas.js';
import { collectRemotive } from './remotive.js';
import { collectGreenhouse } from './greenhouse.js';
import { collectAshby } from './ashby.js';
import { collectLever } from './lever.js';

export async function collectAll(http: Http, now: Date, config: SourcesConfig): Promise<Collection> {
  const targets: { name: string; collect: () => Promise<Collection> }[] = [];
  if (config.himalayas) targets.push({ name: 'himalayas', collect: () => collectHimalayas(http, now, config.himalayasMaxPages) });
  if (config.remotive) targets.push({ name: 'remotive', collect: () => collectRemotive(http, now) });
  for (const board of config.greenhouse) targets.push({ name: `greenhouse:${board.token}`, collect: () => collectGreenhouse(http, now, board) });
  for (const board of config.ashby) targets.push({ name: `ashby:${board.token}`, collect: () => collectAshby(http, now, board) });
  for (const board of config.lever) targets.push({ name: `lever:${board.token}`, collect: () => collectLever(http, now, board, config.leverMaxPages) });
  const result: Collection = { jobs: [], health: [] };
  // Intentionally sequential: small personal workload, bounded requests and simple provider pacing.
  for (const target of targets) {
    try {
      const collected = await target.collect();
      result.jobs.push(...collected.jobs); result.health.push(...collected.health);
    } catch (error) {
      const detail = error instanceof Error && /^(HTTP |Network\/TLS|Retry-After |All rows|Invalid JSON|Oversized JSON)/.test(error.message)
        ? error.message : 'Payload validation or source configuration failure; inspect source schema without logging secrets.';
      result.health.push({ source: target.name, status: 'failed', count: 0, invalid: 0, checkedAt: now.toISOString(), detail });
    }
  }
  return result;
}
