import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
const initialDOM = new JSDOM('<html></html>');
globalThis.window = initialDOM.window; globalThis.document = initialDOM.window.document;
const { createRoot } = await import('react-dom/client');
initialDOM.window.close();
import { Panel } from '../client/panel.js';
import { Conversation } from '../client/conversation.js';
import { ApprovalCard } from '../client/components/approval.js';
import { useEvents } from '../client/hooks/use-events.js';
import { mergeLiveItems } from '../client/helpers.js';
import { TurnBlock } from '../client/components/turns.js';
import { createListCache } from '../client/list-cache.js';
import { useSessionList } from '../client/hooks/use-session-list.js';
import { useConversationSync, mergeRecentTurns } from '../client/hooks/use-conversation-sync.js';

const h = React.createElement;
function dom(t) {
  const env = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  globalThis.window = env.window; globalThis.document = env.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); env.window.close(); });
  return root;
}
const navigation = { projects: [{ id: 'project-a', nativeId: 'project-a', name: 'Example project', roots: ['/example/project'], pinned: true }], sections: [] };
const meta = { projectId: 'project-a', id: 't1', title: 'Example conversation', cwd: '/example/project', turnCount: 1 };
const turns = [{ id: 'turn-1', status: 'completed', items: [{ id: 'a', type: 'agentMessage', text: 'Example response' }, { id: 'tool', type: 'commandExecution', command: 'git status', aggregatedOutput: 'clean' }] }];
const client = {
  health: async () => ({ status: 'connected', detail: '已连接' }),
  models: async () => ({ data: [{ id: 'example', displayName: 'Example model', reasoningEfforts: ['low', 'high'] }] }),
  list: async () => ({ navigation, data: [{ ...meta, sourceKind: 'cli', updatedAt: 100 }] }),
  read: async () => meta,
  turns: async () => ({ turns }),
  events: (_payload, signal) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })), { once: true }); }),
};
const click = async text => {
  const button = [...document.querySelectorAll('button')].find(el => el.textContent === text || el.getAttribute('aria-label') === text);
  assert.ok(button, `Missing button: ${text}`);
  await act(async () => button.click());
};
test('panel renders lists and read-only preview without a composer', async t => {
  const root = dom(t);
  await act(async () => root.render(h(Panel, { client })));
  assert.ok(document.querySelector('.cp-thread-title'));
  await act(async () => document.querySelector('.cp-thread').click());
  assert.match(document.body.textContent, /Example response/);
  assert.match(document.body.textContent, /git status/);
  assert.equal(document.querySelector('textarea'), null);
  assert.match(document.body.textContent, /继续此聊天/);
});

test('cached list renders before health and fresh data replaces it without hiding the list', async t => {
  const root = dom(t); let healthReady, listReady, requests = 0;
  createListCache(window).write([{ ...meta, title: 'Cached title', presence: { owned: true, running: true } }], navigation);
  const api = { ...client, health: () => new Promise(resolve => { healthReady = resolve; }), list: () => { requests++; return new Promise(resolve => { listReady = resolve; }); } };
  await act(async () => root.render(h(Panel, { client: api })));
  assert.equal(requests, 0);
  assert.equal(document.querySelector('.cp-thread-title').textContent, 'Cached title');
  assert.equal(document.querySelector('.cp-thread [aria-label="运行中"]'), null);
  assert.match(document.querySelector('.cp-list-status').textContent, /已显示上次列表/);
  await act(async () => healthReady({ status: 'connected' }));
  assert.equal(requests, 1);
  const originalList = document.querySelector('.cp-list-scroll');
  await act(async () => document.querySelector('.cp-thread').click());
  assert.equal(document.querySelector('textarea'), null);
  await act(async () => listReady({ navigation, data: [{ ...meta, title: 'Updated title' }] }));
  assert.equal(document.querySelector('.cp-list-scroll'), originalList);
  assert.equal(document.querySelector('.cp-thread-title').textContent, 'Updated title');
  assert.ok(document.querySelector('.cp-thread.selected'));
  assert.equal(document.querySelector('.cp-list-status'), null);
  assert.equal(createListCache(window).read().items[0].title, 'Updated title');
  assert.equal(document.querySelector('[aria-label="收起聊天列表"]'), null);
  assert.equal(document.querySelectorAll('.cp-chat-header > svg').length, 0);
  assert.ok(document.querySelector('[aria-label="切换聊天列表"]'));
});

