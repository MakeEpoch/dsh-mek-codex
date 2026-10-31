import { STATUS, SOURCE_LABELS, APPROVAL_METHODS, DECISION_LABELS } from './constants.js';

export function dedupeById(items) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.id && !map.has(item.id)) map.set(item.id, item);
  }
  return [...map.values()];
}

export function basename(path) {
  if (typeof path !== 'string' || !path) return '(未知目录)';
  const parts = path.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function buildSessionRows(items, { source, navigation, selectedId, matchesOnly } = {}) {
  const list = dedupeById(items).filter(thread => !source || thread.sourceKind === source);
  const projects = navigation?.projects ?? [];
  const sections = navigation?.sections ?? [];
  const projectMap = new Map(projects.map(project => [project.id, []]));
  const sectionMap = new Map(sections.map(section => [section.id, []]));
  const pinned = []; const others = [];
  for (const thread of list) {
    if (thread.pinned) pinned.push(thread);
    else if (thread.section?.id && sectionMap.has(thread.section.id)) sectionMap.get(thread.section.id).push(thread);
    else if (thread.projectId && projectMap.has(thread.projectId)) projectMap.get(thread.projectId).push(thread);
    else others.push(thread);
  }
  const rows = [];
  const recent = threads => [...threads].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const addGroup = (id, label, threads, options = {}) => {
    rows.push({ kind: 'group', cwd: id, label, count: threads.length, ...options, defaultCollapsed: Boolean(options.defaultCollapsed) && !threads.some(thread => thread.id === selectedId) });
    rows.push(...recent(threads).map(thread => ({ kind: 'thread', thread })));
  };
  const addProject = project => { if (matchesOnly && !projectMap.get(project.id).length) return; return addGroup(`project:${project.id}`, project.name, projectMap.get(project.id), {
    projectId: project.id, roots: project.roots, groupType: 'project', defaultCollapsed: !project.pinned && !projectMap.get(project.id).some(thread => thread.id === selectedId),
  }); };
  const pinnedProjects = projects.filter(project => project.pinned).sort((a, b) => (a.pinnedOrder ?? 0) - (b.pinnedOrder ?? 0));
  if (pinnedProjects.length || pinned.length) {
    rows.push({ kind: 'section', cwd: 'section:pinned', label: '置顶' });
    pinnedProjects.forEach(addProject);
    if (pinned.length) addGroup('threads:pinned', '置顶聊天', pinned, { groupType: 'chats' });
  }
  for (const section of sections) {
    const matches = projects.filter(project => !project.pinned && project.sectionId === section.id);
    const threads = sectionMap.get(section.id);
    if (!matches.length && !threads.length) continue;
    rows.push({ kind: 'section', cwd: `section:${section.id}`, label: section.name });
    matches.forEach(addProject);
    if (threads.length) addGroup(`threads:${section.id}`, '聊天', threads, { groupType: 'chats', defaultCollapsed: true });
  }
  const ordinary = projects.filter(project => !project.pinned && (!project.sectionId || !sectionMap.has(project.sectionId)));
  if (ordinary.length) {
    rows.push({ kind: 'section', cwd: 'section:projects', label: '项目' });
    ordinary.forEach(addProject);
  }
  if (others.length) {
    rows.push({ kind: 'section', cwd: 'section:chats', label: '聊天' });
    addGroup('threads:other', '其他聊天', others, { groupType: 'chats', defaultCollapsed: !others.some(thread => thread.id === selectedId) });
  }
  return rows.filter((row, index) => row.kind !== 'section' || (rows[index + 1] && rows[index + 1].kind !== 'section'));
}

export function sourceLabel(kind) {
  return SOURCE_LABELS[kind] ?? (kind || '未知');
}

export function formatTime(seconds) {
  if (!seconds || typeof seconds !== 'number') return '';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  if (date.getFullYear() === new Date().getFullYear()) return `${mm}-${dd} ${hh}:${mi}`;
  return `${date.getFullYear()}-${mm}-${dd}`;
}

export function lowerBound(layout, value) {
  let lo = 0;
  let hi = layout.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (layout[mid].top + layout[mid].height <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// The header/banner must not repeat the detail when it equals the label
// ("已连接 · 已连接").
export function statusLine(status, detail) {
  const label = STATUS[status]?.label ?? (status || '连接中…');
  const extra = detail && detail !== label ? detail : '';
  return { label, extra, text: extra ? `${label}：${extra}` : label };
}

export function approvalTitle(request) {
  return APPROVAL_METHODS[request?.method] ?? request?.method ?? '审批';
}

export function decisionLabel(decision) {
  if (typeof decision === 'string') return DECISION_LABELS[decision] ?? decision;
  if (decision && typeof decision === 'object') {
    const key = Object.keys(decision)[0];
    return DECISION_LABELS[key] ?? key;
  }
  return String(decision);
}

/** D: three-state presence. running > possibly-occupied > unknown. */
export function presenceLabel(presence, occupied) {
  if (presence?.owned) {
    return presence.running
      ? { key: 'owned-running', text: '运行中（本面板）', tone: 'good' }
      : { key: 'owned', text: '已接入（本面板）', tone: 'good' };
  }
  if (occupied) return { key: 'occupied', text: '可能被其他客户端使用', tone: 'warn' };
  return { key: 'unknown', text: '状态未知', tone: 'muted' };
}

/** Merge live deltas with authoritative completed items. */
export function mergeLiveItems(live) {
  if (!live) return [];
  const map = new Map();
  for (const item of live.items ?? []) if (item?.id) map.set(item.id, item);
  for (const [itemId, text] of Object.entries(live.deltas ?? {})) {
    const existing = map.get(itemId);
    // A completed item is authoritative: only fill items that have no text yet.
    if (existing) {
      if (!existing.text) map.set(itemId, { ...existing, text });
    } else {
      map.set(itemId, { id: itemId, type: 'agentMessage', text });
    }
  }
  for (const [itemId, text] of Object.entries(live.reasoning ?? {})) {
    const existing = map.get(itemId);
    if (existing) {
      if (!existing.summary) map.set(itemId, { ...existing, summary: text });
    } else {
      map.set(itemId, { id: itemId, type: 'reasoning', summary: text });
    }
  }
  for (const [itemId, text] of Object.entries(live.outputs ?? {})) {
    const existing = map.get(itemId);
    if (existing) {
      if (!existing.aggregatedOutput) map.set(itemId, { ...existing, aggregatedOutput: text });
    } else {
      map.set(itemId, { id: itemId, type: 'commandExecution', aggregatedOutput: text });
    }
  }
  return [...map.values()];
}
