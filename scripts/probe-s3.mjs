#!/usr/bin/env node
/**
 * Protocol probes for S3–S8 planning (read-only on real threads; writes only on
 * a test thread this script creates).
 *
 *   node scripts/probe-s3.mjs
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REAL_THREAD = process.env.CODEX_PROBE_THREAD_ID;
if (!REAL_THREAD) throw new Error('Set CODEX_PROBE_THREAD_ID explicitly for the read-only comparison');
const sandbox = join(process.cwd(), 'sandbox');

const child = spawn(process.env.CODEX_BIN ?? 'codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
const rl = createInterface({ input: child.stdout });
let nextId = 1;
const pending = new Map();
const events = [];
rl.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id !== undefined && typeof message.method === 'string') {
    const approval = { method: message.method, params: message.params };
    events.push({ type: 'request', approval });
    child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32601, message: 'probe refuses' } })}\n`);
    return;
  }
  if (typeof message.method === 'string') {
    events.push({ type: 'notification', method: message.method, params: message.params });
    return;
  }
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
});

const request = (method, params, timeoutMs = 60_000) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout ${method}`));
    }, timeoutMs);
  });
const notify = (method, params) => child.stdin.write(`${JSON.stringify({ method, params })}\n`);

const textOf = (item) => (item?.type === 'agentMessage' ? item.text ?? '' : '');

try {
  await request('initialize', { clientInfo: { name: 'probe-s3', title: 'probe', version: '0.1' }, capabilities: { experimentalApi: true } });
  notify('initialized', {});

  // 1. summary vs full item view on a real thread (read-only)
  for (const view of ['summary', 'full']) {
    const page = await request('thread/turns/list', { threadId: REAL_THREAD, limit: 3, itemsView: view, sortDirection: 'desc' });
    const turns = page.data ?? [];
    const lengths = turns.flatMap((turn) => (turn.items ?? []).filter((item) => item.type === 'agentMessage').map((item) => textOf(item).length));
    console.log(
      `[view=${view}] turns=${turns.length} itemsView=${turns[0]?.itemsView} itemCounts=${turns.map((t) => (t.items ?? []).length).join(',')} agentTextLengths=${lengths.join(',')}`,
    );
    console.log(`           full text has truncation marker:`, lengths.some((length) => length > 0) ? turns.flatMap((t) => t.items ?? []).some((item) => /…\s*$|\[truncated\]|\.\.\.$/.test(textOf(item))) : 'n/a');
  }

  // 2. thread/items/list for one turn (lazy full items)
  const firstTurn = (await request('thread/turns/list', { threadId: REAL_THREAD, limit: 1, itemsView: 'summary', sortDirection: 'desc' })).data?.[0];
  if (firstTurn) {
    const items = await request('thread/items/list', { threadId: REAL_THREAD, turnId: firstTurn.id, itemsView: 'full', limit: 50 });
    console.log(`[items/list] turn=${firstTurn.id} items=${(items.data ?? []).length}`);
  }

  // 3. model/list
  const models = await request('model/list', { limit: 50 });
  console.log('[models]', JSON.stringify((models.data ?? []).slice(0, 3).map((model) => ({ id: model.id, displayName: model.displayName, defaultEffort: model.defaultReasoningEffort, efforts: model.supportedReasoningEfforts?.map?.((e) => e.reasoningEffort ?? e.effort ?? e) }))));

  // 4. test thread: settings/update + localImage + steer + queue
  mkdirSync(sandbox, { recursive: true });
  const pngPath = join(sandbox, 'probe-image.png');
  // 1x1 red PNG
  writeFileSync(pngPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

  const started = await request('thread/start', { cwd: sandbox, approvalPolicy: 'never', sandbox: 'read-only' });
  const threadId = started.thread.id;
  console.log(`[test thread] ${threadId}`);

  const settings = await request('thread/settings/update', { threadId, effort: 'low' });
  console.log('[settings/update]', JSON.stringify(settings));

  const done = new Promise((resolve) => {
    const off = () => {};
    const timer = setInterval(() => {
      const completed = events.find((event) => event.type === 'notification' && event.method === 'turn/completed' && event.params?.threadId === threadId);
      if (completed) {
        clearInterval(timer);
        off();
        resolve(completed.params.turn);
      }
    }, 200);
    setTimeout(() => {
      clearInterval(timer);
      resolve(null);
    }, 180_000);
  });

  await request('turn/start', {
    threadId,
    input: [
      { type: 'text', text: 'What color is this 1x1 image? Answer with one word.', text_elements: [] },
      { type: 'localImage', path: pngPath },
    ],
  });
  const finished = await done;
  console.log(`[localImage] turn status=${finished?.status} imageInItems=${events.some((e) => e.type === 'notification' && e.method === 'item/completed' && e.params?.item?.type === 'userMessage' && JSON.stringify(e.params.item).includes('localImage'))}`);

  const steer = await request('turn/steer', { threadId, expectedTurnId: finished?.id ?? '00000000-0000-0000-0000-000000000000', input: [{ type: 'text', text: 'noop', text_elements: [] }] }).then((value) => ({ ok: true, value })).catch((error) => ({ ok: false, error: error.message }));
  console.log('[steer after completion]', JSON.stringify(steer).slice(0, 200));

  const queue = await request('thread/queue/add', { threadId, clientUserMessageId: 'probe-1', input: [{ type: 'text', text: 'queued probe', text_elements: [] }] }).then((value) => ({ ok: true, value })).catch((error) => ({ ok: false, error: error.message }));
  console.log('[queue/add]', JSON.stringify(queue).slice(0, 220));
  const queueList = await request('thread/queue/list', { threadId });
  console.log('[queue/list]', JSON.stringify(queueList).slice(0, 220));

  await request('thread/archive', { threadId });
  console.log('[done] archived test thread');
} finally {
  child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 500);
}
