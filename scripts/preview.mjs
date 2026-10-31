import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
const root = new URL('../', import.meta.url);
await mkdir(new URL('artifacts/', root), { recursive: true });
await build({ absWorkingDir: root.pathname, entryPoints: ['scripts/preview-client.jsx'], bundle: true, format: 'esm', outfile: 'artifacts/preview.js', external: ['/plugin.js'], logLevel: 'warning' });
const server = createServer(async (request, response) => {
  const paths = { '/preview.js': 'artifacts/preview.js', '/plugin.js': 'lib/client.js' };
  if (paths[request.url]) {
    response.setHeader('content-type', 'text/javascript');
    response.end(await readFile(new URL(paths[request.url], root)));
  } else {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;height:100%;color-scheme:light}#root{height:calc(100% - 28px)}.banner{height:28px;background:#253959;color:white;font:12px/28px system-ui;padding-left:12px}</style><div class="banner">开发预览 · 模拟数据</div><div id="root"></div><script type="module" src="/preview.js"></script>');
  }
});
server.listen(Number(process.env.PORT || 4319), '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4319 (simulated data)'));
