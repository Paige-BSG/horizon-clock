import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const base = process.argv.includes('--dist') ? path.join(root, 'dist') : root;
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex < 0 ? 5173 : process.argv[portIndex + 1]);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};
createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405);
      return res.end();
    }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const allowed = /^(index\.html|app\.js|style\.css|version\.json|(?:lib|assets)\/.+)$/.test(
      relative
    );
    const full = path.resolve(base, relative);
    if (!allowed || !full.startsWith(base + path.sep) || (await stat(full)).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    const data = await readFile(full);
    res.writeHead(200, {
      'Content-Type': types[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(port, '127.0.0.1', () => console.log(`HORIZON: http://127.0.0.1:${port}`));
