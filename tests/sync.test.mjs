import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventHub } from '../host/events.js';
import { createThreadSync } from '../host/sync.js';
import { ReadOnlyObserver } from '../host/observer.js';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';

test('cold history cannot turn an external active session into an interrupted verdict', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mek-sync-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout'); await writeFile(file, 'one');
  let reads = 0;
  const runtime = { isOwned: () => false, request: async method => {
    if (method === 'thread/read') return { thread: { id: 't', path: file, status: { type: 'notLoaded' } } };
    reads++; return { data: [{ id: 'turn', status: 'interrupted', items: [{ id: 'i', type: 'agentMessage', text: `Update ${reads}` }] }] };
  } };
  const observer = { request: async () => ({ thread: { id: 't', status: { type: 'notLoaded' } } }) };
  const sync = createThreadSync(runtime, new EventHub(), observer);
  const first = await sync({ threadId: 't' });
  assert.equal(first.observation.verified, false); assert.equal(first.observation.state, 'unknown');
  assert.equal(first.turns[0].status, 'unknown'); assert.equal(first.turns[0].recordedStatus, 'interrupted');
  const unchanged = await sync({ threadId: 't', revision: first.revision });
  assert.equal(unchanged.unchanged, true); assert.equal(unchanged.turns, undefined); assert.equal(reads, 1);
  await writeFile(file, 'two updates');
  const changed = await sync({ threadId: 't', revision: first.revision });
  assert.equal(changed.unchanged, false); assert.equal(reads, 2);
  assert.equal(changed.turns[0].items[0].text, 'Update 2');
});

test('loaded shared instance supplies runtime truth and rechecks in-memory text before disk flush', async () => {
  let sharedReads = 0;
  const runtime = { isOwned: () => false, request: async method => { assert.equal(method, 'thread/read'); return { thread: { id: 't', status: { type: 'notLoaded' } } }; } };
  const methods = [];
  const observer = { request: async method => {
    methods.push(method);
    if (method === 'thread/read') return { thread: { id: 't', status: { type: sharedReads < 2 ? 'active' : 'idle', activeFlags: ['waitingOnApproval'] } } };
    return { data: [{ id: 'turn', status: sharedReads < 2 ? 'inProgress' : 'completed', items: [{ id: 'i', type: 'agentMessage', text: `Stream ${++sharedReads}` }] }] };
  } };
  const sync = createThreadSync(runtime, new EventHub(), observer);
  const first = await sync({ threadId: 't' });
  assert.equal(first.observation.source, 'shared'); assert.equal(first.observation.state, 'running');
  assert.equal(first.observation.verified, true); assert.equal(first.turns[0].status, 'inProgress');
  const second = await sync({ threadId: 't', revision: first.revision });
  assert.equal(second.unchanged, false); assert.equal(second.turns[0].items[0].text, 'Stream 2');
  const end = await sync({ threadId: 't' });
  assert.equal(end.observation.state, 'idle'); assert.equal(end.turns[0].status, 'completed');
  observer.request = async () => { throw new Error('connection lost'); };
  runtime.request = async method => method === 'thread/read' ? { thread: { id: 't', status: { type: 'notLoaded' } } } : { data: [{ id: 'turn', status: 'interrupted', items: [] }] };
  const lost = await sync({ threadId: 't' });
  assert.equal(lost.observation.verified, false); assert.equal(lost.observation.state, 'unknown'); assert.equal(lost.turns[0].status, 'unknown');
  assert.ok(methods.every(method => ['thread/read', 'thread/turns/list'].includes(method)));
});

test('owned thread uses its writer stream; overlapping snapshots share one request', async () => {
  const hub = new EventHub(); hub.push('turn/started', { threadId: 't', turn: { id: 'turn' } });
  let reads = 0;
  const runtime = { isOwned: () => true, request: async method => {
    reads++; if (method === 'thread/read') return { thread: { id: 't', status: { type: 'active' } } };
    return { data: [{ id: 'turn', status: 'inProgress', items: [] }] };
  } };
  const sync = createThreadSync(runtime, hub, { request: () => { throw new Error('must not observe an owned thread'); } });
  const results = await Promise.all([sync({ threadId: 't' }), sync({ threadId: 't' })]);
  assert.equal(reads, 2); assert.equal(results[0].observation.source, 'panel');
  assert.equal(results[1].observation.state, 'running');
});

test('observer Unix WebSocket connection is read-only, reconnects and never owns the daemon', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mek-observer-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'server.sock'); const server = createServer(); const wss = new WebSocketServer({ server }); const calls = [];
  await new Promise(resolve => server.listen(path, resolve));
  const observer = new ReadOnlyObserver({ observerSocket: path, observerTimeoutMs: 500 });
  t.after(async () => { observer.close(); for (const client of wss.clients) client.terminate(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); });
  wss.on('connection', socket => socket.on('message', bytes => {
    const request = JSON.parse(bytes); calls.push(request.method);
    if (request.id !== undefined) socket.send(JSON.stringify({ id: request.id, result: request.method === 'initialize' ? { userAgent: 'fixture' } : { thread: { id: 't', status: { type: 'active' } } } }));
  }));
  const value = await observer.request('thread/read', { threadId: 't' });
  assert.equal(value.thread.status.type, 'active');
  for (const method of ['thread/resume', 'turn/start', 'turn/interrupt', 'approval.decide']) await assert.rejects(observer.request(method, {}), /只允许读取/);
  assert.deepEqual(calls, ['initialize', 'initialized', 'thread/read']);
  for (const socket of wss.clients) socket.terminate();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await observer.request('thread/read', { threadId: 't' })).thread.id, 't');
  for (const socket of wss.clients) socket.send(JSON.stringify({ id: 99, method: 'item/commandExecution/requestApproval', params: { threadId: 't' } }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(observer.peer.closed, true);
  assert.ok(calls.every(method => ['initialize', 'initialized', 'thread/read'].includes(method)));
});
