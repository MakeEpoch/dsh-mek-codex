import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile, copyFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createFiles } from '../host/files.js';
const root = new URL('../', import.meta.url);
const workspace = await mkdtemp(join(tmpdir(), 'mek-file-fixture-'));
await writeFile(join(workspace,'app.js'),Array.from({length:60},(_,i)=>`const value${i+1} = ${i+1};`).join('\n'));
await writeFile(join(workspace,'README.md'),'# 文件预览示例\n\n这是模拟数据。链接会在插件右侧打开。\n\n[查看代码](app.js#L12)\n');
await copyFile(new URL('docs/images/codex-desktop.png',root),join(workspace,'image.png'));
await writeFile(join(workspace,'data.bin'),Buffer.from([0,1,2,3,255]));
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 260] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>','<< /Length 68 >>\nstream\nBT /F1 18 Tf 30 150 Td (Codex file preview - mock data) Tj ET\nendstream','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
objects[3]=objects[3].replace('/Length 68','/Length '+objects[3].split('stream\n')[1].split('endstream')[0].length);
let pdf='%PDF-1.4\n';const offsets=[0];for(const [i,obj] of objects.entries()){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
const xref=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile(join(workspace,'report.pdf'),pdf);
const files=createFiles({request:async()=>({thread:{cwd:workspace}})},join(workspace,'state'));

await mkdir(new URL('artifacts/', root), { recursive: true });
await build({ absWorkingDir: root.pathname, entryPoints: ['scripts/preview-client.jsx'], bundle: true, format: 'esm', outfile: 'artifacts/preview.js', external: ['/plugin.js'], logLevel: 'warning' });
const server = createServer(async (request, response) => {
  if (request.url.startsWith('/api/dsh-mek-codex/file?')) {
    const result=await files.fetch(new Request('http://localhost'+request.url,{method:request.method,headers:request.headers}));
    response.writeHead(result.status,Object.fromEntries(result.headers));if(result.body)Readable.fromWeb(result.body).pipe(response);else response.end();return;
  }
  if (request.url==='/mock-file-preview') {
    try {let bytes='';for await(const chunk of request)bytes+=chunk;const result=await files.preview(JSON.parse(bytes));response.setHeader('content-type','application/json');response.end(JSON.stringify(result));}
    catch(error){response.writeHead(400,{'content-type':'application/json'});response.end(JSON.stringify({error:error.message}));}return;
  }
  const paths = { '/preview.js': 'artifacts/preview.js', '/plugin.js': 'lib/client.js' };
  if (paths[request.url]) {
    response.setHeader('content-type', 'text/javascript');
    response.end(await readFile(new URL(paths[request.url], root)));
  } else {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;height:100%;color-scheme:light}#root{height:calc(100% - 28px)}.banner{height:28px;background:#253959;color:white;font:12px/28px system-ui;padding-left:12px}</style><script>window.PREVIEW_WORKSPACE='+JSON.stringify(workspace)+'</script><div class="banner">开发预览 · 模拟数据</div><div id="root"></div><script type="module" src="/preview.js"></script>');
  }
});
process.on('SIGTERM',()=>server.close(async()=>{await rm(workspace,{recursive:true,force:true});process.exit();}));
server.listen(Number(process.env.PORT || 4319), '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4319 (simulated data)'));
