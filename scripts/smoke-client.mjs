#!/usr/bin/env node
/**
 * Dev-only smoke test for the browser half, without a browser or install.
 *
 * Fakes window.__ModuleLoader__ and the two client services the plugin injects
 * (`connection.rpc`, `slots`), runs the factory, and checks that it registers:
 *   - the main panel under key "codex-panel"
 *   - the left-sidebar entry "Codex 会话" with the same id
 *
 *   node scripts/smoke-client.mjs
 */

import React from 'react';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('');
globalThis.document = dom.window.document;
const registrations = [];
const cleanups = [];
let captured = null;

globalThis.window = {
  __ModuleLoader__: {
    load(config) {
      captured = config;
    },
  },
};

await import('../lib/client.js');

if (!captured) {
  console.error('[smoke] FAIL: client module did not call window.__ModuleLoader__.load');
  process.exit(1);
}


const ctx = {
  connection: {
    rpc: {
      async call() {
        return { result: { ok: true, value: { status: 'connected', detail: '已连接', codexVersion: '0.165.0' } } };
      },
    },
  },
  slots: {
    inject(name, activate) {
      registrations.push({ kind: 'inject', name });
      return activate();
    },
    register(options, component) {
      registrations.push({ kind: 'register', ...options, component });
      return () => {};
    },
  },
  effect(fn, label) {
    registrations.push({ kind: 'effect', label });
    cleanups.push(fn());
  },
};

const exports = captured.factory((id) => {
  if (id === 'react') return React;
  throw new Error(`unexpected require(${id})`);
});

if (typeof exports.apply !== 'function') {
  console.error('[smoke] FAIL: module exports no apply()');
  process.exit(1);
}

exports.apply(ctx);

const main = registrations.find((entry) => entry.kind === 'register' && entry.name === 'main');
const sidebar = registrations.find((entry) => entry.kind === 'register' && entry.name === 'sidebar.panellist');

console.log('[smoke] registrations =', JSON.stringify(registrations.map(({ component, ...rest }) => rest), null, 2));
console.log('[smoke] inject =', JSON.stringify(exports.inject));

let failed = false;
if (exports.name !== 'dsh-mek-codex') {
  console.error('[smoke] FAIL: unexpected module name', exports.name);
  failed = true;
}
if (!main || main.key !== 'codex-panel') {
  console.error('[smoke] FAIL: main panel not registered with key codex-panel');
  failed = true;
}
if (!sidebar || sidebar.id !== 'codex-panel') {
  console.error('[smoke] FAIL: sidebar.panellist entry not registered with id codex-panel');
  failed = true;
} else if (typeof sidebar.label === 'function' && sidebar.label() !== 'Codex 会话') {
  console.error('[smoke] FAIL: sidebar label is', sidebar.label());
  failed = true;
}

