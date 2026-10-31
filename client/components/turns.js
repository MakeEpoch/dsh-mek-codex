import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
const h = React.createElement;
import { TURN_STATUS } from '../constants.js';
import { Markdown } from './markdown.js';
import { Icon } from './icon.js';
import { lowerBound, mergeLiveItems, basename, formatTime } from '../helpers.js';

function turnItemText(item) {
  switch (item?.type) {
    case 'userMessage':
      return (item.content ?? [])
        .map((part) => {
          if (part?.type === 'text') return part.text ?? '';
          if (part?.type === 'localImage') return `[图片 ${basename(part.path ?? '')}]`;
          return `[${part?.type ?? '附件'}]`;
        })
        .join('\n');
    case 'agentMessage':
      return item.text ?? '';
    case 'reasoning':
      return Array.isArray(item.summary) ? item.summary.map(part => typeof part === 'string' ? part : part.text ?? '').join('\n') : item.summary ?? item.text ?? '';
    case 'commandExecution':
      return [item.command ?? '', item.aggregatedOutput ?? item.output ?? ''].filter(Boolean).join('\n');
    case 'fileChange':
      return (item.changes ?? []).map((change) => change.path ?? '').filter(Boolean).join('\n');
    case 'mcpToolCall':
      return `${item.server ?? ''}/${item.tool ?? ''}`;
    case 'plan':
      return item.text ?? '';
    default:
      return '';
  }
}

function itemKind(item) {
  switch (item?.type) {
    case 'userMessage':
      return { className: 'cp-item-user', label: '你' };
    case 'agentMessage':
      return { className: 'cp-item-agent', label: 'Codex' };
    case 'reasoning':
      return { className: 'cp-item-reason', label: '思考摘要' };
    case 'commandExecution':
      return { className: 'cp-item-tool', label: '命令' };
    case 'fileChange':
      return { className: 'cp-item-tool', label: '文件变更' };
    case 'mcpToolCall':
      return { className: 'cp-item-tool', label: '工具调用' };
    case 'plan':
      return { className: 'cp-item-tool', label: '计划' };
    default:
      return { className: 'cp-item-tool', label: item?.type ?? '条目' };
  }
}

function ExecutionGroup({ items }) {
  return h('details', { className: 'cp-execution-group' },
    h('summary', null, h(Icon, { name: 'command', size: 15 }), `执行了 ${items.length} 项操作`, h(Icon, { name: 'chevron', size: 12 })),
    items.map((item, index) => h('details', { className: 'cp-tool-detail', key: item.id ?? index },
      h('summary', null, h(Icon, { name: item.type === 'fileChange' ? 'folder' : 'command', size: 14 }),
        h('span', null, item.type === 'commandExecution' ? item.command || '运行命令' : itemKind(item).label),
        item.status ? h('span', { className: 'cp-tool-status' }, item.status) : null),
      h('pre', null, turnItemText(item)))));
}

export function TurnBlock({ turn, live, plan }) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const blocks = []; let tools = [];
  const flush = () => { if (tools.length) { blocks.push(h(ExecutionGroup, { key: `tools-${blocks.length}`, items: tools })); tools = []; } };
  for (const [index, item] of items.entries()) {
    if (!['userMessage', 'agentMessage', 'reasoning'].includes(item.type)) { tools.push(item); continue; }
    flush();
    const text = turnItemText(item);
    if (item.type === 'reasoning') {
      blocks.push(h('details', { className: 'cp-reasoning', key: item.id ?? index }, h('summary', null, '思考摘要', h(Icon, { name: 'chevron', size: 12 })), h(Markdown, { text })));
    } else {
      blocks.push(h('article', { key: item.id ?? index, className: `cp-message ${item.type === 'userMessage' ? 'cp-message-user' : 'cp-message-agent'}`, 'aria-label': item.type === 'userMessage' ? '用户消息' : 'Codex 回复' }, h(Markdown, { text })));
    }
  }
  flush();
  return h('section', { className: 'cp-turn' }, ...blocks,
    plan?.plan?.length ? h('details', { className: 'cp-plan' }, h('summary', null, '执行计划'), h('ol', null, plan.plan.map((step, index) => h('li', { key: index }, step.step ?? step.text ?? step.title)))) : null,
    turn.status && turn.status !== 'completed' ? h('div', { className: 'cp-turn-foot', role: 'status' }, live && turn.status === 'inProgress' ? h('span', { className: 'cp-spinner' }) : null, TURN_STATUS[turn.status] ?? turn.status) : null);
}

