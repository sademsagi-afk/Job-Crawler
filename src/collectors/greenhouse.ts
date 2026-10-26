import { z } from 'zod';
import type { Http } from '../http.js';
import { health, makeJob, nonempty, optionalText, rows, remoteFrom, validatedRows } from './common.js';

export const greenhouseRow = z.object({
  id: z.number().int(), title: nonempty, absolute_url: nonempty,
  content: z.string(), location: z.object({ name: z.string() }), updated_at: optionalText,
  // updated_at is NOT a publication date.
});
export async function collectGreenhouse(http: Http, now: Date, board: { token: string; company: string }) {
  const body = z.object({ jobs: rows }).parse(await http.get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}/jobs?content=true`, 21_600_000));
  const result = validatedRows(greenhouseRow, body.jobs, j => makeJob({
    source: 'greenhouse', sourceId: `${board.token}:${j.id}`, title: j.title, company: board.company,
    sourceUpdatedAt: j.updated_at ?? null, description: j.content, url: j.absolute_url, location: j.location.name, remote: remoteFrom(j.location.name, j.content),
    // Pay transparency may be region-specific; do not mine arbitrary HTML for an unscoped salary.
  }, now));
  return { jobs: result.jobs, health: [health(`greenhouse:${board.token}`, now, result.jobs.length, result.invalid)] };
}
