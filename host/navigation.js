import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

// Read-only projection of Codex navigation. Only registered projects are projects;
// execution directories and similar names never establish project membership.
export function desktopNavigation(state = {}, codexHome = join(homedir(), '.codex')) {
  const hostMap = state['app-server-project-id-by-legacy-project-id-by-host']?.[`local:${resolve(codexHome)}`] ?? {};
  const projectId = id => typeof id === 'string' ? hostMap[id] ?? id : null;
  const atom = state['electron-persisted-atom-state'] ?? {};
  const pinned = new Set((state['pinned-project-ids'] ?? []).map(projectId));
  const pinnedThreads = new Set(state['pinned-thread-ids'] ?? []);
  const projectless = new Set(state['projectless-thread-ids'] ?? []);
  const order = (atom['unified-sidebar-project-order-v1'] ?? state['project-order'] ?? []).map(key => projectId(key.replace(/^codex:project:/, '')));
  const accounts = Object.values(atom['sidebar-custom-sections-v3'] ?? {});
  // Never combine two accounts' sidebar layouts when the active one is unknown.
  const layout = accounts.length === 1 ? accounts[0] : null;
  const sections = (layout?.sections ?? []).map(section => ({
    id: section.hostSectionIds?.local ?? `desktop:${section.id}`,
    name: section.name,
    projectIds: (section.itemKeys ?? []).filter(key => key.startsWith('codex:project:')).map(key => projectId(key.slice('codex:project:'.length))),
  }));
  const projects = Object.values(state['local-projects'] ?? {}).filter(project => project && typeof project.id === 'string').map(project => ({
    id: projectId(project.id), nativeId: hostMap[project.id] ?? null,
    name: project.name || project.id, roots: Array.isArray(project.rootPaths) ? project.rootPaths.filter(path => typeof path === 'string') : [],
  }));
  const assignments = Object.fromEntries(Object.entries(state['thread-project-assignments'] ?? {}).filter(([, value]) => value?.projectKind === 'local' && typeof value.projectId === 'string').map(([id, value]) => [id, projectId(value.projectId)]));
  return { projects, sections, pinned, pinnedThreads, projectless, assignments, order, projectsMigrated: state['app-server-projects-migration-by-host']?.[`local:${resolve(codexHome)}`]?.projectsMigrated === true, selectedProjectId: projectId(state['selected-project']?.projectId) };
}

export function mergeNavigation(nativeProjects, nativeSections, desktop) {
  const projects = new Map((nativeProjects === null || !desktop.projectsMigrated ? desktop.projects : []).map(project => [project.id, project]));
  for (const project of nativeProjects ?? []) {
    projects.set(project.id, { id: project.id, nativeId: project.id, name: project.name, roots: (project.roots ?? []).map(root => typeof root === 'string' ? root : root.path).filter(Boolean) });
  }
  const sections = new Map(nativeSections.map(section => [section.id, { id: section.id, name: section.name, projectIds: [] }]));
  for (const section of desktop.sections) sections.set(section.id, { ...sections.get(section.id), ...section });
  const list = [...projects.values()].map((project, index) => ({ ...project,
    pinned: desktop.pinned.has(project.id),
    pinnedOrder: [...desktop.pinned].indexOf(project.id),
    sectionId: desktop.sections.find(section => section.projectIds.includes(project.id))?.id ?? null,
    order: desktop.order.includes(project.id) ? desktop.order.indexOf(project.id) : desktop.order.length + index,
  })).sort((a, b) => a.order - b.order);
  return { projects: list, sections: [...sections.values()].filter(section => section.name !== 'Pinned'), selectedProjectId: desktop.selectedProjectId };
}

export function classifyThread(thread, snapshot, desktop) {
  const explicit = typeof thread.projectId === 'string' ? thread.projectId : null;
  const id = explicit ?? (desktop.projectless.has(thread.id) ? null : desktop.assignments[thread.id] ?? null);
  const project = snapshot.projects.find(project => project.id === id);
  const pinned = desktop.pinnedThreads.has(thread.id) || thread.section?.name === 'Pinned';
  return {
    projectId: id,
    projectName: project?.name ?? null,
    projectMembership: explicit ? 'app-server' : desktop.projectless.has(thread.id) ? 'projectless' : desktop.assignments[thread.id] ? 'desktop' : 'unknown',
    pinned,
    section: pinned ? null : (thread.section ? { id: thread.section.id, name: thread.section.name } : null),
  };
}

export function createNavigation(runtime, config = {}) {
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  const file = config.globalStateFile ?? join(codexHome, '.codex-global-state.json');
  let cached; let expires = 0; let loading;
  async function load() {
    const warnings = []; let state = {};
    try {
      const text = await readFile(file, 'utf8');
      if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('too-large');
      state = JSON.parse(text);
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('invalid-state');
    } catch (error) { if (error.code !== 'ENOENT') warnings.push('桌面导航元数据暂不可读，保留未知归属'); }
    const desktop = desktopNavigation(state, codexHome);
    async function pages(method) {
      const data = []; let cursor;
      for (let page = 0; page < 20; page++) {
        const result = await runtime.request(method, { limit: 100, ...(cursor ? { cursor } : {}) });
        data.push(...(Array.isArray(result?.data) ? result.data : []));
        cursor = result?.nextCursor;
        if (!cursor) return data;
      }
      warnings.push('导航目录未全部加载'); return data;
    }
    const [projects, sections] = await Promise.allSettled([pages('project/list'), pages('threadSection/list')]);
    const nativeProjects = projects.status === 'fulfilled' ? projects.value : null;
    const nativeSections = sections.status === 'fulfilled' ? sections.value : [];
    if (projects.status === 'rejected' && !desktop.projects.length) warnings.push('项目目录不可用，聊天暂列在其他聊天中');
    const value = { ...mergeNavigation(nativeProjects, nativeSections, desktop), warnings, available: projects.status === 'fulfilled' || desktop.projects.length > 0, source: projects.status === 'fulfilled' ? 'app-server+desktop' : 'desktop' };
    return { value, classify: thread => classifyThread(thread, value, desktop) };
  }
  return {
    async snapshot() {
      if (cached && Date.now() < expires) return cached;
      if (!loading) loading = load().then(value => { cached = value; expires = Date.now() + 3000; return value; }).finally(() => { loading = null; });
      return loading;
    },
  };
}
