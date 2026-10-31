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

export function buildSessionRows(items, { source } = {}) {
  const list = Array.isArray(items) ? items : [];
  const filtered = source ? list.filter((thread) => thread.sourceKind === source) : list;
  const groups = new Map();
  for (const thread of filtered) {
    const key = thread.cwd || '(未知目录)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(thread);
  }
  const nameCount = new Map();
  for (const cwd of groups.keys()) {
    const name = basename(cwd);
    nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  }
  const entries = [...groups.entries()].map(([cwd, threads]) => {
    threads.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return {
      cwd,
      threads,
      label: nameCount.get(basename(cwd)) > 1 ? cwd : basename(cwd),
      latest: threads[0]?.updatedAt ?? 0,
    };
  });
  entries.sort((a, b) => b.latest - a.latest);
  const rows = [];
  for (const entry of entries) {
    rows.push({ kind: 'group', cwd: entry.cwd, label: entry.label, count: entry.threads.length });
    for (const thread of entry.threads) rows.push({ kind: 'thread', thread });
  }
  return rows;
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