// S2 pure helpers: dedupe, grouping, duplicate-basename labels, source filter.
const helpers = exports.__test ?? {};
const sample = [
  { id: 'a', title: 'A', projectId: 'project-a', cwd: '/x/proj', sourceKind: 'cli', updatedAt: 3 },
  { id: 'a', title: 'A dup', projectId: 'project-a', cwd: '/x/proj', sourceKind: 'cli', updatedAt: 2 },
  { id: 'b', title: 'B', projectId: 'project-b', cwd: '/y/proj', sourceKind: 'vscode', updatedAt: 5 },
  { id: 'c', title: 'C', projectId: 'project-a', cwd: '/x/proj', sourceKind: 'vscode', updatedAt: 4 },
];
if (typeof helpers.dedupeById !== 'function' || typeof helpers.buildSessionRows !== 'function') {
  console.error('[smoke] FAIL: __test helpers missing');
  failed = true;
} else {
  const deduped = helpers.dedupeById(sample);
  if (deduped.length !== 3) {
    console.error('[smoke] FAIL: dedupeById returned', deduped.length, 'expected 3');
    failed = true;
  }
  const navigation = { projects: [{ id: 'project-a', name: 'Project A', roots: ['/x/proj'] }, { id: 'project-b', name: 'Project B', roots: ['/y/proj'] }], sections: [] };
  const rows = helpers.buildSessionRows(deduped, { navigation });
  const groups = rows.filter((row) => row.kind === 'group');
  if (groups.length !== 2 || groups[0].projectId !== 'project-a') {
    console.error('[smoke] FAIL: group order wrong', JSON.stringify(groups));
    failed = true;
  }
  if (groups.map(group => group.label).join(',') !== 'Project A,Project B') {
    console.error('[smoke] FAIL: registered names must win over directory names', JSON.stringify(groups));
    failed = true;
  }
  const filtered = helpers.buildSessionRows(deduped, { source: 'vscode', navigation });
  if (filtered.filter((row) => row.kind === 'thread').length !== 2) {
    console.error('[smoke] FAIL: source filter wrong', JSON.stringify(filtered));
    failed = true;
  }
  console.log('[smoke] helper rows =', JSON.stringify(rows.map(({ kind, cwd, label, thread }) => ({ kind, cwd, label, id: thread?.id }))));

  // S1 bugfix: connected + detail "已连接" must not render "已连接 · 已连接".
  if (typeof helpers.statusLine === 'function') {
    const connectedLine = helpers.statusLine('connected', '已连接');
    const failedLine = helpers.statusLine('not-installed', '未找到 codex 可执行文件');
    console.log('[smoke] statusLine =', JSON.stringify({ connected: connectedLine.text, failed: failedLine.text }));
    if (connectedLine.text !== '已连接') {
      console.error('[smoke] FAIL: duplicate status text', connectedLine.text);
      failed = true;
    }
    if (failedLine.text !== '未安装 codex：未找到 codex 可执行文件') {
      console.error('[smoke] FAIL: failure detail missing', failedLine.text);
      failed = true;
    }
  } else {
    console.error('[smoke] FAIL: statusLine helper missing');
    failed = true;
  }
}

// S3–S8 pure helpers: presence three-state, approval labels, live item merge.
if (typeof helpers.presenceLabel !== 'function' || typeof helpers.decisionLabel !== 'function' || typeof helpers.mergeLiveItems !== 'function') {
  console.error('[smoke] FAIL: S3–S8 helpers missing');
  failed = true;
} else {
  const running = helpers.presenceLabel({ owned: true, running: true }, false);
  const owned = helpers.presenceLabel({ owned: true, running: false }, false);
  const occupied = helpers.presenceLabel(null, true);
  const unknown = helpers.presenceLabel(null, false);
  console.log('[smoke] presence =', JSON.stringify({ running: running.text, owned: owned.text, occupied: occupied.text, unknown: unknown.text }));
  if (running.key !== 'owned-running' || occupied.key !== 'occupied' || unknown.key !== 'unknown') {
    console.error('[smoke] FAIL: presence three-state wrong');
    failed = true;
  }

  const labels = {
    accept: helpers.decisionLabel('accept'),
    cancel: helpers.decisionLabel('cancel'),
    amend: helpers.decisionLabel({ acceptWithExecpolicyAmendment: { execpolicy_amendment: ['x'] } }),
    title: helpers.approvalTitle({ method: 'item/commandExecution/requestApproval' }),
  };
  console.log('[smoke] labels =', JSON.stringify(labels));
  if (labels.accept !== '批准' || labels.title !== '命令执行审批' || !labels.amend) {
    console.error('[smoke] FAIL: approval labels wrong');
    failed = true;
  }

  const merged = helpers.mergeLiveItems({
    items: [{ id: 'i1', type: 'agentMessage', text: 'done' }],
    deltas: { i1: 'streamed', i2: 'partial' },
    reasoning: { i3: 'thinking' },
    outputs: { i4: 'out' },
  });
  const byId = Object.fromEntries(merged.map((item) => [item.id, item]));
  console.log('[smoke] mergeLiveItems =', JSON.stringify(merged.map((item) => ({ id: item.id, type: item.type }))));
  if (byId.i1.text !== 'done' || byId.i2.text !== 'partial' || byId.i3.summary !== 'thinking') {
    console.error('[smoke] FAIL: mergeLiveItems wrong');
    failed = true;
  }
}

for (const cleanup of cleanups.reverse()) {
  try {
    cleanup?.();
  } catch (error) {
    console.warn('[smoke] cleanup failed:', error?.message ?? error);
  }
}

dom.window.close();
console.log(failed ? '[smoke] FAILED' : '[smoke] OK');
process.exitCode = failed ? 1 : 0;
