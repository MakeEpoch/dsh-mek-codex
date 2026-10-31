#!/usr/bin/env node
import { join } from 'node:path';
/**
 * Dev-only smoke test for the host half, without installing the plugin.
 *
 * Simulates the small slice of Cordis the plugin touches:
 *   - ctx.logger
 *   - ctx.connection.fetch.register({ path, methods, requestBody, fetch })
 *   - ctx.effect(fn, label)
 *
 * Then it calls the RPC route exactly like the browser half would and prints
 * the health snapshots. Requires `codex` on PATH (or CODEX_BIN).
 *
 *   node scripts/smoke-host.mjs
 */

import { apply } from '../lib/index.js';

const routes = new Map();
const cleanups = [];

const ctx = {
  logger: {
    info: (...args) => console.log('[info]', ...args),
    warn: (...args) => console.warn('[warn]', ...args),
    debug: () => {},
  },
  connection: {
    fetch: {
      register(options) {
        routes.set(options.path, options);
        return () => routes.delete(options.path);
      },
    },
  },
  effect(fn, label) {
    const cleanup = fn();
    cleanups.push(cleanup);
    console.log(`[effect] ${label}`);
  },
};

apply(ctx, { stateDir: join(process.cwd(), 'sandbox', 'host-state') });

const route = routes.get('/api/dsh-codex-panel');
if (!route) {
  console.error('[fatal] host did not register /api/dsh-codex-panel');
  process.exit(1);
}

let rpcId = 0;
async function rpc(method, payload = {}) {
  const response = await route.fetch(
    new Request('http://localhost/api/dsh-codex-panel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        method: 'dsh-codex-panel',
        rpcId: String(++rpcId),
        payload: { method, payload },
      }),
    }),
  );
  const body = await response.json();
  return body.result;
}

async function waitFor(predicate, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await rpc('health');
    if (predicate(result.value)) return result.value;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return (await rpc('health')).value;
}

try {
  console.log('[smoke] waiting for handshake…');
  const health = await waitFor((value) => value.status === 'connected' || value.status === 'not-installed' || value.status === 'start-failed');
  console.log('[smoke] health =', JSON.stringify(health, null, 2));

  if (health.status !== 'connected') {
    console.error('[smoke] FAIL: host did not reach connected');
    process.exitCode = 1;
  } else {
    const restarted = await rpc('restart');
    console.log('[smoke] restart =', JSON.stringify(restarted.value, null, 2));
    if (restarted.value.status !== 'connected') {
      console.error('[smoke] FAIL: restart did not reconnect');
      process.exitCode = 1;
    }
  }

  if (health.status === 'connected') {
    const listed = await rpc('list', { limit: 10 });
    const data = listed.value?.data ?? [];
    console.log(
      '[smoke] list =',
      JSON.stringify({ count: data.length, nextCursor: Boolean(listed.value?.nextCursor), sample: data.slice(0, 2) }, null, 2),
    );
    const ids = data.map((thread) => thread.id);
    if (new Set(ids).size !== ids.length) {
      console.error('[smoke] FAIL: duplicate thread ids in one page');
      process.exitCode = 1;
    }
    const target = data.find((thread) => thread.cwd) ?? data[0];
    if (target) {
      const turns = await rpc('turns', { threadId: target.id, limit: 3 });
      console.log(
        '[smoke] turns =',
        JSON.stringify({ count: turns.value?.turns?.length ?? 0, nextCursor: Boolean(turns.value?.nextCursor), first: turns.value?.turns?.[0]?.id ?? null }, null, 2),
      );
      const read = await rpc('read', { threadId: target.id });
      console.log('[smoke] read =', JSON.stringify(read.value, null, 2));
      if (!read.value?.id || read.value.id !== target.id) {
        console.error('[smoke] FAIL: read id mismatch');
        process.exitCode = 1;
      }
    }
  }

  const bad = await rpc('nope');
  console.log('[smoke] unknown method ->', JSON.stringify(bad));
} finally {
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup?.();
    } catch (error) {
      console.warn('[smoke] cleanup failed:', error?.message ?? error);
    }
  }
  console.log('[smoke] done');
}
