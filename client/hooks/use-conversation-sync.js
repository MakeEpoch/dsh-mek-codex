import { useState, useEffect, useRef } from 'react';

export function mergeRecentTurns(previous, incoming) {
  const map = new Map(previous.map(turn => [turn.id, turn]));
  for (const turn of [...incoming].reverse()) if (turn?.id) map.set(turn.id, turn);
  return [...map.values()];
}

export function useConversationSync({ client, threadId, enabled, owned, onSnapshot, intervalMs = 3000 }) {
  const callback = useRef(onSnapshot);
  callback.current = onSnapshot;
  const [state, setState] = useState({ observation: null, error: '', requestedAt: 0 });
  useEffect(() => {
    setState({ observation: null, error: '', requestedAt: 0 });
    if (!threadId || !enabled || typeof client.sync !== 'function') return;
    let stopped = false, pending = false, revision, timer, failures = 0;
    const controller = new AbortController();
    const poll = async () => {
      if (stopped || pending) return;
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') { timer = setTimeout(poll, 10000); return; }
      pending = true;
      const requestedAt = Date.now();
      try {
        const result = await client.sync({ threadId, revision }, controller.signal);
        if (stopped) return;
        failures = 0; revision = result.revision;
        callback.current(result);
        setState({ observation: result.observation, error: '', requestedAt });
      } catch (error) {
        if (!stopped) { failures++; setState(previous => ({ ...previous, observation: null, error: error.message || String(error) })); }
      } finally {
        pending = false;
        if (!stopped) timer = setTimeout(poll, Math.min(15000, intervalMs * (failures + 1)));
      }
    };
    const focus = () => { if (document.visibilityState !== 'hidden') void poll(); };
    void poll();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [client, threadId, enabled, owned, intervalMs]);
  return state;
}
