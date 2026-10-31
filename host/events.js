import { EVENT_BUFFER_PER_THREAD } from './constants.js';

export class EventHub {
  constructor() {
    this.seq = 0;
    this.buffers = new Map();
    this.waiters = new Set();
    this.turnState = new Map();
  }

  push(method, params = {}) {
    const threadId = params?.threadId ?? null;
    const event = { seq: ++this.seq, method, at: Date.now(), params };
    const key = threadId ?? '(global)';
    const buffer = this.buffers.get(key) ?? [];
    buffer.push(event);
    if (buffer.length > EVENT_BUFFER_PER_THREAD) buffer.splice(0, buffer.length - EVENT_BUFFER_PER_THREAD);
    this.buffers.set(key, buffer);

    if (threadId) {
      const state = this.turnState.get(threadId) ?? {};
      if (method === 'turn/started') {
        state.turnId = params.turn?.id ?? state.turnId ?? null;
        state.running = true;
        state.status = params.turn?.status ?? 'inProgress';
      } else if (method === 'turn/completed') {
        state.turnId = params.turn?.id ?? state.turnId ?? null;
        state.running = false;
        state.status = params.turn?.status ?? 'completed';
      } else if (method === 'thread/status/changed') {
        state.threadStatus = params.status?.type ?? null;
      }
      this.turnState.set(threadId, state);
    }
    for (const wake of [...this.waiters]) wake();
    return event;
  }

  get lastSeq() {
    return this.seq;
  }

  eventsSince(since, threadId) {
    const out = [];
    for (const [key, buffer] of this.buffers) {
      if (threadId && key !== threadId && key !== '(global)') continue;
      for (const event of buffer) if (event.seq > since) out.push(event);
    }
    return out.sort((a, b) => a.seq - b.seq);
  }

  waitForEvent(timeoutMs) {
    return new Promise((resolve) => {
      let timer;
      const wake = () => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        resolve();
      };
      timer = setTimeout(() => {
        this.waiters.delete(wake);
        resolve();
      }, Math.max(0, timeoutMs));
      this.waiters.add(wake);
    });
  }

  threadState(threadId) {
    return this.turnState.get(threadId) ?? {};
  }
}
