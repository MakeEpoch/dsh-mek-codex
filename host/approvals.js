import { badRequest } from './helpers.js';
import { APPROVAL_TIMEOUT_MS } from './constants.js';

function normalizeAvailable(available) {
  if (!Array.isArray(available) || !available.length) return ['accept', 'acceptForSession', 'decline', 'cancel'];
  return available;
}

function decisionAllowed(available, decision) {
  if (typeof decision === 'string') {
    return available.some((entry) => entry === decision);
  }
  if (decision && typeof decision === 'object') {
    return available.some((entry) => JSON.stringify(entry) === JSON.stringify(decision));
  }
  return false;
}

function fallbackDecision(available) {
  if (available.includes('decline')) return 'decline';
  if (available.includes('cancel')) return 'cancel';
  return null;
}

export function createApprovals(runtime, hub, timeoutMs = APPROVAL_TIMEOUT_MS) {
  return {
    pending: new Map(),
    seq: 0,
    handleServerRequest(id, method, params) {
      const threadId = params?.threadId ?? null;
      if (!threadId || !runtime.isOwned(threadId)) {
        runtime.respondError(id, -32601, 'dsh-codex-panel: 拒绝非本面板会话的请求');
        hub.push('approval/refused', { method, threadId, at: Date.now(), reason: 'not-owner' });
        return;
      }
      if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method)) {
        runtime.respondError(id, -32601, `Unsupported server request: ${method}`);
        hub.push('approval/refused', { method, threadId, reason: 'unsupported-request' });
        return;
      }
      const available = normalizeAvailable(params?.availableDecisions);
      const requestId = `apr_${++this.seq}_${Date.now().toString(36)}`;
      const request = {
        requestId,
        transportId: id,
        method,
        threadId,
        turnId: params?.turnId ?? null,
        itemId: params?.itemId ?? null,
        command: params?.command ?? null,
        cwd: params?.cwd ?? null,
        changes: params?.changes ?? null,
        reason: params?.reason ?? null,
        available,
        requestedAt: Date.now(),
      };
      const timer = setTimeout(() => this.refuse(requestId, 'timeout'), timeoutMs);
      request.timer = timer;
      this.pending.set(requestId, request);
      const { timer: _ignored, transportId: _hidden, ...publicRequest } = request;
      hub.push('approval/requested', publicRequest);
    },
    decide(requestId, decision, reason = null) {
      const request = this.pending.get(requestId);
      if (!request) throw badRequest('审批请求不存在或已失效', 'unknown-approval');
      if (!decisionAllowed(request.available, decision)) {
        throw badRequest('该请求不允许此决定', 'invalid-decision');
      }
      this.pending.delete(requestId);
      clearTimeout(request.timer);
      runtime.respond(request.transportId, { decision });
      hub.push('approval/resolved', { requestId, threadId: request.threadId, decision, reason });
      return { requestId, decision };
    },
    refuse(requestId, reason) {
      const request = this.pending.get(requestId);
      if (!request) return;
      const decision = fallbackDecision(request.available);
      if (decision) return this.decide(requestId, decision, reason);
      this.pending.delete(requestId);
      clearTimeout(request.timer);
      runtime.respondError(request.transportId, -32603, 'Approval closed without a safe refusal decision');
      hub.push('approval/resolved', { requestId, threadId: request.threadId, decision: null, reason });
    },
    failAll(reason) {
      for (const requestId of [...this.pending.keys()]) this.refuse(requestId, reason);
    },
    snapshot() {
      return [...this.pending.values()].map(({ timer, transportId, ...request }) => request);
    },
  };
}