test('background refresh failure retains cached rows and retry reconciles removals', async t => {
  const root = dom(t); let calls = 0;
  createListCache(window).write([{ ...meta, title: 'Retained cached chat' }], navigation);
  const api = { ...client, list: async () => { if (++calls === 1) throw new Error('network failed'); return { navigation, data: [] }; } };
  await act(async () => root.render(h(Panel, { client: api })));
  const list = document.querySelector('.cp-list-scroll');
  assert.equal(document.querySelector('.cp-thread-title').textContent, 'Retained cached chat');
  assert.match(document.querySelector('.cp-list-status').textContent, /更新失败/);
  await click('重试');
  assert.equal(calls, 2);
  assert.equal(document.querySelector('.cp-list-scroll'), list);
  assert.equal(document.querySelector('.cp-thread-title'), null);
  assert.deepEqual(createListCache(window).read().items, []);
});

test('list requests deduplicate pagination and discard outdated filters and responses after unmount', async t => {
  const root = dom(t); let state, setFilter, setConnected, pending = [];
  const api = { list: (params, signal) => new Promise(resolve => pending.push({ params, signal, resolve })) };
  function Harness() {
    const [query, changeQuery] = React.useState('');
    const [connected, changeConnected] = React.useState(true);
    const [, setPresence] = React.useState({});
    setFilter = changeQuery; setConnected = changeConnected;
    state = useSessionList({ client: api, connected, query, cwd: '', archived: false, setPresence });
    return null;
  }
  await act(async () => root.render(h(Harness)));
  await act(async () => { void state.refreshList(); void state.refreshList(); });
  assert.equal(pending.length, 1);
  await act(async () => pending[0].resolve({ data: [{ ...meta, title: 'First' }], navigation, nextCursor: 'page-2' }));
  await act(async () => { void state.loadMore(); void state.loadMore(); });
  assert.equal(pending.length, 2);
  assert.equal(pending[1].params.cursor, 'page-2');
  await act(async () => setFilter('different'));
  assert.equal(pending[1].signal.aborted, true);
  assert.equal(state.items.length, 0);
  assert.equal(pending.length, 3);
  await act(async () => pending[2].resolve({ data: [{ ...meta, title: 'Filtered' }] }));
  await act(async () => pending[1].resolve({ data: [{ id: 'late', title: 'Outdated' }] }));
  assert.equal(state.items[0].title, 'Filtered');
  assert.equal(createListCache(window).read().items[0].title, 'First');
  await act(async () => setConnected(false));
  assert.equal(state.items[0].title, 'Filtered');
  await act(async () => setConnected(true));
  assert.equal(pending.length, 4);
  await act(async () => root.render(null));
  assert.equal(pending[3].signal.aborted, true);
  await act(async () => pending[3].resolve({ data: [{ id: 'late', title: 'After unmount' }] }));
  assert.equal(createListCache(window).read().items[0].title, 'First');
});

test('successful mutation refresh supersedes a list requested before the mutation', async t => {
  const root = dom(t); let state; const requests = [];
  const api = { list: (params, signal) => new Promise(resolve => requests.push({ params, signal, resolve })) };
  function Harness() {
    const [, setPresence] = React.useState({});
    state = useSessionList({ client: api, connected: true, query: '', cwd: '', archived: false, setPresence });
    return null;
  }
  await act(async () => root.render(h(Harness)));
  await act(async () => { void state.refreshList({ force: true }); });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  await act(async () => requests[1].resolve({ data: [{ ...meta, title: 'Renamed' }], navigation }));
  await act(async () => requests[0].resolve({ data: [{ ...meta, title: 'Before rename' }], navigation }));
  assert.equal(state.items[0].title, 'Renamed');
  assert.equal(createListCache(window).read().items[0].title, 'Renamed');
});
test('owned conversation renders settings, approvals and restores text and image drafts', async t => {
  const root = dom(t);
  let decide;
  await act(async () => root.render(h(Conversation, {
    client, threadId: 't1', connected: true, runtime: { presence: { owned: true, resumeSafe: false }, unsafe: { message: 'unknown' }, pendingDraft: { text: 'retained draft', images: ['/example/image.png'] } },
    approvals: [{ requestId: 'a', method: 'item/commandExecution/requestApproval', available: ['decline', 'cancel'] }], models: [{ id: 'example', displayName: 'Example model', reasoningEfforts: ['low', 'high'] }], notices: [], onDecide: (...args) => { decide = args; },
  })));
  await click('恢复草稿');
  assert.equal(document.querySelector('textarea').value, 'retained draft');
  assert.match(document.body.textContent, /image.png/);
  await click('拒绝');
  assert.deepEqual(decide, ['a', 'decline']);
  await click('模型设置');
  assert.match(document.body.textContent, /推理档/);
});

