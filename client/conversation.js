import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TURNS_PAGE_SIZE } from './constants.js';
import { sourceLabel, basename, mergeLiveItems } from './helpers.js';
import { Center, ErrorBox, NoticeBox, SkeletonRows } from './components/common.js';
import { TurnList } from './components/turns.js';
import { ApprovalCard } from './components/approval.js';
import { Composer } from './components/composer.js';
import { Icon } from './components/icon.js';
import { FilePreview } from './components/file-preview.js';
import { FileContext } from './file-context.js';
import { useConversationSync, mergeRecentTurns } from './hooks/use-conversation-sync.js';
import { sendWarning } from './send-state.js';
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
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fileTarget, setFileTarget] = useState(null);
  const [fileWidth, setFileWidth] = useState(420);
  const fileTrigger = useRef(null);
  const openFile = useCallback((target, element) => { fileTrigger.current = element; setFileTarget(target); }, []);
  const closeFile = useCallback(() => { setFileTarget(null); if (fileTrigger.current?.isConnected) fileTrigger.current.focus(); }, []);
  const fileUrl = useCallback(params => client.fileUrl({ threadId, ...params }), [client, threadId]);
  const loadGeneration = useRef(0);
  const busy = localBusy || globalBusy;
  const presence = runtime?.presence ?? meta?.presence;
  const owned = Boolean(presence?.owned);
  const unsafe = sendWarning(presence, runtime?.unsafe);
  const pendingDraft = runtime?.pendingDraft;
  const selectedModel = presence?.model || runtime?.settings?.model || models.find(model => model.isDefault)?.id || models[0]?.id || '';
  const model = models.find(model => model.id === selectedModel || model.model === selectedModel);
  const effort = presence?.effort ?? runtime?.settings?.effort ?? model?.defaultReasoningEffort ?? null;
  const reviewer = presence?.approvalsReviewer ?? runtime?.settings?.approvalsReviewer ?? 'user';

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
  const applySnapshot = useCallback(result => {
    if (result.turns) setTurns(previous => mergeRecentTurns(previous, result.turns));
    if (result.thread) setMeta(previous => ({ ...previous, ...result.thread }));
  }, []);
  const sync = useConversationSync({ client, threadId, enabled: connected && Boolean(meta), owned, onSnapshot: applySnapshot });
  const verified = connected && sync.observation?.verified;
  const externallyRunning = !owned && verified && sync.observation?.state === 'running';
  const running = Boolean(connected && (owned && (presence?.running || live?.threadId === threadId && live?.status === 'running') || externallyRunning));
  const displayTurns = turns.map((turn, index) => (!owned || !connected) && index === turns.length - 1 && !verified && ['interrupted', 'inProgress', 'unknown'].includes(turn.status) ? { ...turn, status: 'unknown' } : turn);
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
    if (busy || unsafe || presence?.resumeSafe === false || !draft.trim() && !attachments.length) return;
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
  const snapshotCoversLive = verified && sync.observation.state === 'idle' && sync.requestedAt >= (live?.updatedAt ?? live?.startedAt ?? Infinity) && turns.some(turn => turn.id === live?.turnId);
  const liveTurn = owned && !snapshotCoversLive && live?.threadId === threadId ? { id: live.turnId ?? 'live', status: !connected ? 'unknown' : live.status === 'running' ? 'inProgress' : live.status, items: mergeLiveItems(live) } : null;

  const header = h('header', { className: 'cp-chat-header' },
    h('button', { className: 'cp-icon-btn', onClick: onToggleSidebar, 'aria-label': '切换聊天列表', title: '切换聊天列表' }, h(Icon, { name: 'sidebar' })),
    h('div', { className: 'cp-chat-heading' }, h('h2', null, meta?.title || (threadId ? '正在打开聊天…' : 'Codex')), meta?.cwd ? h('span', { title: meta.cwd }, meta.projectName || basename(meta.cwd)) : null),
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

  const conversation = h('section', { className: 'cp-preview' }, header,
    showDetails ? h('div', { className: 'cp-chat-details' },
      h('span', null, `目录：${meta?.cwd ?? '—'}`), h('span', null, `来源：${sourceLabel(meta?.sourceKind)}`), h('span', null, `项目：${meta?.projectName || '无明确归属'}`),
      h('span', null, `轮次：${meta?.turnCount ?? 0}${meta?.turnCountTruncated ? '+' : ''}`),
      h('span', { className: 'cp-thread-id' }, threadId), h('button', { className: 'cp-link', onClick: copyId }, copied ? '已复制' : '复制 ID'),
      h('span', null, owned ? '已接入本面板' : occupied ? '可能被其他客户端使用' : '历史预览')) : null,
    notices.length ? h('div', { className: 'cp-notices' }, notices.map((notice, index) => h(NoticeBox, { key: index, onDismiss: () => onDismissNotice?.(index) }, notice))) : null,
    !threadId ? h('div', { className: 'cp-welcome' }, h('div', { className: 'cp-welcome-mark' }, h(Icon, { name: 'command', size: 32 })), h('h1', null, '开始一段新的协作'), h('p', null, '选择项目中的聊天继续，或创建新聊天。'), h('button', { className: 'cp-btn primary', onClick: onNewThread, disabled: !connected }, h(Icon, { name: 'plus', size: 16 }), '新聊天')) :
      h(React.Fragment, null,
        h('div', { className: 'cp-preview-body' }, loading && !meta ? h(SkeletonRows, { count: 5 }) : error ? h(ErrorBox, { message: error, onRetry: load }) : !turns.length && !liveTurn ? h(Center, { title: '有什么想一起完成的？' }, owned ? '在下方描述任务，Codex 会在当前项目中继续。' : '继续聊天后，可以在当前项目中协作。') :
          h(TurnList, { turns: displayTurns, liveTurn, livePlan: owned ? live?.plan : null, threadId, hasOlder: Boolean(cursor), loadingOlder, onLoadOlder: loadOlder })),
        approvals.length ? h('div', { className: 'cp-approvals', 'aria-label': '待审批请求' }, h('div', { className: 'cp-approval-heading' }, '需要你的决定', h('span', null, `${approvals.length} 项`)), approvals.map(request => h(ApprovalCard, { key: request.requestId, request, busy, onDecide }))) : null,
        owned ? h(React.Fragment, null,
          unsafe ? h('div', { className: 'cp-unsafe-banner', role: 'status' }, h('div', null, h('strong', null, '发送结果待确认'), h('span', null, `${unsafe.message}。草稿已保留，不会自动重发。`)),
            pendingDraft ? h('button', { className: 'cp-link', onClick: () => { setDraft(pendingDraft.text ?? ''); setAttachments((pendingDraft.images ?? []).map(path => ({ path, name: basename(path) }))); } }, '恢复草稿') : null,
            h('button', { className: 'cp-btn', onClick: () => onRefreshReconcile(threadId), disabled: busy }, '刷新核对')) : null,
          h(Composer, { client, threadId, draft, setDraft, attachments, setAttachments, busy, running, settingsDisabled: !connected, blocked: presence?.resumeSafe === false || Boolean(unsafe) || !connected,
            modelLabel: model?.displayName ?? selectedModel, modelId: selectedModel, models, effort, reviewer, approvalBlocked: approvals.length > 0, queueCount: runtime?.queueCount,
            onSend: send, onSteer: steer, onQueue: queue, onQueueList: () => onQueueList(threadId), onInterrupt: () => onInterrupt(threadId), onFiles: pickFiles, onApplySettings: params => onApplySettings?.(threadId, params) })) :
          h('div', { className: 'cp-readonly-banner' }, h('div', null, h('strong', null, externallyRunning ? '正在其他客户端运行' : '只读同步'), h('span', { role: 'status' },
            !connected ? '连接已断开，当前运行状态未核实。' : sync.error ? '自动更新暂时失败，已保留消息并会重试。' : !verified ? '正在自动同步消息，实时运行状态未核实。' : sync.observation.activeFlags?.includes('waitingOnApproval') ? '等待原客户端审批，消息自动更新。' : sync.observation.activeFlags?.includes('waitingOnUserInput') ? '等待原客户端输入，消息自动更新。' : externallyRunning ? '消息自动更新，操作由原客户端处理。' : '消息自动更新，可继续此聊天。')),
            h('button', { className: 'cp-btn primary', disabled: !connected || busy || externallyRunning, onClick: () => onResume(threadId) }, '继续此聊天'))));
  return h(FileContext.Provider, { value: { openFile, fileUrl, baseDirectory: meta?.cwd } },
    h('div', { className: 'cp-chat-workspace' }, conversation, fileTarget ? h(FilePreview, { key: JSON.stringify([threadId, fileTarget]), client, threadId, target: fileTarget, onClose: closeFile, width: fileWidth, setWidth: setFileWidth }) : null));
}
