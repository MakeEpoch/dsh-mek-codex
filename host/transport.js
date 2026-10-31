import { createInterface } from 'node:readline';

export class LineTransport {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.notificationHandlers = new Set();
    this.requestHandlers = new Set();
    this.closed = false;
    this.rl = createInterface({ input: child.stdout });
    this.rl.on('line', (line) => this.onLine(line));
  }

  onLine(line) {
    const text = line.trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.id !== undefined && typeof message.method === 'string') {
      for (const handler of this.requestHandlers) {
        try {
          handler(message.id, message.method, message.params ?? {});
        } catch {
          this.respondError(message.id, -32603, 'internal error');
        }
      }
      return;
    }
    if (typeof message.method === 'string') {
      for (const handler of this.notificationHandlers) {
        try {
          handler(message.method, message.params ?? {});
        } catch {
          /* best effort */
        }
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      const error = new Error(`${message.error.code}: ${message.error.message}`);
      error.code = message.error.code;
      pending.reject(error);
    } else {
      pending.resolve(message.result);
    }
  }

  send(message) {
    if (this.closed || !this.child?.stdin?.writable) throw new Error('app-server 连接已关闭');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeoutMs = 30_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  notify(method, params) {
    this.send({ method, params });
  }

  respond(id, result) {
    this.send({ id, result });
  }

  respondError(id, code, message) {
    this.send({ id, error: { code, message } });
  }

  onNotification(handler) {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onRequest(handler) {
    this.requestHandlers.add(handler);
    return () => this.requestHandlers.delete(handler);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.rl.close();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('app-server 连接已关闭'));
    }
    this.pending.clear();
  }
}
