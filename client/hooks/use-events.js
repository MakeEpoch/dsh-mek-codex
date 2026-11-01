import { useEffect, useCallback, useRef } from 'react';
import { EVENT_TIMEOUT_MS } from '../constants.js';
import { decisionLabel } from '../helpers.js';
import { appendReasoningDelta } from '../reasoning.js';

export function useEvents({ client, connected, pushNotice, setLiveByThread, setPresence, setRuntimeMap, setApprovals }) {
  const lastSeqRef = useRef(0);
  const applyEvent = useCallback(
    (event) => {
      const { method, params } = event;
      const threadId = params?.threadId ?? null;
      const setLive = (update) => setLiveByThread(previous => ({ ...previous, [threadId]: { ...(typeof update === 'function' ? update(previous[threadId] ?? {}) : update), updatedAt: Date.now() } }));
      if (method === 'turn/started') {
        setLive({
          threadId,
          turnId: params.turn?.id ?? null,
          status: 'running',
          items: [],
          deltas: {},
          reasoning: {},
          activeReasoningId: null,
          closedReasoningIds: [],
          outputs: {},
          plan: null,
          diff: null,
          diffCount: 0,
          startedAt: Date.now(),
        });
        setPresence((previous) => ({ ...previous, [threadId]: { ...(previous[threadId] ?? {}), running: previous[threadId]?.owned === true } }));
        return;
      }
      if (method === 'item/agentMessage/delta') {
        setLive((previous) =>
          previous.threadId === threadId
            ? { ...previous, deltas: { ...previous.deltas, [params.itemId]: (previous.deltas[params.itemId] ?? '') + (params.delta ?? '') } }
            : previous,
        );
        return;
      }
      if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
        const field = method === 'item/reasoning/summaryTextDelta' ? 'summary' : 'content';
        setLive((previous) => {
          if (previous.threadId !== threadId || previous.status !== 'running' || previous.closedReasoningIds?.includes(params.itemId)) return previous;
          const closedReasoningIds = [...(previous.closedReasoningIds ?? [])];
          if (previous.activeReasoningId && previous.activeReasoningId !== params.itemId) closedReasoningIds.push(previous.activeReasoningId);
          return { ...previous, activeReasoningId: params.itemId, closedReasoningIds,
            reasoning: { ...previous.reasoning, [params.itemId]: appendReasoningDelta(previous.reasoning[params.itemId], params, field) } };
        });
        return;
      }
      if (method === 'item/commandExecution/outputDelta') {
        setLive((previous) =>
          previous.threadId === threadId
            ? { ...previous, outputs: { ...previous.outputs, [params.itemId]: (previous.outputs[params.itemId] ?? '') + (params.delta ?? '') } }
            : previous,
        );
        return;
      }
      if (method === 'item/started' || method === 'item/completed') {
        const item = params.item;
        if (!item?.id) return;
        setLive((previous) => {
          if (previous.threadId !== threadId) return previous;
          const items = [...(previous.items ?? [])];
          const index = items.findIndex((entry) => entry.id === item.id);
          const closedReasoningIds = new Set(previous.closedReasoningIds ?? []);
          if (method === 'item/started' && item.type === 'reasoning' && closedReasoningIds.has(item.id)) return previous;
          if (index >= 0) items[index] = item;
          else items.push(item);
          // Lifecycle metadata belongs to the live view, never the saved record.
          const activeReasoningId = method === 'item/started' ? (item.type === 'reasoning' ? item.id : null)
            : previous.activeReasoningId === item.id ? null : previous.activeReasoningId;
          if (previous.activeReasoningId && previous.activeReasoningId !== activeReasoningId) closedReasoningIds.add(previous.activeReasoningId);
          if (method === 'item/completed' && item.type === 'reasoning') closedReasoningIds.add(item.id);
          const next = { ...previous, items, activeReasoningId, closedReasoningIds: [...closedReasoningIds] };
          if (method === 'item/completed') {
            // The completed item is authoritative; drop the streaming buffers.
            const deltas = { ...next.deltas };
            const reasoning = { ...next.reasoning };
            const outputs = { ...next.outputs };
            delete deltas[item.id];
            delete reasoning[item.id];
            delete outputs[item.id];
            next.deltas = deltas;
            next.reasoning = reasoning;
            next.outputs = outputs;
          }
          return next;
        });
        return;
      }
      if (method === 'turn/plan/updated') {
        setLive((previous) => (previous.threadId === threadId ? { ...previous, plan: { plan: params.plan ?? [], explanation: params.explanation ?? null } } : previous));
        return;
      }
      if (method === 'turn/diff/updated') {
        setLive((previous) =>
          previous.threadId === threadId ? { ...previous, diff: params.diff ?? null, diffCount: (previous.diffCount ?? 0) + 1 } : previous,
        );
        return;
      }
      if (method === 'turn/completed') {
        setLive((previous) => (previous.threadId === threadId ? { ...previous, status: params.turn?.status ?? 'completed', items: params.turn?.items?.length ? params.turn.items : previous.items } : previous));
        setPresence((previous) => ({ ...previous, [threadId]: { ...(previous[threadId] ?? {}), running: false } }));
        return;
      }
      if (method === 'thread/status/changed') {
        setPresence((previous) => ({ ...previous, [threadId]: { ...(previous[threadId] ?? {}), threadStatus: params.status?.type ?? null } }));
        return;
      }
      if (method === 'approval/requested') {
        setApprovals((previous) => [...previous.filter((request) => request.requestId !== params.requestId), params]);
        return;
      }
      if (method === 'approval/resolved') {
        setApprovals((previous) => previous.filter((request) => request.requestId !== params.requestId));
        if (params.reason) pushNotice(`审批未及时处理，已按「${decisionLabel(params.decision)}」处理（${params.reason}）`);
        return;
      }
      if (method === 'approval/refused') {
        pushNotice(`已拒绝非本面板会话的请求：${params.method ?? ''}`);
        return;
      }
      if (method === 'presence/changed' && params.threadId) {
        setPresence((previous) => ({ ...previous, [params.threadId]: params.presence }));
        return;
      }
      if (method === 'error') {
        pushNotice(`Codex 错误：${JSON.stringify(params).slice(0, 200)}`);
      }
    },
    [pushNotice],
  );

  useEffect(() => {
    if (!connected) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      while (!cancelled) {
        try {
          const result = await client.events({ since: lastSeqRef.current, timeoutMs: EVENT_TIMEOUT_MS }, controller.signal);
          lastSeqRef.current = result.lastSeq ?? lastSeqRef.current;
          for (const event of result.events ?? []) applyEvent(event);
          setApprovals(result.pendingApprovals ?? []);
          setPresence((previous) => ({ ...previous, ...result.presence }));
        } catch (cause) {
          if (cancelled || cause?.name === 'AbortError') break;
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, connected, applyEvent]);

}
