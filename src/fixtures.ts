import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Http } from './http.js';
import { collectAll } from './collectors/index.js';
import { SourcesConfig } from './config.js';

export async function fixtureCollection(now: Date) {
  const data = JSON.parse(await readFile('tests/fixtures/provider-payloads.json', 'utf8')) as Record<string, unknown>;
  const http = new Http({ cacheDir: await mkdtemp(join(tmpdir(), 'job-hunter-fixture-')), sleep: async () => {}, fetch: async (input) => {
    const u = new URL(String(input));
    if (u.hostname === 'himalayas.app' && (u.searchParams.get('q') === 'developer' || Number(u.searchParams.get('page')) > 1)) return new Response('{"jobs":[]}');
    const key = u.hostname === 'himalayas.app' ? 'himalayas' : u.hostname === 'remotive.com' ? 'remotive'
      : u.hostname === 'boards-api.greenhouse.io' ? 'greenhouse' : u.hostname === 'api.ashbyhq.com' ? 'ashby' : 'lever';
    return new Response(JSON.stringify(data[key]), { headers: { 'content-type': 'application/json' } });
  } });
  const collection = await collectAll(http, now, SourcesConfig.parse({ greenhouse: [{ token: 'fixture', company: 'Synthetic Greenhouse Employer' }], ashby: [{ token: 'fixture', company: 'Synthetic Ashby Employer' }], lever: [{ token: 'fixture', company: 'Synthetic Lever Employer' }] }));
  for (const h of collection.health) h.detail = `SYNTHETIC FIXTURE DATA — not a live check. ${h.detail}`;
  return collection;
}
