import WebSocket from 'ws';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { RpcPeer } from './transport.js';
import { CLIENT_INFO } from './constants.js';

const READ_METHODS = new Set(['thread/read', 'thread/turns/list']);

// Separate read-only connection: never resumes threads or answers approvals.
export class ReadOnlyObserver {
  constructor(config = {}) {
    this.socketPath = config.observerSocket === false ? null : config.observerSocket || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'app-server-control/app-server-control.sock');
    if (this.socketPath && !isAbsolute(this.socketPath)) throw new Error('observerSocket 必须是绝对路径');
    this.timeout = config.observerTimeoutMs ?? 1500;
    this.retryAt = 0;
    this.disposed = false;
  }

  async connect() {
    if (this.peer && !this.peer.closed) return this.peer;
    if (this.connecting) return this.connecting;
    if (this.disposed || !this.socketPath || Date.now() < this.retryAt) throw new Error('观察连接暂不可用');
    this.connecting = (async () => {
      const socket = new WebSocket(`ws+unix://${this.socketPath}:/`, { handshakeTimeout: this.timeout, maxPayload: 32 * 1024 * 1024 });
      const peer = new RpcPeer(message => socket.send(JSON.stringify(message)));
      this.socket = socket;
      socket.on('message', raw => peer.onLine(raw.toString()));
      socket.on('error', () => peer.close());
      socket.on('close', () => peer.close());
      // Unexpected server requests must not be answered on behalf of the writer.
      peer.onRequest(() => { peer.close(); socket.terminate(); });
      try {
        await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); socket.once('close', () => reject(new Error('观察连接已关闭'))); });
        await peer.request('initialize', { clientInfo: { ...CLIENT_INFO, name: `${CLIENT_INFO.name}-observer` }, capabilities: { experimentalApi: true } }, this.timeout);
        peer.notify('initialized', {});
        if (this.disposed) throw new Error('观察连接已关闭');
        this.peer = peer;
        return peer;
      } catch (error) {
        peer.close(); socket.terminate(); this.retryAt = Date.now() + 10_000;
        throw error;
      }
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async request(method, params) {
    if (!READ_METHODS.has(method)) throw new Error('观察连接只允许读取');
    try { return await (await this.connect()).request(method, params, this.timeout); }
    catch (error) { this.peer?.close(); this.socket?.terminate(); this.retryAt = Date.now() + 10_000; throw error; }
  }

  close() {
    this.disposed = true;
    this.peer?.close();
    this.socket?.terminate();
  }
}
