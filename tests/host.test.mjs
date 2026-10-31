import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApprovals } from '../host/approvals.js';
import { EventHub } from '../host/events.js';
import { StateStore } from '../host/state.js';
import { CodexRuntime } from '../host/runtime.js';
import { createHandlers } from '../host/handlers.js';
import { apply } from '../host/index.js';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mek-codex-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const hub = new EventHub();
  const store = new StateStore(dir);
  const runtime = new CodexRuntime({}, { store, codexBin: '/nonexistent/mek-codex' }, hub);
  runtime.owns.set('t1', {});
  const replies = [];
  runtime.respond = (...args) => replies.push({ result: args });
  runtime.respondError = (...args) => replies.push({ error: args });
  const approvals = createApprovals(runtime, hub, 10);
  runtime.approvals = approvals;
  t.after(() => approvals.failAll('test cleanup'));
  const handlers = createHandlers(runtime, hub, store, approvals, dir);
  return { dir, hub, store, runtime, approvals, handlers, replies };
}
const approval = { threadId: 't1', availableDecisions: ['accept'] };
const method = 'item/commandExecution/requestApproval';

test('approval timeout never selects an approval-only choice', async t => {
  const { approvals, replies, hub } = setup(t);
  approvals.handleServerRequest(1, method, approval);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(replies.length, 1);
  assert.ok(replies[0].error);
  assert.equal(hub.eventsSince(0).at(-1).params.reason, 'timeout');
});
test('timeout declines with its reason and clears timer', async t => {
  const { approvals, replies, hub } = setup(t);
  approvals.handleServerRequest(1, method, { ...approval, availableDecisions: ['accept', 'decline'] });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(replies[0].result, [1, { decision: 'decline' }]);
  assert.equal(hub.eventsSince(0).at(-1).params.reason, 'timeout');
  assert.equal(approvals.pending.size, 0);
});
test('disconnect cannot auto-approve and unsupported requests get protocol errors', t => {
  const { approvals, replies } = setup(t);
  approvals.handleServerRequest(1, method, approval);
  approvals.failAll('disconnect');
  approvals.handleServerRequest(2, 'item/tool/requestUserInput', { threadId: 't1' });
  approvals.handleServerRequest(3, method, { threadId: 'foreign' });
  assert.ok(replies.every(reply => reply.error));
});
test('object decisions must match the offered payload in full', t => {
  const { approvals, replies } = setup(t);
  const decision = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'status'] } };
  approvals.handleServerRequest(1, method, { ...approval, availableDecisions: [decision, 'cancel'] });
  const id = [...approvals.pending.keys()][0];
  assert.throws(() => approvals.decide(id, 'acceptWithExecpolicyAmendment'), { code: 'invalid-decision' });
  approvals.decide(id, decision);
  assert.deepEqual(replies[0].result[1], { decision });
});
test('missing availableDecisions retains explicit accept and refuse controls', t => {
  const { approvals } = setup(t);
  approvals.handleServerRequest(1, method, { threadId: 't1' });
  assert.deepEqual(approvals.snapshot()[0].available, ['accept', 'acceptForSession', 'decline', 'cancel']);
  assert.equal(approvals.snapshot()[0].transportId, undefined);
});
test('concurrent sends invoke turn/start once and uncertainty blocks retries', async t => {
  const { handlers, runtime } = setup(t);
  let resolve, count = 0;
  runtime.request = () => { count++; return new Promise(r => { resolve = r; }); };
  const first = handlers.send({ threadId: 't1', text: 'hello' });
  await assert.rejects(handlers.send({ threadId: 't1', text: 'hello' }), { code: 'send-in-progress' });
  resolve({ turn: { id: 'turn-1' } });
  await first;
  await assert.rejects(handlers.send({ threadId: 't1', text: 'hello' }), { code: 'unsafe' });
  assert.equal(count, 1);
});
test('persist failure prevents dispatch; corrupt state blocks sends', async t => {
  const { handlers, runtime, store, dir } = setup(t);
  let count = 0; runtime.request = async () => { count++; };
  store.save = () => { throw new Error('disk full'); };
  await assert.rejects(handlers.send({ threadId: 't1', text: 'hello' }), /disk full/);
  assert.equal(count, 0);
  writeFileSync(join(dir, 'state.json'), '{broken');
  assert.equal(new StateStore(dir).get('t1').resumeSafe, false);
});
test('an early unrelated completion cannot unlock a send', async t => {
  const { handlers, runtime, store } = setup(t);
  runtime.request = async () => {
    runtime.onTurnCompleted({ threadId: 't1', turn: { id: 'older', status: 'completed' } });
    return { turn: { id: 'current' } };
  };
  await handlers.send({ threadId: 't1', text: 'hello' });
  assert.equal(store.get('t1').resumeSafe, false);
  runtime.onTurnCompleted({ threadId: 't1', turn: { id: 'current', status: 'completed' } });
  assert.equal(store.get('t1').resumeSafe, true);
});
test('matching completion before turn/start response is reconciled', async t => {
  const { handlers, runtime, store } = setup(t);
  runtime.request = async () => {
    runtime.onTurnCompleted({ threadId: 't1', turn: { id: 'current', status: 'completed' } });
    return { turn: { id: 'current' } };
  };
  assert.equal((await handlers.send({ threadId: 't1', text: 'hello' })).resumeSafe, true);
  assert.equal(store.get('t1').resumeSafe, true);
});
test('refresh checks stored turns by exact id and terminal status', async t => {
  const { handlers, runtime, store } = setup(t);
  store.set('t1', { resumeSafe: false, lastTurnId: 'wanted' });
  runtime.request = async () => ({ data: [{ id: 'other', status: 'completed' }, { id: 'wanted', status: 'inProgress' }] });
  assert.equal((await handlers.reconcile({ threadId: 't1' })).resumeSafe, false);
  runtime.request = async () => ({ data: [{ id: 'wanted', status: 'interrupted' }] });
  assert.equal((await handlers.reconcile({ threadId: 't1' })).resumeSafe, true);
});
test('refresh preserves unknown send outcome without a turn id', async t => {
  const { handlers, runtime, store } = setup(t);
  store.set('t1', { resumeSafe: false, lastTurnId: null });
  runtime.request = () => { throw new Error('must not guess latest turn'); };
  assert.equal((await handlers.reconcile({ threadId: 't1' })).resumeSafe, false);
});
test('writes require an explicitly entered thread', async t => {
  const { handlers, runtime } = setup(t);
  runtime.owns.clear();
  for (const name of ['send', 'steer', 'interrupt', 'queue.add', 'settings']) {
    await assert.rejects(handlers[name]({ threadId: 't1', text: 'hello', model: 'example' }), { code: 'not-owned' });
  }
});
test('initial and reset event cursors recover approvals and current ownership', async t => {
  const { handlers, approvals, hub } = setup(t);
  hub.push('turn/started', { threadId: 't1', turn: { id: 'turn-1' } });
  approvals.handleServerRequest(1, method, { ...approval, availableDecisions: ['decline'] });
  for (const since of [0, 99999]) {
    const result = await handlers.events({ since, timeoutMs: 0 });
    assert.ok(result.events.length >= 2);
    assert.equal(result.pendingApprovals.length, 1);
    assert.equal(result.pendingApprovals[0].transportId, undefined);
    assert.equal(result.presence.t1.owned, true);
  }
});
test('runtime lifecycle serializes restart and disposal', async t => {
  const { runtime } = setup(t);
  const operations = [];
  runtime.startOnce = async () => { operations.push('start'); await new Promise(r => setTimeout(r, 5)); };
  runtime.stopOnce = async () => { operations.push('stop'); };
  await Promise.all([runtime.start(), runtime.restart(), runtime.stop()]);
  assert.deepEqual(operations, ['start', 'stop', 'start', 'stop']);
});
test('new and legacy RPC routes reject inherited methods and dispose cleanly', async t => {
  const { dir } = setup(t); const routes = new Map(); let cleanup;
  apply({ connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } }, effect(fn) { cleanup = fn(); } }, { stateDir: dir, codexBin: '/nonexistent/mek-codex' });
  try {
    for (const endpoint of ['dsh-mek-codex', 'dsh-codex-panel']) {
      const route = routes.get(`/api/${endpoint}`);
      for (const method of ['health', 'toString', '__proto__']) {
        const result = await route.fetch(new Request(`http://localhost/api/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', method: endpoint, rpcId: '1', payload: { method } }) }));
        const body = await result.json();
        assert.equal(body.result.ok, method === 'health');
      }
    }
  } finally { await cleanup(); }
  assert.equal(routes.size, 0);
});

test('event replay after release cannot restore obsolete ownership', async t => {
  const { handlers, runtime, hub } = setup(t);
  hub.push('turn/started', { threadId: 't1', turn: { id: 'old' } });
  runtime.owns.clear();
  hub.turnState.clear();
  const result = await handlers.events({ since: 0, timeoutMs: 0 });
  assert.equal(result.events.length, 1);
  assert.equal(result.presence.t1.owned, false);
  assert.equal(result.presence.t1.running, false);
});
