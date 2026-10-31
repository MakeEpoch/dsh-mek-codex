import React from 'react';
import { createRoot } from 'react-dom/client';
const threads = [
  { projectId: 'preview-project', id: 'example-a', title: '审查工作区与发布准备', cwd: '/example/workspace', sourceKind: 'cli', updatedAt: Date.now() / 1000 },
  { projectId: 'preview-other', id: 'example-b', title: '检查插件兼容性', cwd: '/example/plugins', sourceKind: 'appServer', updatedAt: Date.now() / 1000 - 600 },
];
const showcase = new URLSearchParams(location.search).has('showcase');
const navigation = { projects: [{id:'preview-project',nativeId:'preview-project',name:'示例项目',roots:['/example/workspace'],pinned:true},{id:'preview-other',nativeId:'preview-other',name:'插件开发',roots:['/example/plugins']}], sections:[] };
const presence = showcase ? { 'example-a': { owned: true, resumeSafe: true } } : {};
const history = [{ id: 'example-turn', status: 'completed', items: [
  { id: 'u', type: 'userMessage', content: [{ type: 'text', text: '请检查插件结构，并说明发布前要确认什么。' }] },
  { id: 'comment', type: 'agentMessage', text: '我会先检查模块职责和接口边界，再核对构建与发布内容。' },
  { id: 'c', type: 'commandExecution', command: 'npm run check', aggregatedOutput: 'Client bundle matches source', status: 'completed' },
  { id: 'c2', type: 'commandExecution', command: 'npm test', aggregatedOutput: 'All example checks passed', status: 'completed' },
  { id: 'a', type: 'agentMessage', text: '**检查完成。** 当前示例的模块职责与发布路径已经整理清楚。\n\n- 运行时、审批和状态管理各自独立。\n- 对话默认展示正文，执行细节可以按需展开。\n- 发行包需要核对依赖、版本及兼容接口。\n\n下一步会先确认验证结果，再生成可安装的发行包。' },
] }];
let pendingApprovals = [];
const rpc = async (method, payload, signal) => {
  switch (method) {
    case 'health': return { status: 'connected', detail: '已连接', codexVersion: 'preview', ownedThreads: Object.keys(presence) };
    case 'models': return { data: [{ id: 'example-model', displayName: 'Example model', reasoningEfforts: ['low', 'high'] }] };
    case 'list': return { navigation, data: threads.filter(t => !payload.searchTerm || t.title.includes(payload.searchTerm)).map(t => ({ ...t, presence: presence[t.id] })) };
    case 'read': return { ...threads.find(t => t.id === payload.threadId), turnCount: history.length, presence: presence[payload.threadId] };
    case 'turns': return { turns: history };
    case 'resume': presence[payload.threadId] = { owned: true, resumeSafe: true }; return { presence: presence[payload.threadId] };
    case 'release': delete presence[payload.threadId]; return { note: '已释放预览会话' };
    case 'presence': return { presence };
    case 'settings': return {};
    case 'send': pendingApprovals = [{ requestId: 'preview-approval', threadId: payload.threadId, method: 'item/commandExecution/requestApproval', command: 'npm run check', cwd: '/example/workspace', reason: '确认后执行检查', available: ['accept', 'decline', 'cancel'] }]; return { turnId: 'preview-send' };
    case 'approval.decide': pendingApprovals = []; return {};
    case 'queue.add': return {};
    case 'queue.list': return { data: [] };
    case 'events': return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ events: [], lastSeq: 0, pendingApprovals, presence }), 500);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
    });
    default: return {};
  }
};
const root = createRoot(document.getElementById('root'));
window.__ModuleLoader__ = { load(config) {
  const plugin = config.factory(id => { if (id === 'react') return React; throw new Error(id); });
  plugin.apply({
    connection: { rpc: { call: async (_path, _endpoint, { method, payload }, signal) => ({ result: { ok: true, value: await rpc(method, payload, signal) } }) } },
    slots: { inject: (_name, fn) => fn(), register(options, component) { if (options.name === 'main') root.render(React.createElement(component)); return () => {}; } },
    effect: fn => fn(),
  });
} };
await import('/plugin.js');

if (showcase) {
  const observer = new MutationObserver(() => {
    const first = document.querySelector('.cp-thread');
    if (first) { observer.disconnect(); first.click(); }
  });
  observer.observe(document.getElementById('root'), { childList: true, subtree: true });
}
