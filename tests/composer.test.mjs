import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { Composer } from '../client/components/composer.js';
import { useVoiceInput } from '../client/hooks/use-voice-input.js';
import { useActions } from '../client/hooks/use-actions.js';
import { openCapture, waveBytes } from '../client/speech.js';
import { EventHub } from '../host/events.js';
import { StateStore } from '../host/state.js';
import { createHandlers } from '../host/handlers.js';
const h = React.createElement;

function host(t) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-composer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new StateStore(dir), hub = new EventHub();
  const requests = [];
  const runtime = { owns: new Map([['t1', { model: 'example', effort: 'high', approvalsReviewer: 'user' }]]), isOwned: id => runtime.owns.has(id),
    request: async (method, params) => { requests.push({ method, params }); return {}; } };
  const approvals = { snapshot: () => [] };
  return { store, runtime, requests, approvals, handlers: createHandlers(runtime, hub, store, approvals, dir) };
}
test('approval settings update only the reviewer and retain model, effort and sandbox policy', async t => {
  const { handlers, runtime, requests, store } = host(t);
  const result = await handlers.settings({ threadId: 't1', approvalsReviewer: 'auto_review' });
  assert.deepEqual(requests, [{ method: 'thread/settings/update', params: { threadId: 't1', approvalsReviewer: 'auto_review' } }]);
  assert.equal(runtime.owns.get('t1').model, 'example');
  assert.equal(runtime.owns.get('t1').effort, 'high');
  assert.equal(store.get('t1').approvalsReviewer, 'auto_review');
  assert.deepEqual(result.settings, { approvalsReviewer: 'auto_review' });
  assert.equal(result.presence.model, 'example');
  assert.equal(result.presence.effort, 'high');
});
test('unsupported reviewers, pending approval and rejected changes never update local mode', async t => {
  const { handlers, runtime, approvals, store, requests } = host(t);
  await assert.rejects(handlers.settings({ threadId: 't1', approvalsReviewer: 'never' }), /无效/);
  approvals.snapshot = () => [{ threadId: 't1' }];
  await assert.rejects(handlers.settings({ threadId: 't1', approvalsReviewer: 'auto_review' }), { code: 'approval-pending' });
  assert.equal(requests.length, 0);
  approvals.snapshot = () => [];
  runtime.request = async () => { throw new Error('managed policy refused'); };
  await assert.rejects(handlers.settings({ threadId: 't1', approvalsReviewer: 'auto_review' }), /refused/);
  assert.equal(runtime.owns.get('t1').approvalsReviewer, 'user');
  assert.equal(store.get('t1').approvalsReviewer, undefined);
});
test('resume reads actual top-level settings, preserves a chosen reviewer and defaults new chats to user', async t => {
  const { runtime, handlers, store, requests } = host(t);
  store.set('t1', { approvalsReviewer: 'auto_review' });
  runtime.request = async (method, params) => { requests.push({ method, params }); return { thread: { id: 't1' }, model: 'actual-model', reasoningEffort: 'high', approvalsReviewer: params.approvalsReviewer }; };
  const resumed = await handlers.resume({ threadId: 't1' });
  assert.equal(resumed.settings.model, 'actual-model');
  assert.equal(resumed.settings.effort, 'high');
  assert.equal(resumed.presence.approvalsReviewer, 'auto_review');
  await handlers.start({ cwd: '/example' });
  assert.equal(requests.at(-1).params.approvalsReviewer, 'user');
});

async function dom(t) {
  const env = new JSDOM('<div id="root"></div>', { url: 'https://localhost/' });
  globalThis.window = env.window; globalThis.document = env.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); env.window.close(); });
  return root;
}
const click = async label => {
  const button = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  assert.ok(button, `Missing ${label}`); await act(async () => button.click());
};
const models = [
  { id: 'example', displayName: 'Example', reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' },
  { id: 'next', model: 'next-model', displayName: 'Next', reasoningEfforts: ['medium'], defaultReasoningEffort: 'medium' },
];
const props = { threadId: 't1', draft: 'hello', setDraft: () => {}, attachments: [], setAttachments: () => {}, models, modelId: 'example', modelLabel: 'Example', effort: 'high', reviewer: 'user' };
test('approval and model menus reflect committed settings and support Escape, outside click and keyboard focus', async t => {
  const root = await dom(t); const changes = [];
  function Harness() {
    const [settings, setSettings] = React.useState({ model: 'example', effort: 'high', approvalsReviewer: 'user' });
    return h(Composer, { ...props, modelId: settings.model, reviewer: settings.approvalsReviewer, effort: settings.effort,
      onApplySettings: async patch => { changes.push(patch); setSettings(previous => ({ ...previous, ...patch })); return true; } });
  }
  await act(async () => root.render(h(Harness)));
  await click('审批方式');
  assert.match(document.querySelector('[role="menu"]').textContent, /应如何批准/);
  assert.equal(document.activeElement.getAttribute('aria-checked'), 'true');
  await act(async () => document.querySelector('[role="menuitemradio"][aria-checked="false"]').click());
  assert.deepEqual(changes.at(-1), { approvalsReviewer: 'auto_review' });
  assert.equal(document.querySelector('[aria-label="审批方式"]').textContent, '帮我批准');
  await click('模型设置');
  await act(async () => [...document.querySelectorAll('[aria-label="推理档"] button')].find(node => node.textContent === '低').click());
  assert.deepEqual(changes.at(-1), { effort: 'low' });
  await click('模型设置');
  await click('Next');
  assert.deepEqual(changes.at(-1), { model: 'next-model', effort: 'medium' });
  await click('审批方式');
  await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.equal(document.activeElement.getAttribute('aria-label'), '审批方式');
  await click('模型设置');
  await act(async () => document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true })));
  assert.equal(document.querySelector('[role="menu"]'), null);
});
test('failed settings keep the old selection and attachment/queue actions remain available', async t => {
  const root = await dom(t); const calls = [];
  await act(async () => root.render(h(Composer, { ...props, onApplySettings: async () => false, onQueue: () => calls.push('queue'), onQueueList: () => calls.push('list') })));
  await click('审批方式');
  await act(async () => document.querySelector('[aria-checked="false"]').click());
  assert.ok(document.querySelector('[role="menu"]'));
  assert.equal(document.querySelector('[aria-label="审批方式"]').textContent, '请求批准');
  await click('添加内容');
  assert.match(document.querySelector('[role="menu"]').textContent, /添加图片/);
  await click('排队发送');
  await click('添加内容'); await click('查看队列');
  assert.deepEqual(calls, ['queue', 'list']);
  await click('语音输入');
  assert.match(document.querySelector('[role="alert"]').textContent, /DSH.*语音输入插件/);
});
test('changing only a reviewer preserves client model and reasoning state', async t => {
  const root = await dom(t); const patches = []; let actions;
  function Harness() {
    actions = useActions({ client: { settings: async () => ({ settings: { approvalsReviewer: 'auto_review' } }) }, setBusy: () => {},
      runtimeMap: { t1: { settings: { model: 'example', effort: 'high', approvalsReviewer: 'user' } } },
      setThreadRuntime: (_id, patch) => patches.push(patch), pushNotice: () => {} }); return null;
  }
  await act(async () => root.render(h(Harness)));
  await actions.applySettings('t1', { approvalsReviewer: 'auto_review' });
  assert.deepEqual(patches.at(-1).settings, { model: 'example', effort: 'high', approvalsReviewer: 'auto_review' });
});

