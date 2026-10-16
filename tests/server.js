import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('src');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/preview' || url.pathname === '/preview/') {
      res.setHeader('Content-Type','text/html');
      res.end((await readFile(path.join(root,'index.html'),'utf8')).replace('src="./js/app.js"','src="/preview-app.js"').replaceAll('href="./','href="/'));
      return;
    }
    const previewFiles = {'/preview-app.js':'tests/preview.js','/test-bridge.js':'tests/bridge.js'};
    if (previewFiles[url.pathname]) {
      res.setHeader('Content-Type','text/javascript'); res.end(await readFile(previewFiles[url.pathname])); return;
    }
    const file = path.resolve(root, '.' + (new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : decodeURIComponent(new URL(req.url, 'http://localhost').pathname)));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
}).listen(4173,'127.0.0.1');