test('external preview updates while running without exposing composer or a takeover action', async t => {
  const root = dom(t); let revision = 0;
  const api = { ...client,
    turns: async () => ({ turns: [{ id: 'current', status: 'interrupted', items: [{ id: 'reply', type: 'agentMessage', text: 'Old snapshot' }] }] }),
    sync: async () => ({ revision: String(++revision), thread: { id: 't1', title: 'External task' }, observation: { source: 'shared', verified: true, state: 'running', activeFlags: ['waitingOnApproval'] }, turns: [{ id: 'current', status: 'inProgress', items: [{ id: 'reply', type: 'agentMessage', text: 'Live external update' }] }] }),
  };
  await act(async () => root.render(h(Conversation, { client: api, threadId: 't1', connected: true })));
  assert.match(document.body.textContent, /Live external update/);
  assert.match(document.body.textContent, /正在其他客户端运行/);
  assert.match(document.body.textContent, /等待原客户端审批/);
  assert.equal(document.body.textContent.includes('已中断'), false);
  assert.equal(document.querySelector('textarea'), null);
  assert.equal([...document.querySelectorAll('button')].find(button => button.textContent === '继续此聊天').disabled, true);
});

test('unverified history and broken observation keep messages without a false interrupted verdict', async t => {
  const root = dom(t);
  const api = { ...client,
    turns: async () => ({ turns: [{ id: 'current', status: 'interrupted', items: [{ id: 'reply', type: 'agentMessage', text: 'Retained history' }] }] }),
    sync: async () => { throw new Error('disconnected'); },
  };
  await act(async () => root.render(h(Conversation, { client: api, threadId: 't1', connected: true,
    live: { threadId: 't1', turnId: 'current', status: 'running', items: [{ id: 'obsolete', type: 'agentMessage', text: 'Obsolete replay' }] } })));
  assert.match(document.body.textContent, /Retained history/);
  assert.match(document.body.textContent, /实时状态未核实/);
  assert.match(document.body.textContent, /自动更新暂时失败/);
  assert.equal(document.body.textContent.includes('已中断'), false);
  assert.equal(document.body.textContent.includes('Obsolete replay'), false);
  assert.equal(document.querySelector('textarea'), null);
});

