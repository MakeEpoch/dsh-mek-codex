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
  assert.equal(document.querySelector('.cp-markdown strong').textContent,'Compatible');
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
