import { useState, useEffect, useRef, useCallback } from 'react';
import { PAGE_SIZE } from '../constants.js';
import { createListCache } from '../list-cache.js';

export function useSessionList({ client, connected, query, cwd, archived, setPresence }) {
  const key = JSON.stringify([query, cwd, archived]);
  const isDefault = !query && !cwd && !archived;
  const [cache] = useState(() => createListCache());
  const [initial] = useState(() => cache.read());
  const [state, setState] = useState(() => ({
    key, items: isDefault ? initial?.items ?? [] : [], navigation: initial?.navigation ?? null,
    cursor: null, loading: !(isDefault && initial), updating: false, loadingMore: false,
    error: '', stale: Boolean(isDefault && initial), ready: false,
  }));
  const stateRef = useRef(state);
  stateRef.current = state;
  const generation = useRef(0);
  const pending = useRef(null);
  const [knownCwds, setKnownCwds] = useState(() => [...new Set((initial?.items ?? []).map(item => item.cwd).filter(Boolean))].sort());
  const [knownSources, setKnownSources] = useState(() => [...new Set((initial?.items ?? []).map(item => item.sourceKind).filter(Boolean))].sort());

  const fetchPage = useCallback((nextCursor, { reset, force = false }) => {
    if (!connected) return Promise.resolve();
    const active = pending.current;
    // Scroll and explicit refresh can fire before React commits state.
    if (!force && active?.key === key && (active.reset || !reset)) return active.promise;
    active?.controller.abort();
    const gen = ++generation.current;
    const controller = new AbortController();
    setState(previous => ({ ...previous, key,
      items: previous.key === key ? previous.items : [],
      cursor: reset ? null : previous.cursor,
      loading: reset && (previous.key !== key || !previous.items.length && !previous.navigation),
      updating: reset, loadingMore: !reset, error: '',
    }));
    const request = { key, reset, controller };
    request.promise = (async () => {
      try {
        const result = await Promise.resolve().then(() => controller.signal.aborted ? null : client.list({ cursor: nextCursor ?? undefined, limit: PAGE_SIZE, searchTerm: query || undefined, cwd: cwd || undefined, archived }, controller.signal));
        if (gen !== generation.current || controller.signal.aborted) return;
        const data = Array.isArray(result.data) ? result.data : [];
        setState(previous => {
          const map = new Map((reset ? [] : previous.items).map(thread => [thread.id, thread]));
          for (const thread of data) if (thread?.id) map.set(thread.id, thread);
          return { ...previous, key, items: [...map.values()], navigation: result.navigation ?? previous.navigation,
            cursor: result.nextCursor ?? null, loading: false, updating: false, loadingMore: false, error: '', stale: false, ready: true };
        });
        if (reset && isDefault) cache.write(data, result.navigation ?? stateRef.current.navigation);
        setKnownCwds(previous => [...new Set([...previous, ...data.map(thread => thread.cwd).filter(Boolean)])].sort());
        setKnownSources(previous => [...new Set([...previous, ...data.map(thread => thread.sourceKind).filter(Boolean)])].sort());
        setPresence(previous => {
          const next = { ...previous };
          for (const thread of data) if (thread.presence) next[thread.id] = thread.presence;
          return next;
        });
      } catch (cause) {
        if (gen === generation.current && !controller.signal.aborted) setState(previous => ({ ...previous, loading: false, updating: false, loadingMore: false, error: cause?.message || String(cause) }));
      } finally {
        if (pending.current === request) pending.current = null;
      }
    })();
    pending.current = request;
    return request.promise;
  }, [client, connected, key, query, cwd, archived, isDefault, cache, setPresence]);

  useEffect(() => {
    if (connected) void fetchPage(null, { reset: true });
    else setState(previous => ({ ...previous, loading: false, updating: false, loadingMore: false }));
    return () => { generation.current++; pending.current?.controller.abort(); pending.current = null; };
  }, [fetchPage, connected]);

  const refreshList = useCallback(options => fetchPage(null, { reset: true, force: options?.force === true }), [fetchPage]);
  const loadMore = useCallback(() => {
    const current = stateRef.current;
    if (!connected || current.key !== key || !current.ready || !current.cursor || pending.current) return;
    return fetchPage(current.cursor, { reset: false });
  }, [connected, key, fetchPage]);

  // Do not paint old unfiltered results while a different query is pending.
  const view = state.key === key ? state : { ...state, items: [], cursor: null, loading: connected, updating: false, error: '', stale: false, ready: false };
  return { ...view, navigation: state.navigation, knownCwds, knownSources, refreshList, loadMore };
}