export function TurnList({ turns, liveTurn, livePlan, threadId, hasOlder, loadingOlder, onLoadOlder }) {
  const containerRef = useRef(null);
  const heightsRef = useRef(new Map());
  const anchorRef = useRef(null);
  const stickBottomRef = useRef(true);
  const programmaticRef = useRef(false);
  const [heightsVersion, setHeightsVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const [away, setAway] = useState(false);

  useEffect(() => {
    stickBottomRef.current = true;
    heightsRef.current = new Map();
    anchorRef.current = null;
    programmaticRef.current = false;
    setHeightsVersion((value) => value + 1);
  }, [threadId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || 600);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(() => {
    const list = turns.filter(turn => turn.id !== liveTurn?.id).map((turn) => ({ key: turn.id, turn }));
    if (liveTurn) list.push({ key: liveTurn.id ?? 'live', turn: liveTurn, live: true, plan: livePlan });
    return list;
  }, [turns, liveTurn, livePlan]);

  const estimate = 220;
  const layout = useMemo(() => {
    let offset = 0;
    return rows.map((row) => {
      const height = heightsRef.current.get(row.key) ?? estimate;
      const entry = { row, top: offset, height };
      offset += height;
      return entry;
    });
  }, [rows, heightsVersion]);
  const total = layout.length ? layout[layout.length - 1].top + layout[layout.length - 1].height : 0;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const programmatic = (top) => {
      programmaticRef.current = true;
      el.scrollTop = top;
      setScrollTop(el.scrollTop);
    };
    if (anchorRef.current && rows.length > 0) {
      const { turnId, offset } = anchorRef.current;
      const entry = layout.find((item) => item.row.turn.id === turnId);
      if (entry) programmatic(entry.top - offset);
      return;
    }
    if (stickBottomRef.current && rows.length > 0) programmatic(Math.max(0, el.scrollHeight - el.clientHeight));
  }, [rows, heightsVersion]);

  const onScroll = (event) => {
    const el = event.currentTarget;
    setScrollTop(el.scrollTop);
    if (programmaticRef.current) {
      programmaticRef.current = false;
      return;
    }
    anchorRef.current = null;
    stickBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 160;
    setAway(!stickBottomRef.current);
    if (hasOlder && !loadingOlder && el.scrollTop <= 80) {
      const first = layout.find((entry) => entry.top + entry.height > el.scrollTop);
      anchorRef.current = first ? { turnId: first.row.turn.id, offset: first.top - el.scrollTop } : null;
      onLoadOlder();
    }
  };

  const start = Math.max(0, lowerBound(layout, scrollTop) - 3);
  const end = Math.min(layout.length, lowerBound(layout, scrollTop + viewport) + 3);

  return h(
    'div',
    { className: 'cp-turn-scroll', ref: containerRef, onScroll, onToggleCapture: () => { stickBottomRef.current = false; }, 'aria-label': '聊天记录' },
    loadingOlder ? h('div', { className: 'cp-history-loading', role: 'status' }, '正在加载更早的消息…') : null,
    h(
      'div',
      { className: 'cp-turn-inner', style: { height: total } },
      layout.slice(start, end).map(({ row, top }) =>
        h(
          'div',
          {
            key: row.key,
            className: 'cp-turn-slot',
            style: { top },
            ref: (el) => {
              if (!el) return;
              const measure = () => {
                const height = el.offsetHeight;
                if (!height) return;
                const previous = heightsRef.current.get(row.key);
                if (previous === undefined || Math.abs(previous - height) > 1) {
                  heightsRef.current.set(row.key, height);
                  setHeightsVersion((value) => value + 1);
                }
              };
              measure();
              if (typeof ResizeObserver === 'undefined') return;
              const observer = new ResizeObserver(measure);
              observer.observe(el);
              return () => observer.disconnect();
            },
          },
          h(TurnBlock, { turn: row.turn, live: row.live, plan: row.plan }),
        ),
      ),
    ),
    away ? h('button', { className: 'cp-jump-bottom', 'aria-label': '回到最新消息', onClick: () => { const el = containerRef.current; if (el) { el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight); setScrollTop(el.scrollTop); } stickBottomRef.current = true; setAway(false); } }, h(Icon, { name: 'down', size: 16 }), '最新消息') : null,
  );
}