test('file links open a scoped resizable preview, preserve chat and restore focus on close', async t => {
  const root = dom(t); const requests = [];
  const api = { ...client,
    turns: async () => ({ turns: [{ id: 't', status: 'completed', items: [{ id: 'a', type: 'agentMessage', text: '[代码](src/app.js#L12-L13)\n\n[说明](docs/readme.md)\n\n[网站](https://example.com)' }] }] }),
    fileUrl: params => `/mock-files?${new URLSearchParams(params)}`,
    filePreview: async params => { requests.push(params); return { kind: 'text', name: 'app.js', path: '/example/project/src/app.js', text: 'line eleven\nline twelve\nline thirteen', startLine: 11, line: 12, endLine: 13 }; },
  };
  await act(async () => root.render(h(Conversation, { client: api, threadId: 't1', connected: true })));
  const anchor = [...document.querySelectorAll('a')].find(a => a.textContent === '代码');
  await act(async () => anchor.click());
  assert.equal(requests[0].threadId, 't1'); assert.equal(requests[0].href, 'src/app.js#L12-L13'); assert.equal(requests[0].baseDirectory, '/example/project');
  assert.ok(document.querySelector('.cp-message-agent'));
  assert.equal(document.querySelector('.cp-file-preview').getAttribute('role'), 'complementary');
  assert.equal(document.querySelectorAll('.cp-file-highlight').length, 2);
  assert.ok(document.querySelector('.cp-file-header a[download]'));
  const handle = document.querySelector('[role="separator"]');
  await act(async () => handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  assert.equal(document.querySelector('.cp-file-preview').style.width, '444px');
  await click('关闭文件预览');
  assert.equal(document.querySelector('.cp-file-preview'), null); assert.equal(document.activeElement, anchor);
  assert.equal([...document.querySelectorAll('a')].find(a => a.textContent === '网站').target, '_blank');
});

test('file drawer cancels old loads, scopes nested Markdown links and closes with Escape', async t => {
  const root = dom(t); Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  const pending = [];
  const api = { ...client, fileUrl: params => `/mock-files?${new URLSearchParams(params)}`,
    turns: async () => ({ turns: [{ id: 't', status: 'completed', items: [{ id: 'a', type: 'agentMessage', text: '[说明](docs/readme.md) [旧文件](old.txt)' }] }] }),
    filePreview: (params, signal) => new Promise(resolve => pending.push({ params, signal, resolve })),
  };
  await act(async () => root.render(h(Conversation, { client: api, threadId: 't1', connected: true })));
  const open = async text => act(async () => [...document.querySelectorAll('.cp-message-agent a')].find(a => a.textContent === text).click());
  await open('旧文件'); await open('说明');
  assert.equal(pending[0].signal.aborted, true);
  await act(async () => pending[1].resolve({ kind: 'markdown', name: 'readme.md', path: '/example/project/docs/readme.md', text: '# 文档\n\n[嵌套文件](../app.js)', startLine: 1 }));
  await act(async () => pending[0].resolve({ kind: 'text', name: 'old.txt', path: '/example/project/old.txt', text: 'Outdated response', startLine: 1 }));
  assert.equal(document.querySelector('.cp-file-preview').getAttribute('aria-modal'), 'true');
  assert.equal(document.querySelector('.cp-file-header strong').textContent, 'readme.md');
  assert.equal(document.body.textContent.includes('Outdated response'), false);
  await act(async () => document.querySelector('.cp-file-markdown a').click());
  assert.equal(pending[2].params.baseDirectory, '/example/project/docs');
  await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(document.querySelector('.cp-file-preview'), null); assert.equal(pending[2].signal.aborted, true);
});

test('snapshot polling is serial, resumes on focus and ignores responses after changing chats', async t => {
  const root = dom(t); let current, setThread; const requests = []; const applied = [];
  const api = { sync: (params, signal) => new Promise(resolve => requests.push({ params, signal, resolve })) };
  function Harness() {
    const [threadId, change] = React.useState('a'); setThread = change;
    current = useConversationSync({ client: api, threadId, enabled: true, owned: false, intervalMs: 10, onSnapshot: result => applied.push(result.revision) });
    return null;
  }
  await act(async () => root.render(h(Harness)));
  await act(async () => { window.dispatchEvent(new window.Event('focus')); window.dispatchEvent(new window.Event('focus')); });
  assert.equal(requests.length, 1);
  await act(async () => requests[0].resolve({ revision: 'one', observation: { verified: true, state: 'running' } }));
  await act(async () => new Promise(resolve => setTimeout(resolve, 25)));
  assert.equal(requests.length, 2); assert.equal(requests[1].params.revision, 'one');
  await act(async () => setThread('b'));
  assert.equal(requests[1].signal.aborted, true); assert.equal(requests.length, 3);
  await act(async () => requests[1].resolve({ revision: 'late', observation: { state: 'idle' } }));
  await act(async () => requests[2].resolve({ revision: 'two', observation: { verified: false, state: 'unknown' } }));
  assert.deepEqual(applied, ['one', 'two']); assert.equal(current.observation.state, 'unknown');
  await act(async () => root.render(null));
  const count = requests.length;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(requests.length, count);
  assert.deepEqual(mergeRecentTurns([{ id: 'older', items: [] }, { id: 'current', items: [] }], [{ id: 'next', items: [] }, { id: 'current', items: [{ id: 'new' }] }]).map(turn => turn.id), ['older', 'current', 'next']);
});
test('approval buttons carry complete structured decisions', async t => {
  const root = dom(t); let actual;
  const decision = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'status'] } };
  await act(async () => root.render(h(ApprovalCard, { request: { requestId: 'a', available: [decision, 'cancel'] }, onDecide: (id, value) => { actual = value; } })));
  await click('批准并记住规则');
  assert.deepEqual(actual, decision);
});
test('two running threads retain independent streamed text and pending approvals recover', async t => {
  const root = dom(t); let state;
  let count = 0;
  const eventsClient = { events: async (...args) => {
    if (count++) return client.events(...args);
    return { events: [
      { method: 'turn/started', params: { threadId: 'a', turn: { id: 'ta' } } },
      { method: 'turn/started', params: { threadId: 'b', turn: { id: 'tb' } } },
      { method: 'item/agentMessage/delta', params: { threadId: 'a', itemId: 'ia', delta: 'AAA' } },
      { method: 'item/agentMessage/delta', params: { threadId: 'b', itemId: 'ib', delta: 'BBB' } },
    ], lastSeq: 4, pendingApprovals: [{ requestId: 'pending' }], presence: { a: { owned: true }, b: { owned: true } } };
  } };
  const noop = React.useCallback; // Keep setters stable through actual state hooks.
  function Harness() {
    const [live, setLiveByThread] = React.useState({});
    const [presence, setPresence] = React.useState({});
    const [runtime, setRuntimeMap] = React.useState({});
    const [approvals, setApprovals] = React.useState([]);
    const pushNotice = noop(() => {}, []);
    useEvents({ client: eventsClient, connected: true, pushNotice, setLiveByThread, setPresence, setRuntimeMap, setApprovals });
    state = { live, presence, runtime, approvals };
    return null;
  }
  await act(async () => root.render(h(Harness)));
  assert.equal(state.live.a.deltas.ia, 'AAA');
  assert.equal(state.live.b.deltas.ib, 'BBB');
  assert.equal(state.approvals[0].requestId, 'pending');
});

