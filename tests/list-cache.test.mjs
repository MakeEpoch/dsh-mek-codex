import test from 'node:test';
import assert from 'node:assert/strict';
import { createListCache } from '../client/list-cache.js';

function browser() {
  const values = new Map();
  return { location: new URL('http://example.test:3080/?token=do-not-cache'), values,
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } };
}

test('cache keeps bounded list metadata without runtime permissions or message content', () => {
  const env = browser(); const cache = createListCache(env);
  const items = Array.from({ length: 120 }, (_, i) => ({ id: `t${i}`, title: `Chat ${i}`, cwd: '/example', projectId: 'p',
    presence: { owned: true, running: true, resumeSafe: true }, preview: 'private message', turns: [{ text: 'private body' }] }));
  assert.equal(cache.write(items, { projects: [{ id: 'p', name: 'Project', roots: ['/example'], private: 'private project field' }], sections: [] }), true);
  const restored = cache.read();
  assert.equal(restored.items.length, 100);
  assert.equal(restored.items[0].title, 'Chat 0');
  assert.equal(restored.navigation.projects[0].name, 'Project');
  const [key, value] = [...env.values][0];
  assert.equal(key.includes('token'), false);
  assert.equal(value.includes('private'), false);
  assert.equal(value.includes('presence'), false);
  assert.equal(value.includes('resumeSafe'), false);
});

test('corrupt, expired, incompatible and oversized caches fall back to the server', () => {
  for (const raw of ['{', JSON.stringify({ version: 9, savedAt: Date.now(), items: [] }),
    JSON.stringify({ version: 1, savedAt: Date.now() - 8 * 86400000, items: [] }), 'x'.repeat(512 * 1024 + 1)]) {
    const env = browser(); const cache = createListCache(env); cache.write([], null);
    const key = [...env.values.keys()][0]; env.values.set(key, raw);
    assert.equal(cache.read(), null);
    assert.equal(env.values.has(key), false);
  }
});

test('unavailable or full storage cannot prevent normal network loading', () => {
  const env = browser();
  Object.defineProperty(env, 'localStorage', { get() { throw new Error('disabled'); } });
  const cache = createListCache(env);
  assert.equal(cache.read(), null); assert.equal(cache.write([], null), false);
  const full = browser(); full.localStorage.setItem = () => { throw new Error('quota'); };
  assert.equal(createListCache(full).write([], null), false);
  assert.equal(createListCache(null).read(), null);
});

test('different ports and mounts use separate snapshots while launch tokens do not', () => {
  const env = browser(); createListCache(env).write([{ id: 'a', title: 'First' }], null);
  env.location.search = '?token=another'; assert.equal(createListCache(env).read().items[0].id, 'a');
  env.location.port = '3081'; assert.equal(createListCache(env).read(), null);
  env.location.port = '3080'; env.location.pathname = '/other/'; assert.equal(createListCache(env).read(), null);
});
