import { mkdirSync, writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { badRequest, clampLimit, mapThread } from './helpers.js';
import { MAX_PAGE, MAX_TURNS_PAGE, MAX_BODY_BYTES } from './constants.js';

export function createHandlers(runtime, hub, store, approvals, stateDir, navigation) {
  const sending = new Set();
  function presenceOf(threadId) {
    const state = hub.threadState(threadId);
    const record = store.get(threadId);
    const owned = runtime.isOwned(threadId);
    return {
      owned,
      running: owned && Boolean(state.running),
      threadStatus: state.threadStatus ?? null,
      resumeSafe: record.resumeSafe !== false,
      lastTurnId: record.lastTurnId ?? null,
      lastStatus: record.lastStatus ?? null,
    };
  }

  async function listThreads(payload) {
    const params = { limit: clampLimit(payload.limit, MAX_PAGE) };
    if (payload.cursor) params.cursor = String(payload.cursor);
    if (payload.searchTerm) params.searchTerm = String(payload.searchTerm);
    if (payload.cwd) params.cwd = String(payload.cwd);
    if (payload.archived === true || payload.archived === false) params.archived = payload.archived;
    const [result, nav] = await Promise.all([runtime.request('thread/list', params), navigation?.snapshot()]);
    const raw = Array.isArray(result?.data) ? result.data : [];
    const seen = new Set();
    const data = [];
    for (const thread of raw) {
      if (!thread?.id || seen.has(thread.id)) continue;
      seen.add(thread.id);
      data.push({ ...mapThread(thread), ...(nav?.classify(thread) ?? {}), presence: presenceOf(thread.id) });
    }
    return { data, nextCursor: result?.nextCursor ?? null, rawCount: raw.length, ...(nav ? { navigation: nav.value } : {}) };
  }

  async function listTurns(payload) {
    if (!payload.threadId) throw badRequest('缺少 threadId');
    const view = payload.view === 'summary' ? 'summary' : 'full';
    const params = {
      threadId: String(payload.threadId),
      limit: clampLimit(payload.limit, MAX_TURNS_PAGE),
      itemsView: view,
      sortDirection: 'desc',
    };
    if (payload.cursor) params.cursor = String(payload.cursor);
    const result = await runtime.request('thread/turns/list', params, 60_000);
    const turns = Array.isArray(result?.data) ? result.data : [];
    return {
      turns,
      nextCursor: result?.nextCursor ?? null,
      backwardsCursor: result?.backwardsCursor ?? null,
      view,
      hasNotLoaded: turns.some((turn) => turn?.itemsView === 'notLoaded'),
    };
  }

  async function readThreadMeta(payload) {
    if (!payload.threadId) throw badRequest('缺少 threadId');
    const threadId = String(payload.threadId);
    const result = await runtime.request('thread/read', { threadId, includeTurns: false });
    if (!result?.thread) throw badRequest('线程不存在');
    const nav = await navigation?.snapshot();
    const meta = { ...mapThread(result.thread), ...(nav?.classify(result.thread) ?? {}) };
    let count = 0;
    let cursor = null;
    let pages = 0;
    let truncated = false;
    do {
      const page = await runtime.request(
        'thread/turns/list',
        { threadId, limit: 100, itemsView: 'summary', sortDirection: 'desc', ...(cursor ? { cursor } : {}) },
        60_000,
      );
      count += Array.isArray(page?.data) ? page.data.length : 0;
      cursor = page?.nextCursor ?? null;
      pages += 1;
      if (pages >= 5 && cursor) {
        truncated = true;
        break;
      }
    } while (cursor);
    return { ...meta, turnCount: count, turnCountTruncated: truncated, presence: presenceOf(threadId) };
  }

  async function listModels(payload) {
    const result = await runtime.request('model/list', { limit: clampLimit(payload.limit, 100) }, 60_000);
    const data = (Array.isArray(result?.data) ? result.data : []).map((model) => ({
      id: model.id,
      model: model.model ?? model.id,
      displayName: model.displayName ?? model.id,
      description: model.description ?? '',
      isDefault: Boolean(model.isDefault),
      hidden: Boolean(model.hidden),
      defaultReasoningEffort: model.defaultReasoningEffort ?? null,
      reasoningEfforts: (model.supportedReasoningEfforts ?? [])
        .map((effort) => (typeof effort === 'string' ? effort : effort?.reasoningEffort ?? effort?.effort ?? null))
        .filter(Boolean),
    }));
    return { data, nextCursor: result?.nextCursor ?? null };
  }

  async function updateSettings(payload) {
    if (!payload.threadId) throw badRequest('缺少 threadId');
    if (!runtime.isOwned(String(payload.threadId))) throw badRequest('尚未接入该会话', 'not-owned');
    const params = { threadId: String(payload.threadId) };
    if (payload.model) params.model = String(payload.model);
    if (payload.effort) params.effort = String(payload.effort);
    if (payload.summary) params.summary = String(payload.summary);
    await runtime.request('thread/settings/update', params, 60_000);
    return { ok: true, threadId: params.threadId, model: params.model ?? null, effort: params.effort ?? null };
  }

  async function resumeThread(payload) {
    if (!payload.threadId) throw badRequest('缺少 threadId');
    const threadId = String(payload.threadId);
    const params = { threadId, approvalsReviewer: 'user' };
    if (payload.approvalPolicy) params.approvalPolicy = payload.approvalPolicy;
    if (payload.sandbox) params.sandbox = payload.sandbox;
    if (payload.model) params.model = payload.model;
    try {
      const result = await runtime.request('thread/resume', params, 60_000);
      if (result?.thread?.id !== threadId) throw badRequest('thread/resume 返回了不同的线程', 'resume-mismatch');
      const settings = result.settings ?? null;
      runtime.owns.set(threadId, { resumedAt: Date.now(), model: settings?.model ?? null, effort: settings?.effort ?? null });
      store.set(threadId, { resumeSafe: store.get(threadId).resumeSafe !== false, owner: 'panel', reopenedAt: Date.now() });
      hub.push('presence/changed', { threadId, presence: presenceOf(threadId) });
      return { thread: mapThread(result.thread), settings, presence: presenceOf(threadId), approvalsReviewer: 'user' };
    } catch (error) {
      const message = String(error?.message ?? error);
      if (/active writer/i.test(message)) {
        throw badRequest('此聊天正在其他客户端中使用，请先停止或关闭那里的会话再试', 'active-writer');
      }
      throw error;
    }
  }

  async function releaseThread(payload) {
    const threadId = payload?.threadId ? String(payload.threadId) : null;
    if (threadId) runtime.owns.delete(threadId);
    if (threadId) hub.push('presence/changed', { threadId, presence: presenceOf(threadId) });
    return {
      released: threadId ? [threadId] : [],
      note: '本面板已断开此聊天。需要交给其他客户端时，请在连接菜单中释放运行时。',
    };
  }

  async function releaseAll() {
    const released = [...runtime.owns.keys()];
    const snapshot = await runtime.restart();
    return { released, snapshot };
  }

  async function sendTurn(payload) {
    const threadId = String(payload?.threadId ?? '');
    const text = String(payload?.text ?? '');
    if (!threadId) throw badRequest('缺少 threadId');
    if (sending.has(threadId)) throw badRequest('该线程正在发送', 'send-in-progress');
    sending.add(threadId);
    try {
      if (!text.trim() && !(Array.isArray(payload.images) && payload.images.length)) throw badRequest('消息内容为空');
      const record = store.get(threadId);
      if (record.resumeSafe === false) {
        throw badRequest('上一次发送结果未确认（unsafe）：请先「刷新核对」，本面板不会自动重发', 'unsafe');
      }
      if (!runtime.isOwned(threadId)) throw badRequest('请先进入会话', 'not-owned');
      const input = [];
      if (text.trim()) input.push({ type: 'text', text, text_elements: [] });
      for (const path of payload.images ?? []) input.push({ type: 'localImage', path: String(path) });

      store.set(threadId, { resumeSafe: false, lastTurnId: null, pendingText: text, completionTurnId: null, unsafeAt: Date.now() });
      hub.push('presence/changed', { threadId, presence: presenceOf(threadId) });
      try {
        const result = await runtime.request('turn/start', { threadId, input }, 60_000);
        const turnId = result?.turn?.id ?? null;
        const completed = Boolean(turnId && store.get(threadId).completionTurnId === turnId);
        store.set(threadId, { lastTurnId: turnId, resumeSafe: completed });
        hub.push('presence/changed', { threadId, presence: presenceOf(threadId) });
        return { turnId, resumeSafe: completed };
      } catch (error) {
        throw badRequest(`发送结果不确定：${error?.message ?? error}。已保留草稿，不会自动重发；请刷新核对。`, 'unsafe-send');
      }
    } finally { sending.delete(threadId); }
  }

  async function reconcile(payload) {
    const threadId = String(payload?.threadId ?? '');
    if (!threadId) throw badRequest('缺少 threadId');
    const record = store.get(threadId);
    if (record.resumeSafe === false && record.lastTurnId) {
      let cursor = null;
      for (let page = 0; page < 5; page++) {
        const result = await runtime.request('thread/turns/list', { threadId, limit: 100, itemsView: 'summary', sortDirection: 'desc', ...(cursor ? { cursor } : {}) });
        const turn = (result?.data ?? []).find((item) => item.id === record.lastTurnId);
        if (turn) {
          if (['completed', 'failed', 'interrupted'].includes(turn.status)) store.set(threadId, { resumeSafe: true, lastStatus: turn.status });
          break;
        }
        cursor = result?.nextCursor;
        if (!cursor) break;
      }
    }
    const presence = presenceOf(threadId);
    hub.push('presence/changed', { threadId, presence });
    return presence;
  }

  async function steerTurn(payload) {
    const threadId = String(payload?.threadId ?? '');
    const text = String(payload?.text ?? '');
    if (!threadId || !text.trim()) throw badRequest('缺少 threadId 或 text');
    if (!runtime.isOwned(threadId)) throw badRequest('尚未接入该会话', 'not-owned');
    const state = hub.threadState(threadId);
    if (!state.turnId || !state.running) throw badRequest('当前没有运行中的轮次，无法插话', 'no-active-turn');
    const result = await runtime.request(
      'turn/steer',
      { threadId, expectedTurnId: state.turnId, input: [{ type: 'text', text, text_elements: [] }] },
      30_000,
    );
    return { turnId: result?.turnId ?? state.turnId };
  }

  async function interruptTurn(payload) {
    const threadId = String(payload?.threadId ?? '');
    if (!threadId) throw badRequest('缺少 threadId');
    if (!runtime.isOwned(String(payload.threadId))) throw badRequest('尚未接入该会话', 'not-owned');
    const state = hub.threadState(threadId);
    if (!state.turnId) throw badRequest('当前没有运行中的轮次', 'no-active-turn');
    await runtime.request('turn/interrupt', { threadId, turnId: state.turnId }, 30_000);
    return { turnId: state.turnId };
  }

  async function queueAdd(payload) {
    const threadId = String(payload?.threadId ?? '');
    const text = String(payload?.text ?? '');
    if (!threadId || !text.trim()) throw badRequest('缺少 threadId 或 text');
    if (!runtime.isOwned(String(payload.threadId))) throw badRequest('尚未接入该会话', 'not-owned');
    const result = await runtime.request(
      'thread/queue/add',
      {
        threadId,
        clientUserMessageId: payload.clientUserMessageId ?? randomUUID(),
        input: [{ type: 'text', text, text_elements: [] }],
      },
      30_000,
    );
    return { submission: result?.queuedSubmission ?? null };
  }

  async function queueList(payload) {
    const threadId = String(payload?.threadId ?? '');
    if (!threadId) throw badRequest('缺少 threadId');
    const result = await runtime.request('thread/queue/list', { threadId }, 30_000);
    return { data: result?.data ?? [] };
  }

  async function pollEvents(payload) {
    const threadId = payload?.threadId ? String(payload.threadId) : null;
    const timeoutMs = Math.max(0, Math.min(Number(payload?.timeoutMs ?? 15_000) || 0, 30_000));
    let since = Number(payload?.since);
    if (!Number.isFinite(since) || since < 0 || since > hub.lastSeq) since = 0;
    let events = hub.eventsSince(since, threadId);
    if (!events.length && timeoutMs > 0) {
      await hub.waitForEvent(timeoutMs);
      events = hub.eventsSince(since, threadId);
    }
    return { events, lastSeq: hub.lastSeq, pendingApprovals: approvals.snapshot(), presence: Object.fromEntries([...new Set([...hub.buffers.keys(), ...hub.turnState.keys(), ...runtime.owns.keys()])].filter(id => id !== '(global)').map(id => [id, presenceOf(id)])) };
  }

  async function presencePayload(payload) {
    const ids = Array.isArray(payload?.threadIds) ? payload.threadIds.map(String) : [...runtime.owns.keys()];
    const out = {};
    for (const id of ids) out[id] = presenceOf(id);
    return { presence: out, owned: [...runtime.owns.keys()] };
  }

  async function approvalDecide(payload) {
    const requestId = String(payload?.requestId ?? '');
    const decision = payload?.decision;
    if (!requestId || decision === undefined || decision === null) throw badRequest('缺少 requestId 或 decision');
    return approvals.decide(requestId, decision);
  }

  async function uploadImage(payload) {
    const data = String(payload?.dataBase64 ?? '');
    if (!data) throw badRequest('缺少图片数据');
    const safeName = String(payload?.name ?? 'image.png').replace(/[^\w.-]+/g, '_').slice(-64) || 'image.png';
    const dir = join(stateDir, 'uploads');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${Date.now()}-${randomUUID()}-${safeName}`);
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length > MAX_BODY_BYTES / 2) throw badRequest('图片过大（上限 4 MiB）', 'too-large');
    writeFileSync(file, buffer);
    return { path: file, name: safeName, size: buffer.length };
  }

  /* ---- lifecycle: create / rename / archive / unarchive / delete ---- */

  async function startThread(payload) {
    const cwd = String(payload?.cwd ?? '').trim();
    if (!cwd || !isAbsolute(cwd)) throw badRequest('工作目录 cwd 必须是绝对路径');
    const params = { cwd, approvalsReviewer: 'user', ephemeral: false };
    if (payload.projectId) {
      const snapshot = await navigation?.snapshot();
      const project = snapshot?.value.projects.find(project => project.id === payload.projectId && project.nativeId);
      if (!project) throw badRequest('项目不存在或当前 Codex 版本不支持此项目', 'unknown-project');
      params.projectId = project.nativeId;
    }
    if (payload.model) params.model = String(payload.model);
    if (payload.approvalPolicy) params.approvalPolicy = payload.approvalPolicy;
    if (payload.sandbox) params.sandbox = payload.sandbox;
    const result = await runtime.request('thread/start', params, 60_000);
    const threadId = result?.thread?.id;
    if (!threadId) throw badRequest('thread/start 未返回线程');
    runtime.owns.set(threadId, { resumedAt: Date.now(), model: result?.settings?.model ?? null, effort: result?.settings?.effort ?? null });
    store.set(threadId, { resumeSafe: true, owner: 'panel', createdByPanel: true });
    hub.push('presence/changed', { threadId, presence: presenceOf(threadId) });
    return { thread: mapThread(result.thread), settings: result.settings ?? null, presence: presenceOf(threadId) };
  }

  async function renameThread(payload) {
    const threadId = String(payload?.threadId ?? '');
    const nameValue = String(payload?.name ?? '').trim();
    if (!threadId || !nameValue) throw badRequest('缺少 threadId 或 name');
    await runtime.request('thread/name/set', { threadId, name: nameValue }, 30_000);
    return { threadId, name: nameValue };
  }

  async function archiveThread(payload) {
    const threadId = String(payload?.threadId ?? '');
    if (!threadId) throw badRequest('缺少 threadId');
    await runtime.request('thread/archive', { threadId }, 30_000);
    return { threadId, archived: true };
  }

  async function unarchiveThread(payload) {
    const threadId = String(payload?.threadId ?? '');
    if (!threadId) throw badRequest('缺少 threadId');
    await runtime.request('thread/unarchive', { threadId }, 30_000);
    return { threadId, archived: false };
  }

  async function deleteThread(payload) {
    const threadId = String(payload?.threadId ?? '');
    if (!threadId) throw badRequest('缺少 threadId');
    await runtime.request('thread/delete', { threadId }, 30_000);
    runtime.owns.delete(threadId);
    return { threadId, deleted: true };
  }

  return {
    health: () => runtime.snapshot(),
    restart: () => runtime.restart(),
    'release.all': releaseAll,
    list: listThreads,
    turns: listTurns,
    read: readThreadMeta,
    models: listModels,
    settings: updateSettings,
    resume: resumeThread,
    release: releaseThread,
    send: sendTurn,
    steer: steerTurn,
    interrupt: interruptTurn,
    'queue.add': queueAdd,
    'queue.list': queueList,
    events: pollEvents,
    presence: presencePayload,
    reconcile,
    'approval.decide': approvalDecide,
    'upload.image': uploadImage,
    start: startThread,
    rename: renameThread,
    archive: archiveThread,
    unarchive: unarchiveThread,
    remove: deleteThread,
  };
}