test('turn and item event replay cannot grant control of an external thread', async t => {
  const root = dom(t); let current; let count = 0;
  const api = { events: async (...args) => count++ ? client.events(...args) : { events: [
    { method: 'turn/started', params: { threadId: 'foreign', turn: { id: 'turn' } } },
    { method: 'item/started', params: { threadId: 'foreign', item: { id: 'i', type: 'agentMessage', text: '' } } },
    { method: 'item/agentMessage/delta', params: { threadId: 'foreign', itemId: 'i', delta: 'Observed' } },
    { method: 'turn/completed', params: { threadId: 'foreign', turn: { id: 'turn', status: 'completed' } } },
  ], pendingApprovals: [], presence: { foreign: { owned: false, running: false } } } };
  function Harness() {
    const [live, setLiveByThread] = React.useState({}); const [presence, setPresence] = React.useState({});
    const [, setRuntimeMap] = React.useState({}); const [, setApprovals] = React.useState([]); const pushNotice = React.useCallback(() => {}, []);
    useEvents({ client: api, connected: true, pushNotice, setLiveByThread, setPresence, setRuntimeMap, setApprovals });
    current = { live, presence }; return null;
  }
  await act(async () => root.render(h(Harness)));
  assert.equal(current.presence.foreign.owned, false);
  assert.equal(current.presence.foreign.running, false);
  assert.equal(current.live.foreign.deltas.i, 'Observed');
});

test('historical reasoning leaves no rows or gaps between tool groups and messages', async t => {
  const root = dom(t);
  await act(async () => root.render(h(TurnBlock, { turn: { status: 'completed', items: [
    { id: 'empty', type: 'reasoning', summary: [], content: [] },
    { id: 'blank', type: 'reasoning', summary: [null, '  ', { text: '' }], content: [] },
    { id: 'command-1', type: 'commandExecution', command: 'first command' },
    { id: 'summary', type: 'reasoning', summary: ['**First section**', { text: 'Second section' }], content: ['raw text'] },
    { id: 'raw', type: 'reasoning', summary: [], content: ['Available raw content'] },
    { id: 'command-2', type: 'commandExecution', command: 'second command' },
    { id: 'reply', type: 'agentMessage', text: 'Final answer' },
  ] } })));
  assert.equal(document.querySelector('.cp-reasoning'), null);
  assert.equal(document.querySelectorAll('.cp-execution-group').length, 1);
  assert.match(document.querySelector('.cp-execution-group > summary').textContent, /执行了 2 项操作/);
  assert.equal(document.querySelector('.cp-message-agent').textContent, 'Final answer');
  assert.equal(document.body.textContent.includes('First section'), false);
  assert.equal(document.body.textContent.includes('Available raw content'), false);
});

