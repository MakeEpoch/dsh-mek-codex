import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { EventHub } from '../host/events.js';
import { StateStore } from '../host/state.js';
import { CodexRuntime } from '../host/runtime.js';
import { createHandlers } from '../host/handlers.js';
import { Conversation } from '../client/conversation.js';
import { useActions } from '../client/hooks/use-actions.js';

const h = React.createElement;
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-send-confirmation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const hub = new EventHub();
  const store = new StateStore(dir);
  const runtime = new CodexRuntime({}, { store }, hub);
  runtime.owns.set('t1', {});
  const handlers = createHandlers(runtime, hub, store, {}, dir);
  const presence = async () => (await handlers.presence({ threadIds: ['t1'] })).presence.t1;
  return { dir, hub, store, runtime, handlers, presence };
}

test('send acknowledgement is separate from the lock preventing a second turn', async t => {
  const { runtime, handlers, presence } = setup(t);
  let acknowledge, calls = 0;
  runtime.request = async () => { calls++; return new Promise(resolve => { acknowledge = resolve; }); };
  const sent = handlers.send({ threadId: 't1', text: 'hello' });
  assert.equal((await presence()).sendStatus, 'sending');
  await assert.rejects(handlers.send({ threadId: 't1', text: 'duplicate' }), { code: 'send-in-progress' });
  acknowledge({ turn: { id: 'current', status: 'inProgress' } });
  await sent;
  assert.equal((await presence()).sendStatus, 'confirmed');
  assert.equal((await presence()).resumeSafe, false);
  await assert.rejects(handlers.send({ threadId: 't1', text: 'duplicate' }), /上一轮已发送/);
  assert.equal(calls, 1);
  runtime.onTurnCompleted({ threadId: 't1', turn: { id: 'current', status: 'completed' } });
  assert.equal((await presence()).sendStatus, 'idle');
  assert.equal((await presence()).resumeSafe, true);
});

test('timeout publishes an unknown outcome and cannot silently retry', async t => {
  const { runtime, handlers, hub, presence } = setup(t);
  runtime.request = async () => { throw new Error('timeout'); };
  await assert.rejects(handlers.send({ threadId: 't1', text: 'retained draft' }), { code: 'unsafe-send' });
  assert.equal((await presence()).sendStatus, 'unknown');
  assert.equal(hub.eventsSince(0).at(-1).params.presence.sendStatus, 'unknown');
  assert.equal((await handlers.reconcile({ threadId: 't1' })).sendStatus, 'unknown');
  await assert.rejects(handlers.send({ threadId: 't1', text: 'duplicate' }), { code: 'unsafe' });
});

test('a response without a turn ID stays unknown instead of clearing the draft', async t => {
  const { runtime, handlers, presence } = setup(t);
  runtime.request = async () => ({ turn: {} });
  await assert.rejects(handlers.send({ threadId: 't1', text: 'retained draft' }), /未返回轮次 ID/);
  assert.equal((await presence()).sendStatus, 'unknown');
});

test('existing acknowledged records reconcile without guessing completion or changing the lock', async t => {
  const { store, runtime, handlers } = setup(t);
  store.set('t1', { resumeSafe: false, lastTurnId: 'current' });
  runtime.request = async () => ({ data: [{ id: 'other', status: 'completed' }, { id: 'current', status: 'inProgress' }] });
  const result = await handlers.reconcile({ threadId: 't1' });
  assert.equal(result.sendStatus, 'confirmed');
  assert.equal(result.resumeSafe, false);
  runtime.onTurnCompleted({ threadId: 't1', turn: { id: 'other', status: 'completed' } });
  assert.equal(store.get('t1').resumeSafe, false);
});

async function renderRoot(t) {
  const env = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  globalThis.window = env.window;
  globalThis.document = env.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); env.window.close(); });
  return root;
}
const client = { read: async () => ({ id: 't1', title: 'Chat' }), turns: async () => ({ turns: [] }) };

