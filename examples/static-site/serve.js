import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

/**
 * Serves this directory over HTTP on an ephemeral port (or `port`).
 * The QA Brain smoke test uses it so the browser never has to reach the internet.
 */
export function startStaticSite({ port = 0, host = '127.0.0.1' } = {}) {
  const server = createServer((req, res) => {
    const requested = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
    const file = path.join(ROOT, relative);
    // Never serve outside the example directory, even if the request tries to traverse.
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const { port: actual } = server.address();
      resolve({
        url: `http://${host}:${actual}`,
        port: actual,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const site = await startStaticSite({ port: Number(process.env.PORT ?? 0) });
  process.stdout.write(`QA Brain example site: ${site.url}\n`);
}
