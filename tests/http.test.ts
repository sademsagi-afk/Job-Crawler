import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Http } from '../src/http.js';

test('429 honors Retry-After and does not repeat early', async () => {
  let requests = 0; const waits: number[] = [];
  const http = new Http({ fetch: async () => ++requests === 1 ? new Response('', { status: 429, headers: { 'retry-after': '12' } }) : new Response('{"ok":true}'), sleep: async ms => { waits.push(ms); } });
  assert.deepEqual(await http.request('https://example.com'), { ok: true });
  assert.deepEqual(waits, [12000]);
});
test('provider minimum interval also applies to transient retries', async () => {
  let requests = 0; const waits: number[] = [];
  const http = new Http({ cacheDir: await mkdtemp(join(tmpdir(), 'jh-cache-')), fetch: async () => ++requests === 1 ? new Response('', { status: 503 }) : new Response('{}'), sleep: async ms => { waits.push(ms); } });
  await http.get('https://remotive.com/test', 1000, 31000);
  assert.deepEqual(waits, [31000]);
});
test('long retry guidance defers; permission denial is not retried', async () => {
  let n = 0;
  const denied = new Http({ fetch: async () => { n++; return new Response('', { status: 403 }); } });
  await assert.rejects(denied.request('https://example.com'), /HTTP 403/); assert.equal(n, 1);
  const limited = new Http({ fetch: async () => new Response('', { status: 429, headers: { 'retry-after': '3600' } }) });
  await assert.rejects(limited.request('https://example.com'), /defer source/);
});
test('HTTP cache prevents frequent repeated collection and respects expiry', async () => {
  let n = 0; let current = 100;
  const http = new Http({ cacheDir: await mkdtemp(join(tmpdir(), 'jh-cache-')), now: () => current, sleep: async () => {}, fetch: async () => { n++; return new Response('{"jobs":[]}'); } });
  await http.get('https://example.com', 1000); await http.get('https://example.com', 1000);
  assert.equal(n, 1); current += 1001; await http.get('https://example.com', 1000); assert.equal(n, 2);
});
test('204 RPC success is supported; invalid JSON is rejected', async () => {
  assert.equal(await new Http({ fetch: async () => new Response(null, { status: 204 }) }).request('https://example.com'), null);
  await assert.rejects(new Http({ fetch: async () => new Response('<html>oops</html>') }).request('https://example.com'), /Invalid JSON/);
});
