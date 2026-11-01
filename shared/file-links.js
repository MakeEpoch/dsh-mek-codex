export function parseFileLink(href) {
  if (typeof href !== 'string' || !href || href.startsWith('#') || href.startsWith('//')) return null;
  let value = href, page;
  if (/^file:/i.test(value)) {
    try { const url = new URL(value); if (url.hostname && url.hostname !== 'localhost') return null; value = url.pathname + url.hash; } catch { return null; }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[^/:\s]+\.[a-z\d_-]+:\d+(?::\d+)?(?:#.*)?$/i.test(value)) return null;
  let line, endLine;
  const hash = value.indexOf('#');
  if (hash >= 0) {
    const fragment = value.slice(hash + 1); value = value.slice(0, hash);
    const match = /^L?(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/i.exec(fragment);
    if (match) { line = Number(match[1]); endLine = Number(match[2] || match[1]); }
    const pdf = /^page=(\d+)$/i.exec(fragment); if (pdf) page = Number(pdf[1]);
  }
  const suffix = /:(\d+)(?::\d+)?$/.exec(value);
  if (suffix) { line ??= Number(suffix[1]); endLine ??= line; value = value.slice(0, suffix.index); }
  try { value = decodeURIComponent(value); } catch { return null; }
  if (!value || /[\0\r\n\\]/.test(value) || value.startsWith('//') || value.includes('?')) return null;
  if (line !== undefined && (!Number.isSafeInteger(line) || line < 1 || line > 1000000)) return null;
  return { path: value, line, endLine: Math.max(line || 1, Math.min(endLine || line || 1, (line || 1) + 1000)), page };
}
