import { homedir } from 'node:os';
import { join } from 'node:path';
import { PLUGIN_NAME, ENDPOINT, LEGACY_ENDPOINT, STATE_DIRECTORY } from '../shared/identity.js';
import { MAX_BODY_BYTES } from './constants.js';
import { EventHub } from './events.js';
import { StateStore } from './state.js';
import { CodexRuntime } from './runtime.js';
import { createApprovals } from './approvals.js';
import { createNavigation } from './navigation.js';
import { createHandlers } from './handlers.js';
export const name = PLUGIN_NAME;
export const inject = ['connection'];

function boundedBody(request, max) {
  return (async () => {
    let size = 0;
    const chunks = [];
    for await (const chunk of request.body ?? []) {
      size += chunk.length;
      if (size > max) throw new Error('请求体过大');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  })();
}

export function apply(ctx, config = {}) {
  const stateDir = config.stateDir || join(process.env.DSH_HOME ? process.env.DSH_HOME : join(homedir(), '.dsh'), STATE_DIRECTORY);
  const hub = new EventHub();
  const store = new StateStore(stateDir);
  const runtime = new CodexRuntime(ctx, { ...config, store, stateDir }, hub);

  const approvals = createApprovals(runtime, hub);
  runtime.approvals = approvals;

  const handlers = createHandlers(runtime, hub, store, approvals, stateDir, createNavigation(runtime, config));

  function registerRpc(endpoint) {
    return ctx.connection.fetch.register({
      path: `/api/${endpoint}`,
      methods: ['POST'],
      requestBody: 'streaming',
      async fetch(request) {
        const contentType = request.headers.get('content-type')?.split(';')[0];
        if (contentType !== 'application/json') return new Response('JSON required', { status: 415 });
        let message;
        try {
          message = JSON.parse((await boundedBody(request, MAX_BODY_BYTES)).toString('utf8'));
        } catch {
          return new Response('Invalid or oversized JSON', { status: 400 });
        }
        if (
          message?.type !== 'client-request' ||
          message?.method !== endpoint ||
          typeof message?.rpcId !== 'string' ||
          typeof message?.payload?.method !== 'string'
        ) {
          return new Response('Invalid RPC', { status: 400 });
        }
        const handler = Object.hasOwn(handlers, message.payload.method) ? handlers[message.payload.method] : null;
        let result;
        if (!handler) {
          result = { ok: false, error: { code: 'unknown-method', message: `未知方法：${message.payload.method}` } };
        } else {
          try {
            result = { ok: true, value: await handler(message.payload.payload ?? {}) };
          } catch (error) {
            result = { ok: false, error: { code: error?.code ?? 'execution-failed', message: String(error?.message ?? error) } };
          }
        }
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result });
      },
    });
  }

  ctx.effect(() => {
    void runtime.start();
    const disposeRpcs = [ENDPOINT, LEGACY_ENDPOINT].map(registerRpc);
    return async () => {
      try {
        for (const dispose of disposeRpcs) await dispose?.();
      } catch {
        /* route already gone */
      }
      await runtime.stop();
    };
  }, 'codex-panel: host');
}
