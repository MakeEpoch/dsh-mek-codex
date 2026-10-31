import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { desktopNavigation, mergeNavigation, classifyThread, createNavigation } from '../host/navigation.js';
import { buildSessionRows } from '../client/helpers.js';

const home = '/example/codex';
const state = {
  'local-projects': {
    a: { id: 'a', name: 'Product A', rootPaths: ['/example/shared', '/example/a'] },
    b: { id: 'b', name: 'Product B', rootPaths: ['/example/shared', '/example/b'] },
    c: { id: 'c', name: 'Work project', rootPaths: ['/example/work'] },
  },
  'app-server-project-id-by-legacy-project-id-by-host': { [`local:${home}`]: { a: 'native-a', b: 'native-b', c: 'native-c' } },
  'app-server-projects-migration-by-host': { [`local:${home}`]: { projectsMigrated: true } },
  'pinned-project-ids': ['b', 'a'],
  'pinned-thread-ids': ['pinned-thread'],
  'thread-project-assignments': { one: { projectKind: 'local', projectId: 'a' }, two: { projectKind: 'local', projectId: 'b' }, none: { projectKind: 'local', projectId: 'a' } },
  'projectless-thread-ids': ['none'],
  'electron-persisted-atom-state': {
    'unified-sidebar-project-order-v1': ['codex:project:c', 'codex:project:a', 'codex:project:b'],
    'sidebar-custom-sections-v3': { account: { sections: [{ id: 'work', name: '工作', hostSectionIds: { local: 'section-work' }, itemKeys: ['codex:project:c'] }] } },
  },
};
const desktop = desktopNavigation(state, home);
const native = desktop.projects.map(project => ({ id: project.id, name: project.name, roots: project.roots.map(path => ({ path })) }));
const snapshot = mergeNavigation(native, [{ id: 'section-work', name: '工作' }], desktop);

test('registered projects keep identity, labels, multi-root paths, pin order and custom sections', () => {
  assert.equal(snapshot.projects.length, 3);
  assert.deepEqual(snapshot.projects.find(project => project.id === 'native-a').roots, ['/example/shared','/example/a']);
  assert.equal(snapshot.projects.find(project => project.id === 'native-c').sectionId, 'section-work');
  const rows = buildSessionRows([], { navigation: snapshot });
  assert.deepEqual(rows.filter(row => row.kind === 'section').map(row => row.label), ['置顶', '工作']);
  assert.deepEqual(rows.filter(row => row.kind === 'group').map(row => row.label), ['Product B','Product A','Work project']);
});
test('shared cwd never merges different projects and explicit assignments win', () => {
  const one = classifyThread({ id: 'one', cwd: '/example/shared' }, snapshot, desktop);
  const two = classifyThread({ id: 'two', cwd: '/example/shared' }, snapshot, desktop);
  assert.equal(one.projectId,'native-a'); assert.equal(two.projectId,'native-b');
  assert.equal(classifyThread({ id: 'one', projectId: 'native-b' },snapshot,desktop).projectId, 'native-b');
});
test('cwd, descendants and similar project names never infer membership', () => {
  for (const cwd of ['/example/shared','/example/a','/example/a/subfolder','/tmp/probe/sandbox']) {
    const result = classifyThread({ id: 'unknown', cwd }, snapshot, desktop);
    assert.equal(result.projectId,null); assert.equal(result.projectMembership,'unknown');
  }
});
test('explicit projectless threads override old desktop assignments', () => {
  const result = classifyThread({ id: 'none', cwd: '/example/shared' }, snapshot, desktop);
  assert.equal(result.projectId,null); assert.equal(result.projectMembership,'projectless');
});
test('server project deletion cannot resurrect a migrated legacy project', () => {
  assert.equal(mergeNavigation([],[],desktop).projects.length,0);
  assert.equal(mergeNavigation(null,[],desktop).projects.length,3);
});
test('unknown and temporary chats stay in one group without fake directory projects', () => {
  const threads = [
    { id: 'unknown-1', cwd: '/tmp/probe/sandbox' },
    { id: 'unknown-2', cwd: '/example/shared' },
    { id: 'unknown-3', projectId: 'deleted-project', cwd: '/example/a' },
  ];
  const rows = buildSessionRows(threads,{navigation:snapshot});
  const groups = rows.filter(row => row.kind === 'group');
  assert.deepEqual(groups.map(row => row.label),['Product B','Product A','Work project','其他聊天']);
  assert.equal(groups.at(-1).defaultCollapsed,true);
  assert.equal(rows.filter(row => row.kind === 'thread').length,3);
});
test('pinning and custom section placement do not duplicate threads', () => {
  const threads = [
    { id: 'pin', pinned: true, projectId: 'native-a' },
    { id: 'custom', section:{id:'section-work',name:'工作'}, projectId:'native-b' },
    { id: 'regular', projectId:'native-a' },
  ];
  const rows = buildSessionRows(threads,{navigation:snapshot,selectedId:'custom'});
  assert.deepEqual(rows.filter(row=>row.kind==='thread').map(row=>row.thread.id).sort(),['custom','pin','regular']);
  assert.equal(rows.find(row=>row.cwd==='threads:section-work').defaultCollapsed,false);
});
test('multiple desktop accounts never merge ambiguous custom sidebar layouts', () => {
  const other = structuredClone(state);
  other['electron-persisted-atom-state']['sidebar-custom-sections-v3'].second = {sections:[{id:'foreign',name:'Other account',itemKeys:['codex:project:a']}]};
  assert.deepEqual(desktopNavigation(other,home).sections,[]);
});
test('navigation adapter only reads metadata, caches native calls, and excludes unrelated state', async t => {
  const dir=await mkdtemp(join(tmpdir(),'mek-navigation-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'state.json');const input=structuredClone(state);
  input['app-server-project-id-by-legacy-project-id-by-host'][`local:${resolve(join(homedir(),'.codex'))}`]={a:'native-a',b:'native-b',c:'native-c'};
  input['unrelated-private-data']={secret:'never-return-this'};
  await writeFile(file,JSON.stringify(input));const before=await readFile(file,'utf8');let calls=0;
  const service=createNavigation({request:async method=>{calls++;return {data:method==='project/list'?native:[]};}},{globalStateFile:file});
  const [first,second]=await Promise.all([service.snapshot(),service.snapshot()]);
  assert.equal(first,second); assert.equal(calls,2); assert.equal((await service.snapshot()),first);
  assert.equal(JSON.stringify(first.value).includes('never-return-this'),false);
  assert.equal(await readFile(file,'utf8'),before);
});

test('search with no matches leaves no empty project or section headers',()=>{
  assert.deepEqual(buildSessionRows([],{navigation:snapshot,matchesOnly:true}),[]);
});
