import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Readable } from 'node:stream';
import { basename, extname, resolve, relative, isAbsolute, join } from 'node:path';
import { parseFileLink } from '../shared/file-links.js';
import { badRequest } from './helpers.js';

const TEXT_LIMIT = 256 * 1024;
const SCAN_LIMIT = 16 * 1024 * 1024;
const IMAGES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp' };
const inside = (root, file) => { const part = relative(root, file); return !part || !part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && part !== '..' && !isAbsolute(part); };

export function createFiles(runtime, stateDir, config = {}) {
  async function locate(payload) {
    const link = parseFileLink(payload.href);
    if (!payload.threadId || !link) throw badRequest('无效的文件链接');
    const { thread } = await runtime.request('thread/read', { threadId: String(payload.threadId), includeTurns: false });
    if (!thread?.cwd || !isAbsolute(thread.cwd)) throw badRequest('聊天没有有效工作目录');
    const roots = await Promise.all([thread.cwd, join(stateDir, 'uploads'), '/tmp', ...(Array.isArray(config.filePreviewRoots) ? config.filePreviewRoots : [])].filter(root => typeof root === 'string' && isAbsolute(root)).map(root => realpath(root).catch(() => null)));
    const path = await realpath(resolve(payload.baseDirectory || thread.cwd, link.path)).catch(error => { if (error.code === 'ENOENT') throw badRequest('文件不存在', 'file-not-found'); throw error; });
    if (!roots.some(root => root && inside(root, path))) throw badRequest('文件超出当前聊天工作目录和预览目录', 'outside-workspace');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw badRequest('只能预览普通文件', 'not-file');
      const prefix = Buffer.alloc(Math.min(info.size, 512)); await handle.read(prefix, 0, prefix.length, 0);
      const extension = extname(path).toLowerCase();
      let kind = 'binary', mime = 'application/octet-stream';
      if (extension === '.pdf' && prefix.subarray(0, 5).toString() === '%PDF-') { kind = 'pdf'; mime = 'application/pdf'; }
      else if (IMAGES[extension]) { kind = 'image'; mime = IMAGES[extension]; }
      else if (!['.svg', '.docx', '.xlsx', '.pptx', '.zip', '.gz'].includes(extension) && !prefix.includes(0)) {
        try { new TextDecoder('utf-8', { fatal: true }).decode(prefix, { stream: true }); kind = extension === '.md' || extension === '.markdown' ? 'markdown' : 'text'; mime = 'text/plain; charset=utf-8'; } catch { /* Binary or non-UTF-8: download only. */ }
      }
      return { handle, info, path, name: basename(path), extension, kind, mime, link };
    } catch (error) { await handle.close(); throw error; }
  }

  async function preview(payload) {
    const file = await locate(payload);
    try {
      const result = { path: file.path, name: file.name, size: file.info.size, kind: file.kind, extension: file.extension, line: file.link.line, endLine: file.link.endLine, page: file.link.page };
      if (!['text', 'markdown'].includes(file.kind)) return result;
      const startLine = Math.max(1, Math.floor(Number(payload.startLine) || Math.max(1, (file.link.line || 1) - 30)));
      const buffer = Buffer.alloc(Math.min(file.info.size, SCAN_LIMIT));
      const { bytesRead } = await file.handle.read(buffer, 0, buffer.length, 0);
      const bytes = buffer.subarray(0, bytesRead); let index = 0, line = 1;
      while (line < startLine && index < bytes.length) { const next = bytes.indexOf(10, index); if (next < 0) { index = bytes.length; break; } index = next + 1; line++; }
      let end = index, lines = 0;
      while (end < bytes.length && end - index < TEXT_LIMIT && lines < 1200) { const next = bytes.indexOf(10, end); if (next < 0) { end = bytes.length; break; } if (next + 1 - index > TEXT_LIMIT) break; end = next + 1; lines++; }
      if (end === index && index < bytes.length) end = Math.min(bytes.length, index + TEXT_LIMIT);
      // Do not split a UTF-8 character at the end of a preview window.
      while (end < bytes.length && end > index && (bytes[end] & 0xc0) === 0x80) end--;
      const text = bytes.subarray(index, end).toString('utf8');
      return { ...result, text, startLine: line, nextLine: end < file.info.size && end > index && bytes[end - 1] === 10 ? line + (text.match(/\n/g)?.length ?? 0) : null,
        truncated: end < file.info.size, lineUnavailable: line < startLine || index >= bytes.length && startLine > 1 };
    } finally { await file.handle.close(); }
  }

  async function fetch(request) {
    let file;
    try {
      const url = new URL(request.url); const payload = Object.fromEntries(url.searchParams);
      file = await locate(payload);
      const download = url.searchParams.get('download') === '1' || file.kind === 'binary';
      const headers = { 'content-type': file.mime, 'content-disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes' };
      let start = 0, end = file.info.size - 1, status = 200;
      const range = request.headers.get('range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || !match[1] && !match[2]) throw badRequest('无效的读取范围', 'invalid-range');
        if (!match[1]) start = Math.max(0, file.info.size - Number(match[2]));
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= file.info.size) {
          const size = file.info.size; await file.handle.close(); file = null;
          return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}`, 'cache-control': 'no-store' } });
        }
        status = 206; headers['content-range'] = `bytes ${start}-${end}/${file.info.size}`;
      }
      headers['content-length'] = String(Math.max(0, end - start + 1));
      if (request.method === 'HEAD' || !file.info.size) { await file.handle.close(); file = null; return new Response(null, { status, headers }); }
      const stream = file.handle.createReadStream({ start, end, autoClose: true }); file = null;
      return new Response(Readable.toWeb(stream), { status, headers });
    } catch (error) {
      await file?.handle.close();
      return new Response(error.code === 'outside-workspace' ? '文件超出允许的预览目录' : error.code === 'file-not-found' || error.code === 'ENOENT' ? '文件不存在' : '文件暂不可读取', { status: error.code === 'outside-workspace' ? 403 : error.code === 'file-not-found' || error.code === 'ENOENT' ? 404 : 400, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }
  }
  return { preview, fetch };
}