test('normal pending and running sends have no warning, preserve the send lock and allow steering', async t => {
  const root = await renderRoot(t);
  let steered;
  const props = { client, threadId: 't1', connected: true, draftSnapshot: { text: 'supplement' }, onSteer: async (...args) => { steered = args; return true; } };
  await act(async () => root.render(h(Conversation, { ...props, runtime: { presence: { owned: true, resumeSafe: false, sendStatus: 'sending' } } })));
  assert.equal(document.querySelector('.cp-unsafe-banner'), null);
  assert.equal(document.querySelector('[aria-label="发送"]').disabled, true);
  await act(async () => root.render(h(Conversation, { ...props, runtime: {
    presence: { owned: true, resumeSafe: false, sendStatus: 'confirmed', lastTurnId: 'current', running: true },
    unsafe: { message: 'stale failure' },
  } })));
  assert.equal(document.querySelector('.cp-unsafe-banner'), null);
  assert.ok(document.querySelector('[aria-label="中断"]'));
  const supplement = [...document.querySelectorAll('button')].find(button => button.textContent === '发送补充');
  await act(async () => supplement.click());
  assert.deepEqual(steered, ['t1', 'supplement']);
  await act(async () => root.render(h(Conversation, { ...props, runtime: {
    presence: { owned: true, resumeSafe: true, sendStatus: 'idle' }, unsafe: { message: 'stale failure' },
  } })));
  assert.equal(document.querySelector('.cp-unsafe-banner'), null);
});

test('unknown sends keep the warning and text/image recovery, including legacy presence records', async t => {
  const root = await renderRoot(t);
  const runtime = {
    presence: { owned: true, resumeSafe: false, sendStatus: 'unknown' },
    pendingDraft: { text: 'retained draft', images: ['/example/image.png'] },
  };
  await act(async () => root.render(h(Conversation, { client, threadId: 't1', connected: true, runtime })));
  assert.match(document.querySelector('.cp-unsafe-banner').textContent, /发送结果待确认/);
  const restore = [...document.querySelectorAll('button')].find(button => button.textContent === '恢复草稿');
  await act(async () => restore.click());
  assert.equal(document.querySelector('textarea').value, 'retained draft');
  assert.match(document.querySelector('.cp-chip').textContent, /image.png/);
  assert.equal(document.querySelector('[aria-label="发送"]').disabled, true);
  await act(async () => root.render(h(Conversation, { client, threadId: 't1', connected: true,
    runtime: { ...runtime, presence: { owned: true, resumeSafe: false } },
  })));
  assert.ok(document.querySelector('.cp-unsafe-banner'));
});

test('send actions clear acknowledged drafts and distinguish confirmed, pending and unknown reconciliation', async t => {
  const root = await renderRoot(t);
  let actions, status = { resumeSafe: false, sendStatus: 'confirmed' };
  const patches = [], notices = [];
  const api = { send: async () => ({ turnId: 'current' }), reconcile: async () => status };
  function Harness() {
    actions = useActions({ client: api, setBusy: () => {}, setPresence: () => {},
      setThreadRuntime: (_id, patch) => patches.push(patch), pushNotice: value => notices.push(value),
    });
    return null;
  }
  await act(async () => root.render(h(Harness)));
  assert.equal(await actions.sendMessage('t1', 'hello', []), true);
  assert.deepEqual(patches.at(-1), { pendingDraft: null, unsafe: null });
  await actions.reconcile('t1');
  assert.match(notices.at(-1), /消息已确认发送/);
  status = { resumeSafe: false, sendStatus: 'sending' };
  await actions.reconcile('t1');
  assert.match(notices.at(-1), /正在等待发送确认/);
  status = { resumeSafe: false, sendStatus: 'unknown' };
  await actions.reconcile('t1');
  assert.match(notices.at(-1), /仍未确认发送结果/);
  api.send = async () => { throw new Error('network disconnected'); };
  assert.equal(await actions.sendMessage('t1', 'retained', []), false);
  assert.equal(patches.at(-2).pendingDraft.text, 'retained');
  assert.equal(patches.at(-1).unsafe.message, 'network disconnected');
  assert.match(notices.at(-1), /network disconnected/);
});