const catalog = { maxAudioBytes: 320044, maxDurationSeconds: 10, selection: { providerId: 'dsh-local', language: 'auto' }, providers: [{ id: 'dsh-local', preparation: { phase: 'ready' } }] };
test('voice uses the DSH provider selection and fills a draft without sending', async t => {
  const root = await dom(t); let voice, sent; let cancelled = 0;
  const client = { speech: () => ({ catalog: async () => ({ ok: true, value: catalog }), transcribe: async (params, signal) => { sent = { params, signal }; return { ok: true, value: { text: '  语音文字  ' } }; } }) };
  function Harness() {
    const [draft, setDraft] = React.useState('原有草稿');
    voice = useVoiceInput({ client, threadId: 't1', capture: async () => ({ cancel: () => cancelled++, finish: async seconds => { assert.equal(seconds, 10); return waveBytes(new Float32Array([0, 1, -1])); } }),
      onText: text => setDraft(previous => `${previous}\n${text}`) });
    return h('textarea', { value: draft, readOnly: true });
  }
  await act(async () => root.render(h(Harness)));
  await act(async () => voice.start()); assert.equal(voice.phase, 'recording');
  await act(async () => voice.finish());
  assert.equal(voice.phase, 'idle');
  assert.equal(document.querySelector('textarea').value, '原有草稿\n语音文字');
  assert.equal(sent.params.providerId, 'dsh-local'); assert.equal(sent.params.language, 'auto');
  const bytes = Buffer.from(sent.params.audioBase64, 'base64');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.readUInt32LE(24), 16000); assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(cancelled, 1);
});
test('changing chats aborts transcription and ignores a late result', async t => {
  const root = await dom(t); let voice, setThread, resolveText, signal; const text = []; let cancelled = 0;
  const client = { speech: () => ({ catalog: async () => ({ ok: true, value: catalog }), transcribe: (_params, value) => { signal = value; return new Promise(resolve => { resolveText = resolve; }); } }) };
  function Harness() {
    const [threadId, update] = React.useState('t1'); setThread = update;
    voice = useVoiceInput({ client, threadId, capture: async () => ({ cancel: () => cancelled++, finish: async () => waveBytes(new Float32Array([0])) }), onText: value => text.push(value) }); return null;
  }
  await act(async () => root.render(h(Harness)));
  await act(async () => voice.start());
  let pending; await act(async () => { pending = voice.finish(); });
  await act(async () => setThread('t2'));
  assert.equal(signal.aborted, true); assert.equal(cancelled, 1);
  await act(async () => { resolveText({ ok: true, value: { text: 'late text' } }); await pending; });
  assert.deepEqual(text, []); assert.equal(voice.phase, 'idle');
});
test('an unprepared DSH provider never opens the microphone or downloads a model', async t => {
  const root = await dom(t); let voice, captures = 0;
  const client = { speech: () => ({ catalog: async () => ({ ok: true, value: { ...catalog, providers: [{ id: 'dsh-local', preparation: { phase: 'unprepared' } }] } }) }) };
  function Harness() { voice = useVoiceInput({ client, threadId: 't1', onText: () => assert.fail('must not fill a draft'), capture: async () => { captures++; } }); return null; }
  await act(async () => root.render(h(Harness)));
  await act(async () => voice.start());
  assert.equal(captures, 0); assert.equal(voice.phase, 'idle'); assert.match(voice.error, /尚未就绪/);
});
test('cancelling while permission is pending stops the late microphone stream', async t => {
  await dom(t); let resolveStream, stops = 0;
  Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia: () => new Promise(resolve => { resolveStream = resolve; }) } });
  window.MediaRecorder = class { constructor() { throw new Error('must not record after cancellation'); } };
  window.AudioContext = class {}; window.OfflineAudioContext = class {};
  const controller = new AbortController(); const pending = openCapture({ signal: controller.signal });
  controller.abort(); resolveStream({ getTracks: () => [{ stop: () => stops++ }] });
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(stops, 1);
});
