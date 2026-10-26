import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const board = z.object({ token: z.string().regex(/^[\w-]+$/), company: z.string().min(1) }).strict();
export const SourcesConfig = z.object({
  himalayas: z.boolean().default(true), himalayasMaxPages: z.number().int().min(1).max(100).default(10),
  remotive: z.boolean().default(true),
  greenhouse: z.array(board).max(50).default([]),
  ashby: z.array(board).max(50).default([]),
  lever: z.array(board.extend({ region: z.enum(['global', 'eu']).default('global') })).max(50).default([]),
  leverMaxPages: z.number().int().min(1).max(20).default(5),
  digestLimit: z.number().int().min(5).max(15).default(10),
}).strict();
export type SourcesConfig = z.infer<typeof SourcesConfig>;
export async function loadSources(path = 'config/sources.json'): Promise<SourcesConfig> {
  return SourcesConfig.parse(JSON.parse(await readFile(path, 'utf8')));
}
export function persistenceEnv(env: NodeJS.ProcessEnv = process.env) {
  const v = z.object({
    SUPABASE_URL: z.string().url(), SUPABASE_PROJECT_REF: z.string().regex(/^[a-z0-9]{20}$/),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  }).parse(env);
  const url = new URL(v.SUPABASE_URL);
  if (url.protocol !== 'https:' || url.hostname !== `${v.SUPABASE_PROJECT_REF}.supabase.co` || url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.port) {
    throw new Error('SUPABASE_URL must exactly match the dedicated SUPABASE_PROJECT_REF at https://<ref>.supabase.co');
  }
  return { url: url.origin, key: v.SUPABASE_SERVICE_ROLE_KEY, ref: v.SUPABASE_PROJECT_REF };
}
export function notificationEnv(env: NodeJS.ProcessEnv = process.env) {
  const v = z.object({ RESEND_API_KEY: z.string().min(10), DIGEST_FROM: z.string().email(), DIGEST_TO: z.string().email() }).parse(env);
  return { key: v.RESEND_API_KEY, from: v.DIGEST_FROM, to: v.DIGEST_TO.toLowerCase() };
}
