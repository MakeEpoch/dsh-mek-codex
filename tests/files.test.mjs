import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFiles } from '../host/files.js';
import { parseFileLink } from '../shared/file-links.js';

test('file links distinguish URLs and support encoded paths and source positions', () => {
  assert.equal(parseFileLink('https://example.com/readme.md'), null);
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '//example.com/file', '#heading', 'file://remote/path', '/file%00.txt']) assert.equal(parseFileLink(url), null);
  assert.equal(parseFileLink('src/app.js#L12-L15').line, 12);
  assert.equal(parseFileLink('src/app.js#L12-L15').endLine, 15);
  assert.equal(parseFileLink('app.js:12:3').line, 12);
  assert.equal(parseFileLink('file:///tmp/My%20Report.md:30').path, '/tmp/My Report.md');
  assert.equal(parseFileLink('../README.md').path, '../README.md');
  assert.equal(parseFileLink('/tmp/file.pdf#page=3').page, 3);
});

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'mek-files-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const runtime = { request: async (method, params) => { assert.equal(method, 'thread/read'); assert.equal(params.threadId, 't'); return { thread: { cwd: dir } }; } };
  return { dir, files: createFiles(runtime, join(dir, 'state')) };
}

test('text and Markdown previews retain line numbers, paging, UTF-8 and nested paths', async t => {
  const { dir, files } = await setup(t);
  await mkdir(join(dir, 'docs')); await writeFile(join(dir, 'docs', '说明.md'), '# 标题\n\n中文正文');
  const md = await files.preview({ threadId: 't', href: './%E8%AF%B4%E6%98%8E.md', baseDirectory: join(dir, 'docs') });
  assert.equal(md.kind, 'markdown'); assert.match(md.text, /中文正文/);
  await writeFile(join(dir, 'app.js'), Array.from({ length: 2000 }, (_, i) => `const value${i + 1} = ${i + 1};`).join('\n'));
  const code = await files.preview({ threadId: 't', href: 'app.js#L1500-L1502' });
  assert.equal(code.line, 1500); assert.equal(code.startLine, 1470); assert.match(code.text, /const value1500/);
  const first = await files.preview({ threadId: 't', href: 'app.js' });
  assert.equal(first.truncated, true); assert.equal(first.nextLine, 1201);
  const next = await files.preview({ threadId: 't', href: 'app.js', startLine: first.nextLine });
  assert.equal(next.startLine, 1201); assert.equal(next.truncated, false);
  await writeFile(join(dir, 'empty.txt'), ''); assert.equal((await files.preview({ threadId: 't', href: 'empty.txt' })).text, '');
});

test('filesystem reads reject outside paths, escaping symlinks, directories and missing files', async t => {
  const { dir, files } = await setup(t);
  await assert.rejects(files.preview({ threadId: 't', href: '/etc/hosts' }), { code: 'outside-workspace' });
  await symlink('/etc/hosts', join(dir, 'escape.txt'));
  await assert.rejects(files.preview({ threadId: 't', href: 'escape.txt' }), { code: 'outside-workspace' });
  await assert.rejects(files.preview({ threadId: 't', href: '.' }), { code: 'not-file' });
  await assert.rejects(files.preview({ threadId: 't', href: 'missing.txt' }), { code: 'file-not-found' });
});

test('streamed downloads and PDF range requests preserve MIME, attachment and bounds', async t => {
  const { dir, files } = await setup(t);
  const pdf = '%PDF-1.4\nfixture bytes'; await writeFile(join(dir, 'report.pdf'), pdf);
  await writeFile(join(dir, 'unsafe.svg'), '<svg><script>alert(1)</script></svg>');
  await writeFile(join(dir, 'page.html'), '<script>alert(1)</script>');
  const request = (href, options = {}, download = false) => files.fetch(new Request(`http://localhost/api/dsh-mek-codex/file?${new URLSearchParams({ threadId: 't', href, ...(download ? { download: '1' } : {}) })}`, options));
  const full = await request('report.pdf'); assert.equal(full.headers.get('content-type'), 'application/pdf'); assert.equal(await full.text(), pdf);
  const partial = await request('report.pdf', { headers: { range: 'bytes=0-4' } });
  assert.equal(partial.status, 206); assert.equal(await partial.text(), '%PDF-'); assert.equal(partial.headers.get('content-range'), `bytes 0-4/${pdf.length}`);
  const suffix = await request('report.pdf', { headers: { range: 'bytes=-5' } }); assert.equal(await suffix.text(), 'bytes');
  const invalid = await request('report.pdf', { headers: { range: 'bytes=999999-' } });
  assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), `bytes */${pdf.length}`);
  const head = await request('report.pdf', { method: 'HEAD' }); assert.equal(await head.text(), '');
  const download = await request('report.pdf', {}, true); assert.match(download.headers.get('content-disposition'), /^attachment/); await download.arrayBuffer();
  const svg = await request('unsafe.svg'); assert.match(svg.headers.get('content-disposition'), /^attachment/); assert.equal(svg.headers.get('x-content-type-options'), 'nosniff'); await svg.arrayBuffer();
  const html = await request('page.html'); assert.match(html.headers.get('content-type'), /^text\/plain/); await html.arrayBuffer();
  assert.equal((await request('/etc/hosts')).status, 403);
  assert.equal((await request('absent.pdf')).status, 404);
});
