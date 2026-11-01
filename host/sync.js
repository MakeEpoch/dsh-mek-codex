import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { badRequest, mapThread } from './helpers.js';

export function createThreadSync(runtime, hub, observer) {
  const pending = new Map();
  const snapshots = new Map();

  async function load(threadId) {
    let reader = runtime;
    let { thread } = await runtime.request('thread/read', { threadId, includeTurns: false });
    if (!thread) throw badRequest('线程不存在');
    let source = runtime.isOwned(threadId) ? 'panel' : 'history';
    if (source === 'history' && observer) {
      try {
        const shared = await observer.request('thread/read', { threadId, includeTurns: false });
        if (['active', 'idle', 'systemError'].includes(shared.thread?.status?.type)) {
          thread = shared.thread; reader = observer; source = 'shared';
        }
      } catch { /* Keep the history projection; it is not a runtime verdict. */ }
    }
    const state = hub.threadState(threadId);
    const verified = source !== 'history';
    const running = verified && (thread.status?.type === 'active' || source === 'panel' && state.running === true);
    const observation = { source, verified, state: verified ? (running ? 'running' : thread.status?.type === 'systemError' ? 'error' : 'idle') : 'unknown', activeFlags: thread.status?.activeFlags ?? [], checkedAt: Date.now() };
    // A changed rollout invalidates the stored-history projection. Loaded shared
    // threads can change in memory before disk flush, so always read their tail.
    const file = thread.path ? await stat(thread.path).catch(() => null) : null;
    const stamp = file ? `${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}` : null;
    const old = snapshots.get(threadId);
    let turns;
    if (source === 'history' && stamp && old?.stamp === stamp && old.observation.source === source) turns = old.turns;
    else {
      const page = await reader.request('thread/turns/list', { threadId, limit: 2, itemsView: 'full', sortDirection: 'desc' }, 30_000);
      turns = (page.data ?? []).map((turn, index) => !verified && index === 0 && ['interrupted', 'inProgress'].includes(turn.status)
        ? { ...turn, recordedStatus: turn.status, status: 'unknown', statusAuthoritative: false }
        : { ...turn, statusAuthoritative: verified || turn.status !== 'interrupted' });
    }
    const revision = createHash('sha256').update(JSON.stringify({ turns, state: observation.state, source, activeFlags: observation.activeFlags })).digest('hex');
    const result = { thread: mapThread(thread), turns, observation, revision, stamp };
    snapshots.delete(threadId); snapshots.set(threadId, result);
    while (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value);
    return result;
  }

  return async payload => {
    const threadId = String(payload.threadId ?? '');
    if (!threadId) throw badRequest('缺少 threadId');
    if (!pending.has(threadId)) pending.set(threadId, load(threadId).finally(() => pending.delete(threadId)));
    const { stamp, ...result } = await pending.get(threadId);
    const unchanged = payload.revision === result.revision;
    return { ...result, ...(unchanged ? { turns: undefined } : {}), unchanged };
  };
}