test('reasoning displays only while streaming and disappears on completion, next work and reload', async t => {
  const root = dom(t); let deliver, state;
  const api = { events: (_params, signal) => new Promise((resolve, reject) => {
    deliver = resolve;
    signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })), { once: true });
  }) };
  function Harness() {
    const [live, setLiveByThread] = React.useState({});
    const [, setPresence] = React.useState({}); const [, setRuntimeMap] = React.useState({}); const [, setApprovals] = React.useState([]);
    const pushNotice = React.useCallback(() => {}, []);
    useEvents({ client: api, connected: true, pushNotice, setLiveByThread, setPresence, setRuntimeMap, setApprovals });
    state = live.a;
    return h(TurnBlock, { live: true, turn: { status: state?.status === 'running' ? 'inProgress' : state?.status, items: mergeLiveItems(state) } });
  }
  const emit = async events => act(async () => deliver({ events, pendingApprovals: [] }));
  const event = (method, params) => ({ method, params: { threadId: 'a', ...params } });
  await act(async () => root.render(h(Harness)));
  await emit([
    event('turn/started', { turn: { id: 'turn' } }),
    event('item/started', { item: { id: 'r', type: 'reasoning', summary: [], content: [] } }),
  ]);
  assert.equal(document.querySelector('.cp-reasoning'), null);
  await emit([
    event('item/reasoning/summaryTextDelta', { itemId: 'r', summaryIndex: 0, delta: 'First ' }),
    event('item/reasoning/summaryTextDelta', { itemId: 'r', summaryIndex: 0, delta: 'part' }),
    event('item/reasoning/summaryPartAdded', { itemId: 'r', summaryIndex: 1 }),
    event('item/reasoning/summaryTextDelta', { itemId: 'r', summaryIndex: 1, delta: 'Second part' }),
    event('item/reasoning/textDelta', { itemId: 'r', contentIndex: 0, delta: 'Raw content' }),
  ]);
  assert.deepEqual(mergeLiveItems(state)[0].summary, ['First part', 'Second part']);
  assert.deepEqual(mergeLiveItems(state)[0].content, ['Raw content']);
  assert.equal(document.querySelector('.cp-reasoning').open, true);
  assert.match(document.querySelector('.cp-reasoning').textContent, /First part\s+Second part/);
  assert.equal(document.querySelector('.cp-reasoning').textContent.includes('Raw content'), false);
  await emit([event('item/completed', { item: { id: 'r', type: 'reasoning', summary: ['Final summary'], content: [] } })]);
  assert.equal(state.reasoning.r, undefined);
  assert.deepEqual(state.items[0].summary, ['Final summary']);
  assert.equal(document.querySelector('.cp-reasoning'), null);
  await emit([event('item/reasoning/summaryTextDelta', { itemId: 'r', delta: 'Late delta' })]);
  assert.equal(document.querySelector('.cp-reasoning'), null);
  // A stream can arrive without its item/started notification.
  await emit([event('item/reasoning/summaryTextDelta', { itemId: 'next', delta: 'Next thought' })]);
  assert.equal(document.querySelector('.cp-reasoning .cp-markdown').textContent, 'Next thought');
  await emit([event('item/started', { item: { id: 'command', type: 'commandExecution', command: 'git status' } })]);
  assert.equal(document.querySelector('.cp-reasoning'), null);
  await emit([event('item/reasoning/summaryTextDelta', { itemId: 'next', delta: 'Late orphan delta' })]);
  assert.equal(document.querySelector('.cp-reasoning'), null);
  await emit([
    event('item/started', { item: { id: 'raw', type: 'reasoning', summary: [], content: [] } }),
    event('item/reasoning/textDelta', { itemId: 'raw', contentIndex: 0, delta: 'Available raw content' }),
  ]);
  assert.equal(document.querySelector('.cp-reasoning > summary').textContent, '思考过程');
  assert.equal(document.querySelector('.cp-reasoning .cp-markdown').textContent, 'Available raw content');
  await emit([event('turn/completed', { turn: { id: 'turn', status: 'completed', items: [] } })]);
  assert.equal(document.querySelector('.cp-reasoning'), null);
  // Reload the persisted item without any streaming state.
  await act(async () => root.render(h(TurnBlock, { turn: { items: state.items, status: 'completed' } })));
  assert.equal(document.querySelector('.cp-reasoning'), null);
});

