import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const GO_BACKEND_PORT = Number(process.env.SERVER_PORT || 8080);
const DIST_DIR = path.resolve(__dirname, 'dist');
const DATA_DIR = process.env.GILEH_DATA_DIR || path.resolve(__dirname, 'data');
const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASS = (process.env.ADMIN_PASS || 'admin1234').trim();
const MANAGERS_FILE = process.env.MANAGERS_FILE || '/etc/gileh-kord/managers.conf';

fs.mkdirSync(DATA_DIR, { recursive: true });
const SERVER_STORE_FILE = path.join(DATA_DIR, 'server_synced_store.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function readServerStore() {
  try {
    if (fs.existsSync(SERVER_STORE_FILE)) {
      return JSON.parse(fs.readFileSync(SERVER_STORE_FILE, 'utf-8'));
    }
  } catch {
    // Return empty default
  }
  return { products: [], purchases: [], suppliers: [], employees: [] };
}

function writeServerStore(data) {
  fs.writeFileSync(SERVER_STORE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function verifyManagerCredentials(username, password) {
  const cleanUser = String(username || '').trim().toLowerCase();
  const cleanPass = String(password || '').trim();
  if (!cleanUser || !cleanPass) return false;

  if (cleanUser === ADMIN_USER.toLowerCase() && cleanPass === ADMIN_PASS) {
    return true;
  }

  try {
    if (fs.existsSync(MANAGERS_FILE)) {
      const lines = fs.readFileSync(MANAGERS_FILE, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const sepIdx = trimmed.indexOf(':');
        if (sepIdx === -1) continue;
        const u = trimmed.slice(0, sepIdx).trim().toLowerCase();
        const p = trimmed.slice(sepIdx + 1).trim();
        if (u === cleanUser && p === cleanPass) {
          return true;
        }
      }
    }
  } catch {
    // Fallback to env credentials
  }

  return false;
}

function proxyToGoBackend(req, res, fallbackHandler) {
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: GO_BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers,
      timeout: 1500
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on('error', () => {
    fallbackHandler();
  });

  req.pipe(proxyReq, { end: true });
}

function collectJsonBody(req, callback) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 10 * 1024 * 1024) req.destroy();
  });
  req.on('end', () => {
    try {
      callback(null, JSON.parse(body || '{}'));
    } catch (err) {
      callback(err, null);
    }
  });
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(reqUrl.pathname);

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    collectJsonBody(req, (err, parsed) => {
      if (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Bad request' }));
        return;
      }
      const user = String(parsed.username || '').trim();
      const pass = String(parsed.password || '').trim();
      if (verifyManagerCredentials(user, pass)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, username: user }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid credentials' }));
      }
    });
    return;
  }

  if (pathname.startsWith('/api/')) {
    proxyToGoBackend(req, res, () => {
      // Built-in server persistence if Go daemon on 8080 is not running separately
      if (pathname === '/api/health' || pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            app: 'GILEH KORD',
            status: 'ok',
            dataDir: DATA_DIR,
            timestamp: new Date().toISOString()
          })
        );
        return;
      }

      if (pathname === '/api/import/backup' && req.method === 'POST') {
        collectJsonBody(req, (err, payload) => {
          if (err || !payload) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: { message: 'فایل پشتیبان نامعتبر است' } }));
            return;
          }
          const store = readServerStore();
          store.products = Array.isArray(payload.products) ? payload.products : store.products;
          store.purchases = Array.isArray(payload.purchases) ? payload.purchases : store.purchases;
          store.suppliers = Array.isArray(payload.suppliers) ? payload.suppliers : store.suppliers;
          store.employees = Array.isArray(payload.employees) ? payload.employees : store.employees;
          writeServerStore(store);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(
            JSON.stringify({
              imported: true,
              importedProducts: store.products.length,
              importedSuppliers: store.suppliers.length,
              importedEmployees: store.employees.length,
              importedPurchases: store.purchases.length
            })
          );
        });
        return;
      }

      if (pathname === '/api/products' && req.method === 'GET') {
        const store = readServerStore();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ items: store.products || [] }));
        return;
      }

      if (pathname === '/api/purchases' && req.method === 'GET') {
        const store = readServerStore();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ items: store.purchases || [] }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: 'Not Found' } }));
    });
    return;
  }

  let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexFile = path.join(DIST_DIR, 'index.html');
      fs.readFile(indexFile, (indexErr, content) => {
        if (indexErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Frontend build not found. Run "npm run build" first.');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isHashedAsset = pathname.startsWith('/assets/');

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': isHashedAsset
          ? 'public, max-age=31536000, immutable'
          : 'no-cache'
      });
      res.end(content);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`GILEH KORD server listening on http://${HOST}:${PORT}`);
});
