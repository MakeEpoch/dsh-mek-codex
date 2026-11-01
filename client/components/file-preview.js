import React, { useEffect, useRef, useState, useContext } from 'react';
import { Markdown } from './markdown.js';
import { FileContext } from '../file-context.js';
import { parseFileLink } from '../../shared/file-links.js';
const h = React.createElement;

export function FilePreview({ client, threadId, target, onClose, width, setWidth }) {
  const [file, setFile] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0), [startLine, setStartLine] = useState(null), [mode, setMode] = useState(() => parseFileLink(target.href)?.line ? 'source' : 'preview');
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1000);
  const closeButton = useRef(null), body = useRef(null), drag = useRef(null);
  const context = useContext(FileContext);
  useEffect(() => { const resize = () => setNarrow(window.innerWidth < 1000); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  useEffect(() => { closeButton.current?.focus(); }, []);
  useEffect(() => {
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab' && narrow) {
        const nodes = [...body.current.querySelectorAll('button:not(:disabled),a[href],iframe,[tabindex="0"]')];
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [onClose, narrow]);
  useEffect(() => {
    const controller = new AbortController(); let cancelled = false;
    setLoading(true); setError(''); setFile(null);
    client.filePreview({ threadId, ...target, ...(startLine ? { startLine } : {}) }, controller.signal).then(value => { if (!cancelled) setFile(value); }).catch(cause => { if (!cancelled) setError(cause.message || String(cause)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [client, threadId, target, startLine, reload]);
  useEffect(() => {
    if (!file?.line || file.kind === 'markdown' && mode === 'preview') return;
    body.current?.querySelector(`[data-file-line="${file.line}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [file, mode]);
  const url = client.fileUrl({ threadId, ...target });
  const download = client.fileUrl({ threadId, ...target, download: '1' });
  const resize = value => setWidth(Math.max(280, Math.min(900, value, (body.current?.parentElement?.clientWidth || 1200) - 320)));
  const source = file && ['text', 'markdown'].includes(file.kind) ? h('pre', { className: 'cp-file-code' }, h('code', null, file.text.split('\n').map((text, index) => {
    const line = file.startLine + index;
    return h('span', { key: line, 'data-file-line': line, className: `cp-file-code-line${line >= file.line && line <= file.endLine ? ' cp-file-highlight' : ''}` }, h('span', { className: 'cp-file-line-number', 'aria-hidden': 'true' }, line), text || '\u200b');
  }))) : null;
  return h(React.Fragment, null,
    narrow ? h('button', { className: 'cp-file-backdrop', onClick: onClose, 'aria-label': '关闭文件预览遮罩' }) : null,
    h('aside', { ref: body, className: 'cp-file-preview', style: { width }, role: narrow ? 'dialog' : 'complementary', 'aria-modal': narrow ? true : undefined, 'aria-label': '文件预览' },
      h('div', { className: 'cp-file-resize', role: 'separator', tabIndex: narrow ? -1 : 0, 'aria-label': '调整文件预览宽度', 'aria-orientation': 'vertical', 'aria-valuemin': 280, 'aria-valuemax': 900, 'aria-valuenow': width,
        onKeyDown: event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); resize(width + (event.key === 'ArrowLeft' ? 24 : -24)); } },
        onPointerDown: event => { drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture?.(event.pointerId); },
        onPointerMove: event => { if (drag.current) resize(drag.current.width + drag.current.x - event.clientX); },
        onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; } }),
      h('header', { className: 'cp-file-header' }, h('strong', null, file?.name || '文件预览'), h('span', { className: 'cp-spacer' }),
        h('button', { className: 'cp-icon-btn', 'aria-label': '重新加载文件', onClick: () => setReload(value => value + 1) }, '↻'),
        h('a', { className: 'cp-btn', href: download, download: true }, '下载'),
        h('button', { ref: closeButton, className: 'cp-icon-btn', 'aria-label': '关闭文件预览', onClick: onClose }, '×')),
      h('div', { className: 'cp-file-path', title: file?.path || target.href }, file?.path || target.href),
      file?.kind === 'markdown' ? h('div', { className: 'cp-file-toolbar' }, h('button', { className: 'cp-btn', 'aria-pressed': mode === 'preview', onClick: () => setMode('preview') }, '预览'), h('button', { className: 'cp-btn', 'aria-pressed': mode === 'source', onClick: () => setMode('source') }, '源码')) : null,
      h('div', { className: 'cp-file-content', 'aria-busy': loading },
        loading ? h('p', { className: 'cp-file-message', role: 'status' }, '正在加载文件…') : error ? h('div', { className: 'cp-file-message', role: 'alert' }, error, h('button', { className: 'cp-btn', onClick: () => setReload(value => value + 1) }, '重试')) : file?.kind === 'image' ? h('img', { className: 'cp-file-image', src: url, alt: file.name, onError: () => setError('图片无法显示，可重新加载或下载文件。') }) : file?.kind === 'pdf' ? h('iframe', { className: 'cp-file-pdf', src: `${url}#page=${file.page || 1}`, title: file.name }) : file?.kind === 'markdown' && mode === 'preview' ? h(FileContext.Provider, { value: { ...context, baseDirectory: file.path.slice(0, file.path.lastIndexOf('/')) || '/' } }, h('div', { className: 'cp-file-markdown' }, h(Markdown, { text: file.text }))) : source || h('p', { className: 'cp-file-message' }, '此格式暂不支持预览，请下载后查看。'),
        file?.lineUnavailable ? h('p', { className: 'cp-file-message', role: 'status' }, '指定行超出当前可预览范围，可下载查看。') : null,
        file?.truncated || file?.startLine > 1 ? h('div', { className: 'cp-file-toolbar' }, h('span', null, '当前显示部分内容'), file.nextLine ? h('button', { className: 'cp-btn', onClick: () => setStartLine(file.nextLine) }, '下一页') : null, file.startLine > 1 ? h('button', { className: 'cp-btn', onClick: () => setStartLine(Math.max(1, file.startLine - 1200)) }, '上一页') : null) : null)));
}
