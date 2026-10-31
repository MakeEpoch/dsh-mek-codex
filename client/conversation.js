import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TURNS_PAGE_SIZE } from './constants.js';
import { sourceLabel, basename, mergeLiveItems } from './helpers.js';
import { Center, ErrorBox, NoticeBox, SkeletonRows } from './components/common.js';
import { TurnList } from './components/turns.js';
import { ApprovalCard } from './components/approval.js';
import { Composer } from './components/composer.js';
import { Dialog } from './components/dialog.js';
import { Icon } from './components/icon.js';
const h = React.createElement;

export function Conversation({ client, threadId, connected, occupied, runtime, live, approvals = [], models = [], notices = [], onResume, onRelease, onSend, onSteer, onInterrupt, onQueue, onQueueList, onRefreshReconcile, onDismissNotice, onDecide, onApplySettings, onRename, onArchive, onUnarchive, onDelete, archivedView, onToggleSidebar, onNewThread, draftSnapshot, onDraftChange, globalBusy }) {
  const [meta, setMeta] = useState(null);
  const [turns, setTurns] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(draftSnapshot?.text ?? '');
  const [attachments, setAttachments] = useState(draftSnapshot?.attachments ?? []);
  const [localBusy, setLocalBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [modelDraft, setModelDraft] = useState('');
  const [effortDraft, setEffortDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const loadGeneration = useRef(0);
  const busy = localBusy || globalBusy;
  const presence = runtime?.presence ?? meta?.presence;
  const owned = Boolean(presence?.owned);
  const running = Boolean(presence?.running || live?.threadId === threadId && live?.status === 'running');
  const unsafe = runtime?.unsafe ?? (presence?.resumeSafe === false ? { message: '上一轮发送尚未确认' } : null);
  const pendingDraft = runtime?.pendingDraft;
  const selectedModel = modelDraft || runtime?.settings?.model || models.find(model => model.isDefault)?.id || models[0]?.id || '';
  const model = models.find(model => model.id === selectedModel || model.model === selectedModel);
  const closeSettings = useCallback(() => setShowSettings(false), []);

  const load = useCallback(async () => {
    if (!threadId) return;
    const generation = ++loadGeneration.current;
    setLoading(true); setError('');
    try {
      const [info, page] = await Promise.all([client.read({ threadId }), client.turns({ threadId, limit: TURNS_PAGE_SIZE, view: 'full' })]);
      if (generation !== loadGeneration.current) return;
      setMeta(info); setTurns([...(page.turns ?? [])].reverse()); setCursor(page.nextCursor ?? null);
    } catch (cause) { if (generation === loadGeneration.current) setError(cause.message || String(cause)); }
    finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [client, threadId]);
  useEffect(() => { void load(); return () => { loadGeneration.current++; }; }, [load, runtime?.turnCount]);
  useEffect(() => { if (threadId) onDraftChange?.(threadId, { text: draft, attachments }); }, [threadId, draft, attachments, onDraftChange]);
  const loadOlder = useCallback(async () => {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await client.turns({ threadId, cursor, limit: TURNS_PAGE_SIZE, view: 'full' });
      setTurns(previous => {
        const seen = new Set(previous.map(turn => turn.id));
        return [...[...(page.turns ?? [])].reverse().filter(turn => !seen.has(turn.id)), ...previous];
      });
      setCursor(page.nextCursor ?? null);
    } catch (cause) { setError(cause.message || String(cause)); }
    finally { setLoadingOlder(false); }
  }, [client, threadId, cursor, loadingOlder]);

  const pickFiles = async files => {
    setLocalBusy(true);
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
        if (file.size > 4 * 1024 * 1024) throw new Error('每张图片不能超过 4 MiB');
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
        const image = await client.upload({ name: file.name, dataBase64: data });
        setAttachments(previous => [...previous, image]);
      }
    } catch (cause) { setError(`图片上传失败：${cause.message}`); }
    finally { setLocalBusy(false); }
  };
  const send = async () => {
    if (busy || unsafe || !draft.trim() && !attachments.length) return;
    setLocalBusy(true);
    try { if (await onSend(threadId, draft, attachments)) { setDraft(''); setAttachments([]); } }
    finally { setLocalBusy(false); }
  };
  const steer = async () => {
    if (busy || !draft.trim()) return;
    if (await onSteer(threadId, draft)) setDraft('');
  };
  const queue = async () => { if (await onQueue(threadId, draft)) setDraft(''); };
  const menuAction = (event, action) => { const el = event.currentTarget.closest('details'); if (el) el.open = false; action(); };
  const copyId = async () => { try { await navigator.clipboard.writeText(threadId); setCopied(true); } catch { setCopied(false); } };
  const liveTurn = live?.threadId === threadId ? { id: live.turnId ?? 'live', status: live.status === 'running' ? 'inProgress' : live.status, items: mergeLiveItems(live) } : null;

  const header = h('header', { className: 'cp-chat-header' },
    h('button', { className: 'cp-icon-btn', onClick: onToggleSidebar, 'aria-label': '切换聊天列表', title: '切换聊天列表' }, h(Icon, { name: 'sidebar' })),
    h(Icon, { name: 'folder', size: 16 }), h('div', { className: 'cp-chat-heading' }, h('h2', null, meta?.title || (threadId ? '正在打开聊天…' : 'Codex')), meta?.cwd ? h('span', { title: meta.cwd }, basename(meta.cwd)) : null),
    h('span', { className: 'cp-spacer' }),
    running ? h('span', { className: 'cp-subtle-state' }, h('span', { className: 'cp-spinner' }), '处理中') : null,
    threadId ? h('details', { className: 'cp-menu' }, h('summary', { 'aria-label': '会话操作', title: '会话操作' }, h(Icon, { name: 'more' })),
      h('div', { className: 'cp-popover' },
        h('button', { onClick: event => menuAction(event, () => setShowDetails(value => !value)) }, '会话详情'),
        h('button', { onClick: event => menuAction(event, () => void load()) }, '刷新聊天记录'),
        h('button', { onClick: event => menuAction(event, () => onRename(threadId)) }, '重命名'),
        h('button', { onClick: event => menuAction(event, () => archivedView ? onUnarchive(threadId) : onArchive(threadId)) }, archivedView ? '取消归档' : '归档'),
        owned ? h('button', { onClick: event => menuAction(event, () => onRelease(threadId)) }, '释放会话') : null,
        h('button', { className: 'danger', onClick: event => menuAction(event, () => onDelete(threadId)) }, '删除聊天'))) : null);

  return h('section', { className: 'cp-preview' }, header,
    showDetails ? h('div', { className: 'cp-chat-details' },
      h('span', null, `目录：${meta?.cwd ?? '—'}`), h('span', null, `来源：${sourceLabel(meta?.sourceKind)}`),
      h('span', null, `轮次：${meta?.turnCount ?? 0}${meta?.turnCountTruncated ? '+' : ''}`),
      h('span', { className: 'cp-thread-id' }, threadId), h('button', { className: 'cp-link', onClick: copyId }, copied ? '已复制' : '复制 ID'),
      h('span', null, owned ? '已接入本面板' : occupied ? '可能被其他客户端使用' : '历史预览')) : null,
    notices.length ? h('div', { className: 'cp-notices' }, notices.map((notice, index) => h(NoticeBox, { key: index, onDismiss: () => onDismissNotice?.(index) }, notice))) : null,
    !threadId ? h('div', { className: 'cp-welcome' }, h('div', { className: 'cp-welcome-mark' }, h(Icon, { name: 'command', size: 32 })), h('h1', null, '开始一段新的协作'), h('p', null, '选择项目中的聊天继续，或创建新聊天。'), h('button', { className: 'cp-btn primary', onClick: onNewThread, disabled: !connected }, h(Icon, { name: 'plus', size: 16 }), '新聊天')) :
      h(React.Fragment, null,
        h('div', { className: 'cp-preview-body' }, loading && !meta ? h(SkeletonRows, { count: 5 }) : error ? h(ErrorBox, { message: error, onRetry: load }) : !turns.length && !liveTurn ? h(Center, { title: '有什么想一起完成的？' }, owned ? '在下方描述任务，Codex 会在当前项目中继续。' : '继续聊天后，可以在当前项目中协作。') :
          h(TurnList, { turns, liveTurn, livePlan: live?.plan, threadId, hasOlder: Boolean(cursor), loadingOlder, onLoadOlder: loadOlder })),
        approvals.length ? h('div', { className: 'cp-approvals', 'aria-label': '待审批请求' }, h('div', { className: 'cp-approval-heading' }, '需要你的决定', h('span', null, `${approvals.length} 项`)), approvals.map(request => h(ApprovalCard, { key: request.requestId, request, busy, onDecide }))) : null,
        owned ? h(React.Fragment, null,
          unsafe ? h('div', { className: 'cp-unsafe-banner', role: 'status' }, h('div', null, h('strong', null, '发送结果待确认'), h('span', null, `${unsafe.message}。草稿已保留，不会自动重发。`)),
            pendingDraft ? h('button', { className: 'cp-link', onClick: () => { setDraft(pendingDraft.text ?? ''); setAttachments((pendingDraft.images ?? []).map(path => ({ path, name: basename(path) }))); } }, '恢复草稿') : null,
            h('button', { className: 'cp-btn', onClick: () => onRefreshReconcile(threadId), disabled: busy }, '刷新核对')) : null,
          h(Composer, { draft, setDraft, attachments, setAttachments, busy, running, blocked: Boolean(unsafe) || !connected, modelLabel: model?.displayName ?? runtime?.settings?.model, effortLabel: runtime?.settings?.effort, queueCount: runtime?.queueCount, onSend: send, onSteer: steer, onQueue: queue, onQueueList: () => onQueueList(threadId), onInterrupt: () => onInterrupt(threadId), onFiles: pickFiles, onSettings: () => setShowSettings(true) })) :
          h('div', { className: 'cp-readonly-banner' }, h('div', null, h('strong', null, '历史预览'), h('span', null, '继续后将在原 Codex 聊天中协作。')), h('button', { className: 'cp-btn primary', disabled: !connected || busy, onClick: () => onResume(threadId) }, '继续此聊天'))),
    showSettings && owned ? h(Dialog, { title: '模型与推理', onClose: closeSettings },
      models.length ? h('form', { onSubmit: async event => { event.preventDefault(); if (await onApplySettings(threadId, { model: selectedModel, effort: effortDraft || undefined })) setShowSettings(false); } },
        h('label', null, '模型', h('select', { className: 'cp-select', value: selectedModel, onChange: event => { setModelDraft(event.target.value); setEffortDraft(''); } }, models.map(item => h('option', { key: item.id, value: item.id }, item.displayName)))),
        h('label', null, '推理档', h('select', { className: 'cp-select', value: effortDraft, onChange: event => setEffortDraft(event.target.value) }, h('option', { value: '' }, '默认推理档'), (model?.reasoningEfforts ?? []).map(effort => h('option', { key: effort, value: effort }, effort)))),
        h('p', { className: 'cp-dialog-hint' }, '命令执行与文件修改由你审批。'), h('div', { className: 'cp-dialog-actions' }, h('button', { type: 'button', className: 'cp-btn', onClick: closeSettings }, '取消'), h('button', { className: 'cp-btn primary', disabled: busy }, '应用')))
        : h('p', null, '模型列表暂不可用，请稍后重试。')) : null);
}
