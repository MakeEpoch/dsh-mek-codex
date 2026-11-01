import { useEvents } from './hooks/use-events.js';
import { useActions } from './hooks/use-actions.js';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
const h = React.createElement;
import { REFRESH_MS } from './constants.js';
import { useSessionList } from './hooks/use-session-list.js';
import { statusLine, buildSessionRows, basename, sourceLabel } from './helpers.js';
import { CSS } from './styles.js';
import { Center, ErrorBox, SkeletonRows } from './components/common.js';
import { SessionRows } from './components/sessions.js';
import { Conversation } from './conversation.js';
import { Icon } from './components/icon.js';
import { Dialog } from './components/dialog.js';

export function Panel({ client }) {
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [cwd, setCwd] = useState('');
  const [source, setSource] = useState('');
  const [archived, setArchived] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 760);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newCwd, setNewCwd] = useState('');
  const [drafts, setDrafts] = useState({});
  const saveDraft = useCallback((id, draft) => setDrafts(previous => ({ ...previous, [id]: draft })), []);
  const closeNew = useCallback(() => setShowNew(false), []);

  const [models, setModels] = useState([]);
  const [newProjectId, setNewProjectId] = useState('');
  const [presence, setPresence] = useState({});
  const [occupied, setOccupied] = useState({});
  const [runtimeMap, setRuntimeMap] = useState({});
  const [liveByThread, setLiveByThread] = useState({});
  const live = liveByThread[selectedId] ?? null;
  const [approvals, setApprovals] = useState([]);
  const [notices, setNotices] = useState([]);

  const connected = health?.status === 'connected';
  const status = statusLine(health?.status, health?.detail);
  const { items, cursor, navigation, loading, updating, stale, loadingMore, error: listError, knownCwds, knownSources, refreshList, loadMore } = useSessionList({ client, connected, query: debouncedQuery, cwd, archived, setPresence });

  const pushNotice = useCallback((text) => {
    setNotices((previous) => [...previous.slice(-4), text]);
  }, []);

  const setThreadRuntime = useCallback((threadId, patch) => {
    setRuntimeMap((previous) => ({ ...previous, [threadId]: { ...(previous[threadId] ?? {}), ...patch } }));
  }, []);

  /* ---- health ---- */
  const alive = useRef(true);
  const loadHealth = useCallback(
    async (signal) => {
      try {
        const value = await client.health(signal);
        if (alive.current) {
          setHealth(value);
          setHealthError('');
        }
      } catch (cause) {
        if (alive.current && cause?.name !== 'AbortError') setHealthError(cause?.message || String(cause));
      }
    },
    [client],
  );

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void loadHealth(controller.signal);
    const timer = setInterval(() => void loadHealth(controller.signal), REFRESH_MS);
    return () => {
      alive.current = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [loadHealth]);

  /* ---- models ---- */
  useEffect(() => {
    if (!connected) return undefined;
    let cancelled = false;
    void client
      .models()
      .then((result) => {
        if (!cancelled) setModels(result.data ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, connected]);

  /* ---- search debounce ---- */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEvents({ client, connected, pushNotice, setLiveByThread, setPresence, setRuntimeMap, setApprovals });

  const { resume, release, createThread, renameThread, archiveThread, deleteThread, sendMessage, steer, interrupt, queueAdd, queueList, reconcile, applySettings, decide, releaseRuntime } = useActions({ client, pushNotice, setBusy, setPresence, setOccupied, setThreadRuntime, refreshList, knownCwds, setSelectedId, runtimeMap, setRuntimeMap, setHealth, setLiveByThread, setApprovals });

  const rows = useMemo(() => buildSessionRows(items, { source, navigation, selectedId, matchesOnly: Boolean(debouncedQuery || cwd || source || archived) }), [items, source, navigation, selectedId, debouncedQuery, cwd, archived]);
  const resetKey = `${debouncedQuery}|${cwd}|${source}|${archived ? 1 : 0}`;
  const filterActive = Boolean(debouncedQuery || cwd || source || archived);

  const runtimeFor = useCallback(
    (threadId) => ({ ...(runtimeMap[threadId] ?? {}), presence: presence[threadId] ?? null }),
    [presence, runtimeMap],
  );

  let listBody;
  if (loading && !rows.length) listBody = h(SkeletonRows, { count: 9 });
  else if (listError && !rows.length) listBody = h(ErrorBox, { message: `加载失败：${listError}`, onRetry: refreshList });
  else if (!rows.length)
    listBody = h(
      Center,
      { title: filterActive ? '没有匹配的会话' : connected ? '还没有 Codex 会话' : 'codex 未连接' },
      filterActive ? (cursor ? '当前已加载的聊天中没有匹配项，可继续加载历史。' : '换个关键词或筛选条件试试。') : connected ? '在 Codex 里创建会话后会出现在这里。' : '连接成功后这里会列出会话。',
      cursor ? h('button', { className: 'cp-btn', disabled: loadingMore, onClick: loadMore }, loadingMore ? '正在加载…' : '继续加载历史聊天') : null,
    );
  else
    listBody = h(SessionRows, {
      rows,
      selectedId,
      presenceOf: (threadId) => presence[threadId] ?? null,
      occupiedOf: (threadId) => Boolean(occupied[threadId]),
      onSelect: id => { setSelectedId(id); if (window.innerWidth <= 760) setSidebarOpen(false); },
      hasMore: Boolean(cursor) && !updating && connected,
      loadingMore,
      onLoadMore: loadMore,
      resetKey,
    });

  const openNew = () => {
    const selected = items.find(item => item.id === selectedId);
    const project = navigation?.projects.find(project => project.id === (selected?.projectId || navigation.selectedProjectId));
    setNewProjectId(project?.nativeId ? project.id : '');
    setNewCwd(project?.roots[0] || selected?.cwd || ''); setShowNew(true);
  };
  const unreadApprovals = approvals.filter(request => request.threadId !== selectedId);
  return h('div', { className: 'cp-root' }, h('style', null, CSS),
    h('div', { className: 'cp-main' },
      sidebarOpen ? h('button', { className: 'cp-sidebar-backdrop', 'aria-label': '关闭聊天列表', onClick: () => setSidebarOpen(false) }) : null,
      h('aside', { className: `cp-side${sidebarOpen ? ' open' : ' closed'}`, 'aria-label': '项目与聊天', inert: sidebarOpen ? undefined : '' },
        h('div', { className: 'cp-sidebar-top' }, h('strong', null, 'Codex'), h('span', { className: 'cp-spacer' }),
          h('button', { className: 'cp-icon-btn', 'aria-label': '搜索聊天', 'aria-expanded': searchOpen, onClick: () => setSearchOpen(value => !value) }, h(Icon, { name: 'search' }))),
        h('button', { className: 'cp-new-chat', disabled: !connected || busy, onClick: openNew }, h(Icon, { name: 'edit', size: 17 }), '新聊天'),
        searchOpen ? h('div', { className: 'cp-side-tools' }, h('input', { className: 'cp-search', type: 'search', placeholder: '搜索聊天标题', 'aria-label': '搜索聊天标题', value: query, autoFocus: true, onChange: event => setQuery(event.target.value) })) : null,
        h('div', { className: 'cp-project-heading' }, h('span', null, archived ? '已归档聊天' : '聊天导航'), h('span', { className: 'cp-spacer' }),
          h('details', { className: 'cp-menu' }, h('summary', { 'aria-label': '筛选聊天', className: filterActive ? 'active' : '' }, h(Icon, { name: 'filter', size: 15 })),
            h('div', { className: 'cp-popover cp-filter-popover' },
              h('label', null, '工作目录', h('select', { className: 'cp-select', value: cwd, onChange: event => setCwd(event.target.value), 'aria-label': '按目录筛选' }, h('option', { value: '' }, '全部目录'), knownCwds.map(value => h('option', { key: value, value }, basename(value))))),
              h('label', null, '来源', h('select', { className: 'cp-select', value: source, onChange: event => setSource(event.target.value), 'aria-label': '按来源筛选' }, h('option', { value: '' }, '全部来源'), knownSources.map(value => h('option', { key: value, value }, sourceLabel(value))))),
              h('label', null, '归档状态', h('select', { className: 'cp-select', value: archived ? '1' : '0', onChange: event => setArchived(event.target.value === '1'), 'aria-label': '归档状态' }, h('option', { value: '0' }, '未归档'), h('option', { value: '1' }, '已归档')))))),
        navigation?.warnings?.length ? h('div', { className: 'cp-navigation-warning' }, navigation.warnings.join('；')) : null,
        listError && rows.length ? h('div', { className: 'cp-list-status', role: 'status' }, '更新失败，保留当前列表', h('button', { className: 'cp-link', onClick: refreshList, title: listError }, '重试'))
          : updating || stale ? h('div', { className: 'cp-list-status', role: 'status' }, updating ? (stale ? '已显示上次列表，正在更新…' : '正在更新列表…') : '已显示上次列表，等待连接更新') : null,
        listBody,
        unreadApprovals.length ? h('div', { className: 'cp-other-approvals' }, h('span', null, `${unreadApprovals.length} 项请求等待决定`), ...[...new Set(unreadApprovals.map(request => request.threadId))].map(id => h('button', { key: id, className: 'cp-link', onClick: () => { setSelectedId(id); if (window.innerWidth <= 760) setSidebarOpen(false); } }, items.find(item => item.id === id)?.title || '打开聊天'))) : null,
        h('div', { className: 'cp-sidebar-footer' }, h('details', { className: 'cp-menu cp-connection-menu' },
          h('summary', { 'aria-label': '连接与运行时', title: healthError || status.text }, h('span', { className: `cp-connection-dot ${connected && !healthError ? 'good' : 'warn'}` }), h('span', null, healthError ? '连接异常' : status.label), h('span', { className: 'cp-spacer' }), h(Icon, { name: 'more', size: 15 })),
          h('div', { className: 'cp-popover' }, h('p', null, status.text, health?.codexVersion ? ` · Codex ${health.codexVersion}` : '', healthError ? ` · ${healthError}` : ''),
            h('button', { onClick: () => { void loadHealth(); void refreshList(); }, disabled: busy }, '刷新'),
            h('button', { onClick: () => void client.restart().then(setHealth).catch(error => pushNotice(error.message)), disabled: busy }, '重新连接'),
            h('button', { className: 'danger', onClick: releaseRuntime, disabled: busy }, '释放运行时'))))),
      h(Conversation, {
        key: selectedId || 'empty', client, threadId: selectedId, connected, globalBusy: busy,
        occupied: Boolean(occupied[selectedId]), runtime: selectedId ? runtimeFor(selectedId) : null, live,
        approvals: approvals.filter(request => request.threadId === selectedId), models, notices,
        onToggleSidebar: () => setSidebarOpen(value => !value), onNewThread: openNew,
        draftSnapshot: drafts[selectedId], onDraftChange: saveDraft,
        onResume: resume, onRelease: release, onSend: sendMessage, onSteer: steer, onInterrupt: interrupt,
        onQueue: queueAdd, onQueueList: queueList, onRefreshReconcile: reconcile,
        onDismissNotice: index => setNotices(previous => previous.filter((_, i) => i !== index)),
        onDecide: decide, onApplySettings: applySettings, archivedView: archived, onRename: renameThread,
        onArchive: id => archiveThread(id, false), onUnarchive: id => archiveThread(id, true), onDelete: deleteThread,
      })),
    showNew ? h(Dialog, { title: '新聊天', onClose: closeNew }, h('form', { onSubmit: async event => { event.preventDefault(); if (await createThread(newCwd, newProjectId)) { closeNew(); if (window.innerWidth <= 760) setSidebarOpen(false); } } },
      h('p', { className: 'cp-dialog-hint' }, '选择本机工作目录。新聊天会保存到 Codex 的原始存储。'),
      h('label', null, '项目', h('select', { className: 'cp-select', value: newProjectId, onChange: event => { setNewProjectId(event.target.value); const project = navigation?.projects.find(project => project.id === event.target.value); if (project?.roots[0]) setNewCwd(project.roots[0]); } },
        h('option', { value: '' }, '不归属项目'), (navigation?.projects ?? []).filter(project => project.nativeId).map(project => h('option', { key: project.id, value: project.id }, project.name)))),
      h('label', null, '工作目录', h('input', { className: 'cp-search', placeholder: '/path/to/project', value: newCwd, required: true, pattern: '/.*', list: 'cp-known-projects', onChange: event => setNewCwd(event.target.value) })),
      h('datalist', { id: 'cp-known-projects' }, knownCwds.map(value => h('option', { key: value, value }))),
      h('div', { className: 'cp-dialog-actions' }, h('button', { type: 'button', className: 'cp-btn', onClick: closeNew }, '取消'), h('button', { className: 'cp-btn primary', disabled: busy || !newCwd.trim().startsWith('/') }, busy ? '创建中…' : '创建聊天')))) : null);
}
