import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export type Fetch = typeof fetch;
export type HttpOptions = { fetch?: Fetch; sleep?: (ms: number) => Promise<void>; cacheDir?: string; now?: () => number };
export class HttpError extends Error {
  constructor(public readonly status: number, public readonly host: string) { super(`HTTP ${status} from ${host}`); }
}
export class Http {
  private readonly fetcher: Fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly cacheDir: string;
  private readonly lastRequest = new Map<string, number>();
  constructor(options: HttpOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.cacheDir = options.cacheDir ?? '.cache/http';
  }
  async request(url: string, init: RequestInit = {}, retries = 2, retryFloorMs = 1000): Promise<unknown> {
    const host = new URL(url).hostname;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        this.lastRequest.set(host, this.now());
        response = await this.fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) });
      } catch {
        if (attempt >= retries) throw new Error(`Network/TLS/timeout error contacting ${host}; credentials and response bodies omitted.`);
        await this.sleep(Math.max(retryFloorMs, 1000 * 2 ** attempt));
        continue;
      }
      if (response.ok) {
        const body = await response.text();
        if (!body) return null;
        if (body.length > 30_000_000) throw new Error(`Oversized JSON response from ${host}`);
        try { return JSON.parse(body) as unknown; } catch { throw new Error(`Invalid JSON from ${host}`); }
      }
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt >= retries) throw new HttpError(response.status, host);
      const retry = response.headers.get('retry-after');
      const parsed = retry ? (/^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - this.now()) : 1000 * 2 ** attempt;
      // Never retry sooner than requested; very long guidance ends this run for the source.
      if (!Number.isFinite(parsed) || parsed > 60_000) throw new Error(`Retry-After from ${host} exceeds this run's wait budget; defer source.`);
      await this.sleep(Math.max(retryFloorMs, parsed));
    }
  }
  async get(url: string, ttlMs: number, minIntervalMs = 1100): Promise<unknown> {
    const path = join(this.cacheDir, `${createHash('sha256').update(url).digest('hex')}.json`);
    try {
      const cached = z.object({ savedAt: z.number(), body: z.unknown() }).parse(JSON.parse(await readFile(path, 'utf8')));
      if (this.now() >= cached.savedAt && this.now() - cached.savedAt < ttlMs) return cached.body;
    } catch { /* Missing or corrupt cache: fetch an independently validated response. */ }
    const host = new URL(url).hostname;
    const previous = this.lastRequest.get(host);
    if (previous !== undefined) await this.sleep(Math.max(0, minIntervalMs - (this.now() - previous)));
    this.lastRequest.set(host, this.now());
    const body = await this.request(url, { headers: { accept: 'application/json', 'user-agent': 'PersonalRemoteJobHunter/1.0 (personal job discovery; public read-only APIs)' } }, 2, minIntervalMs);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ savedAt: this.now(), body }), { mode: 0o600 });
    return body;
  }
}
