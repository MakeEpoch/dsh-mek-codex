import React, { useState, useEffect, useRef, useMemo } from 'react';
const h = React.createElement;
import { sourceLabel, formatTime, lowerBound, basename } from '../helpers.js';
import { Icon } from './icon.js';

const GROUP_HEIGHT = 36;
const SECTION_HEIGHT = 28;
const THREAD_HEIGHT = 32;

export function ThreadRow({ thread, selected, presence, occupied, onSelect }) {
  return h('button', {
    type: 'button', className: `cp-thread${selected ? ' selected' : ''}`, onClick: () => onSelect(thread.id),
    'aria-current': selected ? 'page' : undefined,
    title: `${thread.title}\n${thread.cwd} · ${sourceLabel(thread.sourceKind)} · ${formatTime(thread.updatedAt)}${occupied ? ' · 可能被其他客户端使用' : ''}`,
  }, h('span', { className: 'cp-thread-title' }, thread.title),
    presence?.running ? h('span', { className: 'cp-spinner', role: 'status', 'aria-label': '运行中' }) : occupied ? h('span', { className: 'cp-occupied-dot', title: '可能被其他客户端使用' }) : null);
}

export function SessionRows({ rows, selectedId, presenceOf, occupiedOf, onSelect, hasMore, loadingMore, onLoadMore, resetKey }) {
  const [folded, setFolded] = useState({});
  const [expanded, setExpanded] = useState({});
  const visibleRows = useMemo(() => {
    const visible = []; let group; let count = 0;
    for (const row of rows) {
      if (row.kind === 'section') { visible.push(row); group = null; continue; }
      if (row.kind === 'group') {
        group = row; count = 0; visible.push(row);
        if (!(folded[row.cwd] ?? row.defaultCollapsed) && !row.count) visible.push({ kind: 'empty', cwd: row.cwd });
        continue;
      }
      if (folded[group?.cwd] ?? group?.defaultCollapsed) continue;
      count++;
      if (count <= 5 || expanded[group?.cwd] || resetKey.split('|')[0]) visible.push(row);
      else if (count === 6) visible.push({ kind: 'more', cwd: group.cwd, count: group.count - 5 });
    }
    return visible;
  }, [rows, folded, expanded, resetKey, hasMore]);
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(480);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || 480);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);

  const layout = useMemo(() => {
    let offset = 0;
    return visibleRows.map((row) => {
      const height = row.kind === 'section' ? SECTION_HEIGHT : row.kind === 'group' ? GROUP_HEIGHT : THREAD_HEIGHT;
      const entry = { row, top: offset, height };
      offset += height;
      return entry;
    });
  }, [visibleRows]);
  const total = layout.length ? layout[layout.length - 1].top + layout[layout.length - 1].height : 0;

  useEffect(() => {
    if (hasMore && !loadingMore && total > 0 && total <= viewport) onLoadMore();
  }, [hasMore, loadingMore, total, viewport, onLoadMore]);

  const onScroll = (event) => {
    const el = event.currentTarget;
    setScrollTop(el.scrollTop);
    if (hasMore && !loadingMore && el.scrollTop + el.clientHeight >= el.scrollHeight - 240) onLoadMore();
  };

  const start = Math.max(0, lowerBound(layout, scrollTop) - 4);
  const end = Math.min(layout.length, lowerBound(layout, scrollTop + viewport) + 6);

  return h(
    'div',
    { className: 'cp-list-scroll', ref: containerRef, onScroll },
    h(
      'div',
      { className: 'cp-list-inner', style: { height: total } },
      layout.slice(start, end).map(({ row, top, height }) =>
        h(
          'div',
          { key: row.kind === 'thread' ? `t:${row.thread.id}` : `${row.kind}:${row.cwd}`, className: 'cp-list-row', style: { top, height } },
          row.kind === 'section' ? h('div', { className: 'cp-nav-section' }, row.label)
            : row.kind === 'empty' ? h('div', { className: 'cp-project-empty' }, hasMore ? '继续加载历史聊天以查看' : '暂无匹配的聊天')
            : row.kind === 'group'
            ? h('button', { className: 'cp-group', title: row.roots?.join('\n') || row.label, 'aria-expanded': !(folded[row.cwd] ?? row.defaultCollapsed), onClick: () => setFolded(previous => ({ ...previous, [row.cwd]: !(previous[row.cwd] ?? row.defaultCollapsed) })) },
                h(Icon, { name: row.groupType === 'project' ? 'folder' : 'command', size: 16 }), h('span', { className: 'cp-group-name' }, row.label), h(Icon, { name: 'chevron', size: 12, className: (folded[row.cwd] ?? row.defaultCollapsed) ? '' : 'cp-rotated' }))
            : row.kind === 'more'
              ? h('button', { className: 'cp-show-more', onClick: () => setExpanded(previous => ({ ...previous, [row.cwd]: true })) }, `展开显示 · ${row.count}`)
            : h(ThreadRow, {
                thread: row.thread,
                selected: row.thread.id === selectedId,
                presence: presenceOf(row.thread.id) ?? row.thread.presence,
                occupied: occupiedOf(row.thread.id),
                onSelect,
              }),
        ),
      ),
    ),
    hasMore ? h('button', { className: 'cp-load-more', onClick: onLoadMore, disabled: loadingMore }, loadingMore ? '正在加载…' : '加载更多历史聊天') : null,
  );
}
