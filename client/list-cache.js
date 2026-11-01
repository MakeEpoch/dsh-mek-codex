const VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 512 * 1024;
const MAX_THREADS = 100;

const string = value => typeof value === 'string' ? value : null;
const number = value => Number.isFinite(value) ? value : null;
const section = value => string(value?.id) ? { id: value.id, name: string(value.name) } : null;

function metadata(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter(item => {
    if (!string(item?.id) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, MAX_THREADS).map(item => ({
    id: item.id, title: string(item.title) || '(无标题)', cwd: string(item.cwd) || '',
    updatedAt: number(item.updatedAt), sourceKind: string(item.sourceKind) || 'unknown',
    projectId: string(item.projectId), projectName: string(item.projectName), projectMembership: string(item.projectMembership),
    pinned: item.pinned === true, section: section(item.section),
  }));
}

function navigationMetadata(value) {
  if (!value || !Array.isArray(value.projects) || !Array.isArray(value.sections)) return null;
  return {
    projects: value.projects.filter(project => string(project?.id)).slice(0, 500).map(project => ({
      id: project.id, nativeId: string(project.nativeId), name: string(project.name) || project.id,
      roots: (Array.isArray(project.roots) ? project.roots : []).filter(path => typeof path === 'string').slice(0, 50),
      pinned: project.pinned === true, pinnedOrder: number(project.pinnedOrder), sectionId: string(project.sectionId), order: number(project.order),
    })),
    sections: value.sections.map(section).filter(Boolean).slice(0, 100),
    selectedProjectId: string(value.selectedProjectId),
  };
}

// Origin isolates DSH servers/profiles by host and port; pathname isolates mounts.
// Never include the launch token or URL query in the storage key.
export function createListCache(browser = globalThis.window) {
  let key;
  try { key = `dsh-mek-codex:list:v${VERSION}:${browser.location.origin}${browser.location.pathname}`; }
  catch { return { read: () => null, write: () => false }; }
  return {
    read() {
      try {
        const raw = browser.localStorage.getItem(key);
        if (!raw) return null;
        if (raw.length > MAX_BYTES) throw new Error('oversize');
        const data = JSON.parse(raw);
        const age = Date.now() - data.savedAt;
        if (data.version !== VERSION || !Number.isFinite(data.savedAt) || age < 0 || age > MAX_AGE_MS || !Array.isArray(data.items)) throw new Error('invalid');
        return { items: metadata(data.items), navigation: navigationMetadata(data.navigation), savedAt: data.savedAt };
      } catch {
        try { browser.localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
        return null;
      }
    },
    write(items, navigation) {
      try {
        const value = JSON.stringify({ version: VERSION, savedAt: Date.now(), items: metadata(items), navigation: navigationMetadata(navigation) });
        if (value.length > MAX_BYTES) return false;
        browser.localStorage.setItem(key, value);
        return true;
      } catch { return false; }
    },
  };
}