const change = async (element, value) => {
  const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value); element.dispatchEvent(new window.Event('input', { bubbles: true })); });
};
test('project groups fold and progressively reveal older chats', async t => {
  const { SessionRows } = await import('../client/components/sessions.js');
  const { buildSessionRows } = await import('../client/helpers.js');
  const root = dom(t);
  const rows = buildSessionRows(Array.from({ length: 8 }, (_, i) => ({ id: `chat-${i}`, title: `Chat ${i}`, projectId: 'project-a', cwd: '/example/project', updatedAt: 10 - i })), { navigation });
  await act(async () => root.render(h(SessionRows, { rows, resetKey: '|||0', presenceOf: () => null, occupiedOf: () => false, onSelect: () => {} })));
  assert.equal(document.querySelectorAll('.cp-thread').length, 5);
  await click('展开显示 · 3');
  assert.equal(document.querySelectorAll('.cp-thread').length, 8);
  await act(async () => document.querySelector('.cp-group').click());
  assert.equal(document.querySelectorAll('.cp-thread').length, 0);
  await act(async () => document.querySelector('.cp-group').click());
  assert.equal(document.querySelectorAll('.cp-thread').length, 8);
});
test('draft text survives switching chats', async t => {
  const root = dom(t);
  const own = { owned: true, resumeSafe: true };
  const api = { ...client, list: async () => ({ navigation, data: ['t1', 't2'].map(id => ({ ...meta, id, title: id, presence: own })) }), read: async ({ threadId }) => ({ ...meta, id: threadId, presence: own }) };
  await act(async () => root.render(h(Panel, { client: api })));
  await act(async () => document.querySelectorAll('.cp-thread')[0].click());
  await change(document.querySelector('textarea'), 'unsent draft');
  assert.equal(document.querySelector('textarea').value, 'unsent draft');
  await act(async () => document.querySelectorAll('.cp-thread')[1].click());
  assert.equal(document.querySelector('textarea').value, '');
  await act(async () => document.querySelectorAll('.cp-thread')[0].click());
  assert.equal(document.querySelector('textarea').value, 'unsent draft');
});
test('new chat uses a directory dialog and preserves the newly selected thread', async t => {
  const root = dom(t); let started;
  const api = { ...client, start: async value => { started = value; return { thread: { ...meta, id: 'new' }, presence: { owned: true, resumeSafe: true } }; } };
  await act(async () => root.render(h(Panel, { client: api })));
  await act(async () => document.querySelector('.cp-new-chat').click());
  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog);
  await change(dialog.querySelector('input'), '/example/new-project');
  await act(async () => dialog.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.deepEqual(started, { cwd: '/example/new-project' });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(document.querySelector('textarea'));
});
test('execution output is collapsed and Markdown renders code and tables safely', async t => {
  const { TurnBlock } = await import('../client/components/turns.js');
  const root = dom(t);
  await act(async () => root.render(h(TurnBlock, { turn: { status: 'completed', items: [
    { id: 'tool', type: 'commandExecution', command: 'git status', aggregatedOutput: 'private command output' },
    { id: 'agent', type: 'agentMessage', text: '**Ready**\n\n|A|B|\n|-|-|\n|1|2|\n\n```js\nconst result = 1;\n```\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))' },
  ] } })));
  assert.equal(document.querySelector('.cp-execution-group').open, false);
  assert.equal(document.querySelector('.cp-tool-detail').open, false);
  assert.ok(document.querySelector('strong'));
  assert.ok(document.querySelector('table'));
  assert.ok(document.querySelector('pre code'));
  assert.equal(document.querySelector('script'), null);
  assert.ok(!document.querySelector('a').href.startsWith('javascript:'));
});
test('composer maps Enter to send or steer, preserves IME and exposes stop while running', async t => {
  const { Composer } = await import('../client/components/composer.js');
  const root = dom(t); const calls = [];
  const props = { draft: 'continue', setDraft: () => {}, attachments: [], setAttachments: () => {}, onSend: () => calls.push('send'), onSteer: () => calls.push('steer'), onInterrupt: () => calls.push('stop') };
  await act(async () => root.render(h(Composer, props)));
  const enter = async options => act(async () => document.querySelector('textarea').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...options })));
  await enter({ shiftKey: true }); await enter({ isComposing: true });
  assert.deepEqual(calls, []);
  await enter({}); assert.deepEqual(calls, ['send']);
  await act(async () => root.render(h(Composer, { ...props, running: true })));
  await enter({}); await click('中断');
  assert.deepEqual(calls, ['send', 'steer', 'stop']);
});
test('browsing history does not jump for new output and exposes return to latest', async t => {
  const { TurnList } = await import('../client/components/turns.js');
  const root = dom(t);
  const props = { turns: Array.from({ length: 10 }, (_, index) => ({ id: `turn-${index}`, items: [{ id: index, type: 'agentMessage', text: `Message ${index}` }], status: 'completed' })), threadId: 't1' };
  await act(async () => root.render(h(TurnList, props)));
  const el = document.querySelector('.cp-turn-scroll');
  Object.defineProperties(el, { clientHeight: { value: 400 }, scrollHeight: { value: 2200 } });
  await act(async () => { el.scrollTop = 200; el.dispatchEvent(new window.Event('scroll', { bubbles: true })); });
  // Consume the programmatic initial scroll marker before simulating the user's next scroll.
  await act(async () => { el.scrollTop = 150; el.dispatchEvent(new window.Event('scroll', { bubbles: true })); });
  assert.ok(document.querySelector('.cp-jump-bottom'));
  await act(async () => root.render(h(TurnList, { ...props, liveTurn: { id: 'new', status: 'inProgress', items: [{ id: 'new-item', type: 'agentMessage', text: 'New output' }] } })));
  assert.equal(el.scrollTop, 150);
  await click('回到最新消息'); assert.equal(el.scrollTop, 1800);
});

