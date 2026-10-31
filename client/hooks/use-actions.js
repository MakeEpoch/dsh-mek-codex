import { useCallback } from 'react';

export function useActions({ client, pushNotice, setBusy, setPresence, setOccupied, setThreadRuntime, refreshList, knownCwds, setSelectedId, runtimeMap, setRuntimeMap, setHealth, setLiveByThread, setApprovals }) {
  /* ---- actions ---- */
  const refreshPresence = useCallback(
    async (threadId) => {
      try {
        const result = await client.presence({ threadIds: [threadId] });
        const value = result.presence?.[threadId];
        if (value) setPresence((previous) => ({ ...previous, [threadId]: value }));
        return value;
      } catch {
        return null;
      }
    },
    [client],
  );

  const resume = useCallback(
    async (threadId) => {
      setBusy(true);
      try {
        const result = await client.resume({ threadId });
        setPresence((previous) => ({ ...previous, [threadId]: result.presence }));
        setOccupied((previous) => ({ ...previous, [threadId]: false }));
        setThreadRuntime(threadId, { settings: result.settings ?? null, unsafe: null });
        pushNotice('已连接，可以继续聊天');
      } catch (cause) {
        if (cause?.code === 'active-writer') {
          setOccupied((previous) => ({ ...previous, [threadId]: true }));
          pushNotice('此聊天正在其他客户端中使用，请先停止或关闭那里的会话再试');
        } else {
          pushNotice(`接入失败：${cause?.message || cause}`);
        }
      } finally {
        setBusy(false);
      }
    },
    [client, pushNotice, setThreadRuntime],
  );

  const release = useCallback(
    async (threadId) => {
      try {
        const result = await client.release({ threadId });
        await refreshPresence(threadId);
        pushNotice(result.note ?? '已释放会话');
      } catch (cause) {
        pushNotice(`释放失败：${cause?.message || cause}`);
      }
    },
    [client, pushNotice, refreshPresence],
  );

  const createThread = useCallback(async (cwdValue) => {
    if (!cwdValue?.trim()) return;
    setBusy(true);
    try {
      const result = await client.start({ cwd: cwdValue.trim() });
      const threadId = result.thread?.id;
      pushNotice(`已创建会话 ${String(threadId ?? '').slice(0, 8)}…`);
      if (threadId) {
        setSelectedId(threadId);
        setPresence((previous) => ({ ...previous, [threadId]: result.presence }));
        setThreadRuntime(threadId, { settings: result.settings ?? null });
      }
      void refreshList();
      return threadId;
    } catch (cause) {
      pushNotice(`新建失败：${cause?.message || cause}`);
    } finally {
      setBusy(false);
    }
  }, [client, refreshList, knownCwds, pushNotice, setThreadRuntime]);

  const renameThread = useCallback(
    async (threadId) => {
      const nameValue = typeof window !== 'undefined' && typeof window.prompt === 'function' ? window.prompt('新的会话标题：') : null;
      if (!nameValue) return;
      try {
        await client.rename({ threadId, name: nameValue.trim() });
        pushNotice('已重命名');
        void refreshList();
      } catch (cause) {
        pushNotice(`重命名失败：${cause?.message || cause}`);
      }
    },
    [client, refreshList, pushNotice],
  );

  const archiveThread = useCallback(
    async (threadId, unarchive) => {
      try {
        await (unarchive ? client.unarchive({ threadId }) : client.archive({ threadId }));
        pushNotice(unarchive ? '已取消归档' : '已归档');
        if (!unarchive) setSelectedId(null);
        void refreshList();
      } catch (cause) {
        pushNotice(`${unarchive ? '取消归档' : '归档'}失败：${cause?.message || cause}`);
      }
    },
    [client, refreshList, pushNotice],
  );

  const deleteThread = useCallback(
    async (threadId) => {
      const ok =
        typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm('删除该会话？该操作不可撤销。')
          : true;
      if (!ok) return;
      try {
        await client.remove({ threadId });
        pushNotice('已删除会话');
        setSelectedId(null);
        void refreshList();
      } catch (cause) {
        pushNotice(`删除失败：${cause?.message || cause}`);
      }
    },
    [client, refreshList, pushNotice],
  );

  const sendMessage = useCallback(
    async (threadId, text, attachments) => {
      const value = String(text ?? '').trim();
      const files = Array.isArray(attachments) ? attachments : [];
      if (!value && !files.length) return;
      setBusy(true);
      setThreadRuntime(threadId, { pendingDraft: { text: value, images: files.map((file) => file.path) }, unsafe: null });
      try {
        await client.send({ threadId, text: value, images: files.map((file) => file.path) });
        return true;
      } catch (cause) {
        if (cause?.code === 'active-writer') {
          setOccupied((previous) => ({ ...previous, [threadId]: true }));
        }
        setThreadRuntime(threadId, { unsafe: { message: cause?.message || String(cause), code: cause?.code } });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [client, setThreadRuntime],
  );

  const steer = useCallback(
    async (threadId, text) => {
      const value = String(text ?? '').trim();
      if (!value) return;
      setBusy(true);
      try {
        await client.steer({ threadId, text: value });
        return true;
      } catch (cause) {
        pushNotice(`插话失败：${cause?.message || cause}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [client, pushNotice],
  );

  const interrupt = useCallback(
    async (threadId) => {
      setBusy(true);
      try {
        await client.interrupt({ threadId });
        pushNotice('已请求中断当前轮次');
      } catch (cause) {
        pushNotice(`中断失败：${cause?.message || cause}`);
      } finally {
        setBusy(false);
      }
    },
    [client, pushNotice],
  );

  const queueAdd = useCallback(
    async (threadId, text) => {
      const value = String(text ?? '').trim();
      if (!value) return;
      setBusy(true);
      try {
        await client.queueAdd({ threadId, text: value });
        const listed = await client.queueList({ threadId });
        setThreadRuntime(threadId, { queueCount: (listed.data ?? []).length });
        pushNotice('已加入队列');
        return true;
      } catch (cause) {
        pushNotice(`排队失败：${cause?.message || cause}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [client, pushNotice, setThreadRuntime],
  );

  const queueList = useCallback(
    async (threadId) => {
      try {
        const listed = await client.queueList({ threadId });
        setThreadRuntime(threadId, { queueCount: (listed.data ?? []).length });
        pushNotice(`队列中有 ${(listed.data ?? []).length} 条待发消息`);
      } catch (cause) {
        pushNotice(`读取队列失败：${cause?.message || cause}`);
      }
    },
    [client, pushNotice, setThreadRuntime],
  );

  const reconcile = useCallback(
    async (threadId) => {
      let value;
      try { value = await client.reconcile({ threadId }); }
      catch (error) { pushNotice(`核对失败：${error.message}`); return; }
      setPresence((previous) => ({ ...previous, [threadId]: value }));
      if (value?.resumeSafe === true) {
        setThreadRuntime(threadId, { unsafe: null });
        pushNotice('核对完成：没有未确认的发送');
      } else {
        pushNotice('仍未确认：该线程的上一轮没有终态记录，先不要重发');
      }
    },
    [client, pushNotice, setThreadRuntime],
  );

  const applySettings = useCallback(
    async (threadId, params) => {
      setBusy(true);
      try {
        await client.settings({ threadId, ...params });
        setThreadRuntime(threadId, { settings: { ...(runtimeMap[threadId]?.settings ?? {}), model: params.model ?? null, effort: params.effort ?? null } });
        pushNotice(`已更新模型设置`);
        return true;
      } catch (cause) {
        pushNotice(`设置失败：${cause?.message || cause}`);
      } finally {
        setBusy(false);
      }
    },
    [client, pushNotice, runtimeMap, setThreadRuntime],
  );

  const decide = useCallback(
    async (requestId, decision) => {
      setBusy(true);
      try {
        await client.decide({ requestId, decision });
        setApprovals((previous) => previous.filter((request) => request.requestId !== requestId));
      } catch (cause) {
        pushNotice(`审批失败：${cause?.message || cause}`);
      } finally {
        setBusy(false);
      }
    },
    [client, pushNotice],
  );

  const releaseRuntime = useCallback(async () => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const ok = window.confirm('释放运行时：会重启 codex app-server，断开所有已接入会话，把线程交还 Codex 桌面端。继续？');
      if (!ok) return;
    }
    setBusy(true);
    try {
      const result = await client.releaseAll();
      setHealth(result.snapshot ?? null);
      setPresence({});
      setOccupied({});
      setRuntimeMap({});
      setLiveByThread({});
      setApprovals([]);
      pushNotice('已释放运行时：app-server 已重启，线程交还给其他客户端');
    } catch (cause) {
      pushNotice(`释放失败：${cause?.message || cause}`);
    } finally {
      setBusy(false);
    }
  }, [client, pushNotice]);

  return { resume, release, createThread, renameThread, archiveThread, deleteThread, sendMessage, steer, interrupt, queueAdd, queueList, reconcile, applySettings, decide, releaseRuntime };
}
