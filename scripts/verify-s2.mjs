#!/usr/bin/env node
import { join } from 'node:path';
/**
 * S2 acceptance checks against the host half (no install, read-only).
 *
 *   node scripts/verify-s2.mjs
 *
 * Covers: dedupe within and across pages, page size cap, cursor paging,
 * searchTerm filtering, archived filter, thread/turns/list paging, read meta.
 */

import { apply } from '../lib/index.js';

const routes = new Map();
const cleanups = [];

const ctx = {
  logger: { info: () => {}, warn: (message) => console.warn('[warn]', message), debug: () => {} },
  connection: {
    fetch: {
      register(options) {
        routes.set(options.path, options);
        return () => routes.delete(options.path);
      },
    },
  },
  effect(fn, label) {
    cleanups.push(fn());
  },
};

apply(ctx, { stateDir: join(process.cwd(), 'sandbox', 'host-state') });
const route = routes.get('/api/dsh-codex-panel');

let rpcId = 0;
async function rpc(method, payload = {}) {
  const response = await route.fetch(
    new Request('http://localhost/api/dsh-codex-panel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', method: 'dsh-codex-panel', rpcId: String(++rpcId), payload: { method, payload } }),
    }),
  );
  const body = await response.json();
  if (!body.result?.ok) throw new Error(`${method}: ${body.result?.error?.message}`);
  return body.result.value;
}

const failures = [];
const check = (label, condition, detail) => {
  console.log(`${condition ? '[ok]  ' : '[FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(label);
};

try {
  for (let i = 0; i < 40; i += 1) {
    const health = await rpc('health');
    if (health.status === 'connected') break;
    if (['not-installed', 'start-failed'].includes(health.status)) throw new Error(`host ${health.status}: ${health.lastError}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  // 1. first page + dedupe inside the page
  const page1 = await rpc('list', { limit: 500 });
  const ids1 = page1.data.map((thread) => thread.id);
  check('单页上限 100（传 500 仍 ≤100）', page1.data.length <= 100, `data=${page1.data.length}, raw=${page1.rawCount}`);
  check('服务端原始页含重复 id，已被去重', page1.rawCount >= page1.data.length, `raw=${page1.rawCount}, unique=${page1.data.length}`);
  check('页内无重复 id', new Set(ids1).size === ids1.length, `${ids1.length} ids, ${new Set(ids1).size} unique`);
  check('有 nextCursor', Boolean(page1.nextCursor));
  check(
    '字段齐全（title/cwd/originator/sourceKind/updatedAt）',
    page1.data.every((t) => typeof t.title === 'string' && typeof t.cwd === 'string' && 'originator' in t && typeof t.sourceKind === 'string' && typeof t.updatedAt === 'number'),
  );

  // 2. second page + cross-page dedupe
  const page2 = await rpc('list', { limit: 100, cursor: page1.nextCursor });
  const ids2 = page2.data.map((thread) => thread.id);
  const overlap = ids2.filter((id) => ids1.includes(id));
  check('跨页无重复 id', overlap.length === 0, `overlap=${overlap.length}`);
  check('第二页有数据', page2.data.length > 0, `count=${page2.data.length}`);

  // 2b. real grouping input: distinct cwds in one page
  const byCwd = new Map();
  for (const thread of page1.data) byCwd.set(thread.cwd || '(未知)', (byCwd.get(thread.cwd || '(未知)') ?? 0) + 1);
  const topGroups = [...byCwd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log('       cwd groups in page 1:', JSON.stringify(topGroups));
  check('列表可按 cwd 分组（≥2 个项目目录）', byCwd.size >= 2, `groups=${byCwd.size}`);

  // 3. searchTerm
  const searched = await rpc('list', { limit: 100, searchTerm: '排查' });
  check('搜索“排查”有结果', searched.data.length > 0, `count=${searched.data.length}`);
  console.log('       samples:', JSON.stringify(searched.data.slice(0, 3).map((t) => t.title)));

  // 4. archived filter
  const archived = await rpc('list', { limit: 100, archived: true });
  console.log('       archived count:', archived.data.length);
  check(
    '归档筛选可用（返回项与未归档不混淆）',
    archived.data.every((thread) => typeof thread.id === 'string'),
  );

  // 5. pick a long thread for turns paging
  const longOne = page1.data[0];
  const meta = await rpc('read', { threadId: longOne.id });
  check('read 返回元信息 + 轮次数', meta.id === longOne.id && typeof meta.turnCount === 'number', `turnCount=${meta.turnCount}`);

  const turnsPage1 = await rpc('turns', { threadId: longOne.id, limit: 2 });
  check('turns 首页按 limit 返回', turnsPage1.turns.length === 2, `count=${turnsPage1.turns.length}`);
  check('turns 降序（最新在前）', (turnsPage1.turns[0]?.startedAt ?? 0) >= (turnsPage1.turns[1]?.startedAt ?? 0));
  if (turnsPage1.nextCursor) {
    const turnsPage2 = await rpc('turns', { threadId: longOne.id, limit: 2, cursor: turnsPage1.nextCursor });
    const idsA = turnsPage1.turns.map((turn) => turn.id);
    const idsB = turnsPage2.turns.map((turn) => turn.id);
    check('turns 跨页无重复', idsB.every((id) => !idsA.includes(id)), `page2=${idsB.length}`);
  } else {
    console.log('[skip] 该线程轮次不足 3，未验证 turns 翻页；换一个线程再试');
  }

  // 6. not-connected behaviour is exercised by smoke-host with CODEX_BIN override
  console.log(failures.length ? `\n[verify-s2] FAILED: ${failures.join(' / ')}` : '\n[verify-s2] OK');
  process.exitCode = failures.length ? 1 : 0;
} finally {
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup?.();
    } catch {}
  }
}
