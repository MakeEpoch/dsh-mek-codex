export function badRequest(message, code = 'bad-request') {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function clampLimit(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return max;
  return Math.max(1, Math.min(Math.floor(n), max));
}

export function normalizeSource(source) {
  if (typeof source === 'string') return source;
  if (source && typeof source === 'object') {
    if (typeof source.custom === 'string') return 'custom';
    if (source.subAgent !== undefined) return 'subAgent';
  }
  return 'unknown';
}

export function mapThread(thread) {
  const preview = typeof thread?.preview === 'string' ? thread.preview : '';
  const title = (typeof thread?.name === 'string' && thread.name.trim()) || preview.split('\n')[0].slice(0, 120) || '(无标题)';
  return {
    id: thread?.id,
    title,
    preview: preview.slice(0, 500),
    cwd: thread?.cwd ?? '',
    projectId: thread?.projectId ?? null,
    section: thread?.section ?? null,
    parentThreadId: thread?.parentThreadId ?? null,
    originator: thread?.originator ?? null,
    sourceKind: normalizeSource(thread?.source),
    updatedAt: thread?.updatedAt ?? thread?.recencyAt ?? thread?.createdAt ?? null,
    createdAt: thread?.createdAt ?? null,
    status: thread?.status?.type ?? 'unknown',
  };
}