test('built DSH module opens Markdown chats using the host React 18 renderer', async t => {
  const root = dom(t);
  assert.equal(React.version,'18.3.1');
  const { readFile } = await import('node:fs/promises');
  const { runInThisContext } = await import('node:vm');
  let plugin, Main; const crashes = [];
  window.__ModuleLoader__ = { load(config) { plugin = config.factory(id => { assert.equal(id,'react'); return React; }); } };
  const bundle = await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
  assert.equal(bundle.includes('react.transitional.element'),false);
  runInThisContext(bundle,{filename:'dsh-installed-client.js'});
  const api = { ...client, turns: async () => ({turns:[{id:'t',status:'completed',items:[{id:'i',type:'agentMessage',text:'**Compatible**\n\n|A|B|\n|-|-|\n|1|2|\n\n```js\nconst value = 1;\n```'}]}]}) };
  const cleanup = [];
  plugin.apply({
    connection:{rpc:{call:async (_path,_endpoint,{method,payload},signal)=>({result:{ok:true,value:await api[method](payload,signal)}})}},
    slots:{inject:(_name,fn)=>fn(),register(options,component){if(options.name==='main')Main=component;return()=>{};}},
    effect:fn=>cleanup.push(fn()),
  });
  t.after(()=>cleanup.forEach(dispose=>dispose?.()));
  class Boundary extends React.Component {
    state={error:null};
    static getDerivedStateFromError(error){return {error};}
    componentDidCatch(error){crashes.push(error);}
    render(){return this.state.error?h('div',null,'crashed'):this.props.children;}
  }
  await act(async()=>root.render(h(Boundary,null,h(Main))));
  await act(async()=>document.querySelector('.cp-thread').click());
  assert.deepEqual(crashes,[]);
  assert.equal(document.querySelector('.cp-message-agent .cp-markdown strong').textContent,'Compatible');
  assert.ok(document.querySelector('.cp-markdown table'));
  assert.match(document.querySelector('.cp-markdown code').textContent,/const value = 1/);
});

test('turn measurement disconnects ResizeObservers under React 18', async t => {
  const root=dom(t); const {TurnList}=await import('../client/components/turns.js');let created=0,disconnected=0;
  globalThis.ResizeObserver=class {constructor(){created++;}observe(){}disconnect(){disconnected++;}};
  t.after(()=>{delete globalThis.ResizeObserver;});
  await act(async()=>root.render(h(TurnList,{turns,threadId:'t1'})));
  assert.ok(created>0);
  await act(async()=>root.render(null));
  assert.equal(disconnected,created);
});
