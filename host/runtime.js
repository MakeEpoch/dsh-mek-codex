import { spawn } from 'node:child_process';
import { LineTransport } from './transport.js';
import { badRequest } from './helpers.js';
import { CLIENT_INFO, HANDSHAKE_TIMEOUT_MS, KILL_GRACE_MS, ENDPOINT } from './constants.js';

function parseCodexVersion(userAgent) {
  if (typeof userAgent !== 'string') return null;
  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(userAgent);
  return match ? match[1] : null;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function killChild(child) {
  if (!child || !child.pid) return;
  try {
    child.stdin?.end();
  } catch {
    /* gone */
  }
  try {
    child.kill('SIGTERM');
  } catch {
    /* gone */
  }
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* gone */
      }
      resolve();
    }, KILL_GRACE_MS);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export class CodexRuntime {
  constructor(ctx, config = {}, hub) {
    this.ctx = ctx;
    this.config = config;
    this.hub = hub;
    this.approvals = null;
    this.child = null;
    this.transport = null;
    this.lifecycle = Promise.resolve();
    this.owns = new Map(); // threadId -> { resumedAt, model, effort }
    this.state = {
      status: 'idle',
      detail: '尚未启动',
      codexVersion: null,
      pid: null,
      connectedAt: null,
      lastError: null,
      endpoint: ENDPOINT,
      epoch: 0,
    };
  }

  snapshot() {
    return { ...this.state, ownedThreads: [...this.owns.keys()] };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    return this.snapshot();
  }

  log(level, message) {
    const logger = this.ctx?.logger;
    const fn = logger?.[level];
    if (typeof fn === 'function') {
      try {
        fn.call(logger, `[codex-panel] ${message}`);
      } catch {
        /* logging must never break the plugin */
      }
    }
  }

  enqueue(action) {
    const operation = this.lifecycle.then(action);
    this.lifecycle = operation.catch(() => {});
    return operation;
  }

  start() { return this.enqueue(() => this.startOnce()); }
  stop(options = {}) { return this.enqueue(() => this.stopOnce(options)); }

  async startOnce() {
    if (this.child && this.state.status === 'connected') return this.snapshot();
    if (this.child) await this.stopOnce({ silent: true });

    const bin = this.config.codexBin || process.env.CODEX_BIN || 'codex';
    this.setState({ status: 'connecting', detail: `正在启动 ${bin} app-server`, lastError: null, codexVersion: null });

    let child;
    try {
      child = spawn(bin, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    } catch (error) {
      return this.setState({ status: 'start-failed', detail: `无法启动 ${bin}`, lastError: String(error.message ?? error) });
    }

    this.child = child;
    this.setState({ pid: child.pid ?? null });

    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream?.on('error', (error) => this.log('debug', `stream error: ${error?.message ?? error}`));
    }

    let spawnError = null;
    child.on('error', (error) => {
      spawnError = error;
      this.transport?.close();
      if (error?.code === 'ENOENT') {
        this.setState({ status: 'not-installed', detail: '未找到 codex 可执行文件', lastError: `ENOENT: ${bin}` });
      } else if (this.state.status !== 'connected') {
        this.setState({ status: 'start-failed', detail: 'app-server 进程启动失败', lastError: String(error?.message ?? error) });
      }
    });
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      const previous = this.state.status;
      this.transport?.close();
      this.transport = null;
      if (this.child === child) this.child = null;
      this.owns.clear();
      this.approvals?.failAll('app-server 已退出');
      if (spawnError?.code === 'ENOENT') {
        this.setState({ status: 'not-installed', detail: '未找到 codex 可执行文件', lastError: `ENOENT: ${bin}`, pid: null });
      } else if (previous === 'connected') {
        this.setState({ status: 'disconnected', detail: 'app-server 已退出', lastError: `exit code=${code} signal=${signal}`, pid: null });
      } else if (previous === 'connecting') {
        this.setState({ status: 'start-failed', detail: 'app-server 启动即退出', lastError: `exit code=${code} signal=${signal}`, pid: null });
      }
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString().trimEnd();
      if (text) this.log('debug', `stderr: ${text.split('\n').slice(-2).join(' | ')}`);
    });

    const transport = new LineTransport(child);
    this.transport = transport;
    transport.onNotification((method, params) => {
      this.hub.push(method, params);
      if (method === 'turn/completed') this.onTurnCompleted(params);
    });
    transport.onRequest((id, method, params) => {
      if (this.approvals) this.approvals.handleServerRequest(id, method, params);
      else transport.respondError(id, -32601, `dsh-codex-panel: 未就绪，拒绝 ${method}`);
    });

    try {
      const init = await withTimeout(
        transport.request('initialize', {
          clientInfo: CLIENT_INFO,
          // queue/*, settings/update and friends are gated behind the
          // experimental capability; the panel needs them (S7).
          capabilities: { experimentalApi: true, requestAttestation: false },
        }, HANDSHAKE_TIMEOUT_MS),
        HANDSHAKE_TIMEOUT_MS,
        'initialize 握手',
      );
      transport.notify('initialized', {});
      this.log('info', `connected (codex ${parseCodexVersion(init?.userAgent) ?? 'unknown'})`);
      return this.setState({
        status: 'connected',
        detail: '已连接',
        codexVersion: parseCodexVersion(init?.userAgent),
        connectedAt: Date.now(),
        lastError: null,
        epoch: this.state.epoch + 1,
      });
    } catch (error) {
      this.transport?.close();
      this.transport = null;
      await killChild(child);
      if (this.child === child) this.child = null;
      if (spawnError?.code === 'ENOENT' || this.state.status === 'not-installed') {
        return this.setState({ pid: null, lastError: `ENOENT: ${bin}` });
      }
      return this.setState({ status: 'start-failed', detail: 'initialize 握手失败', lastError: String(error?.message ?? error), pid: null });
    }
  }

  onTurnCompleted(params) {
    const threadId = params?.threadId;
    const turnId = params?.turn?.id ?? null;
    if (!threadId || !this.owns.has(threadId)) return;
    const stored = this.config.store?.get(threadId) ?? {};
    if (!turnId || stored.resumeSafe !== false) return;
    if (!stored.lastTurnId) {
      this.config.store?.set(threadId, { completionTurnId: turnId });
      return;
    }
    if (stored.lastTurnId !== turnId) return;
    this.config.store?.set(threadId, { resumeSafe: true, lastTurnId: turnId, lastStatus: params?.turn?.status ?? 'completed' });
    this.log('info', `resume_safe -> safe (${threadId} / ${turnId})`);
  }

  async stopOnce(options = {}) {
    const child = this.child;
    this.approvals?.failAll('运行时已停止');
    this.transport?.close();
    this.transport = null;
    this.child = null;
    this.hub.turnState.clear();
    this.owns.clear();
    this.approvals?.failAll('运行时已停止');
    if (child) await killChild(child);
    if (!options.silent) this.setState({ status: 'idle', detail: '已停止', pid: null, connectedAt: null });
    return this.snapshot();
  }

  /** Restart the app-server: the only way to release the writer lock. */
  async restart() {
    this.log('info', 'restart requested (releases every thread writer)');
    return this.enqueue(async () => {
      await this.stopOnce();
      return this.startOnce();
    });
  }

  async request(method, params, timeoutMs) {
    if (!this.transport || this.state.status !== 'connected') {
      throw badRequest('codex app-server 未连接', 'not-connected');
    }
    return this.transport.request(method, params, timeoutMs);
  }

  respond(id, result) {
    this.transport?.respond(id, result);
  }

  respondError(id, code, message) {
    this.transport?.respondError(id, code, message);
  }

  isOwned(threadId) {
    return this.owns.has(threadId);
  }
}
