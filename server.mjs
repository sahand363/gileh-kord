import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
      const parsed = JSON.parse(fs.readFileSync(SERVER_STORE_FILE, 'utf-8'));
      return {
        products: Array.isArray(parsed.products) ? parsed.products : [],
        purchases: Array.isArray(parsed.purchases) ? parsed.purchases : [],
        suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
        employees: Array.isArray(parsed.employees) ? parsed.employees : [],
        revenues: Array.isArray(parsed.revenues) ? parsed.revenues : [],
        timesheets: Array.isArray(parsed.timesheets) ? parsed.timesheets : [],
        expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
        inventory: Array.isArray(parsed.inventory) ? parsed.inventory : []
      };
    }
  } catch {
    // Return empty default
  }
  return {
    products: [],
    purchases: [],
    suppliers: [],
    employees: [],
    revenues: [],
    timesheets: [],
    expenses: [],
    inventory: []
  };
}

function writeServerStore(data) {
  fs.writeFileSync(SERVER_STORE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function mergeById(existingList, incomingList) {
  const map = new Map();
  for (const item of existingList || []) {
    if (item && item.id) map.set(item.id, item);
  }
  for (const item of incomingList || []) {
    if (item && item.id) map.set(item.id, item);
  }
  return Array.from(map.values());
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

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 15 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function tryForwardToGo(req, rawBody, res, fallbackFn) {
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: GO_BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        'content-length': rawBody.length
      },
      timeout: 1200
    },
    (proxyRes) => {
      if (proxyRes.statusCode === 404) {
        proxyRes.resume();
        fallbackFn();
        return;
      }
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on('error', () => {
    fallbackFn();
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    fallbackFn();
  });

  if (rawBody.length > 0) {
    proxyReq.write(rawBody);
  }
  proxyReq.end();
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(reqUrl.pathname);

  if (pathname.startsWith('/api/')) {
    let rawBody = Buffer.alloc(0);
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        rawBody = await readRawBody(req);
      } catch {
        sendJson(res, 400, { error: { message: 'بدنه درخواست نامعتبر است' } });
        return;
      }
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const parsed = JSON.parse(rawBody.toString('utf-8') || '{}');
        const user = String(parsed.username || '').trim();
        const pass = String(parsed.password || '').trim();
        if (verifyManagerCredentials(user, pass)) {
          sendJson(res, 200, { ok: true, username: user });
        } else {
          sendJson(res, 401, { ok: false, error: 'Invalid credentials' });
        }
      } catch {
        sendJson(res, 400, { ok: false, error: 'Bad request' });
      }
      return;
    }

    tryForwardToGo(req, rawBody, res, () => {
      if (pathname === '/api/health' || pathname === '/api/status') {
        sendJson(res, 200, {
          app: 'GILEH KORD',
          status: 'ok',
          dataDir: DATA_DIR,
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (pathname === '/api/import/backup' && req.method === 'POST') {
        try {
          const payload = JSON.parse(rawBody.toString('utf-8') || '{}');
          const store = readServerStore();
          store.products = mergeById(store.products, payload.products);
          store.purchases = mergeById(store.purchases, payload.purchases);
          store.suppliers = mergeById(store.suppliers, payload.suppliers);
          store.employees = mergeById(store.employees, payload.employees);
          store.revenues = mergeById(store.revenues, payload.revenues);
          store.timesheets = mergeById(store.timesheets, payload.timesheets);
          store.expenses = mergeById(store.expenses, payload.expenses);
          store.inventory = mergeById(store.inventory, payload.inventory);
          writeServerStore(store);

          sendJson(res, 200, {
            imported: true,
            importedProducts: store.products.length,
            importedSuppliers: store.suppliers.length,
            importedEmployees: store.employees.length,
            importedPurchases: store.purchases.length
          });
        } catch {
          sendJson(res, 400, { error: { message: 'ساختار فایل پشتیبان معتبر نیست' } });
        }
        return;
      }

      if (pathname === '/api/products' && req.method === 'GET') {
        const store = readServerStore();
        sendJson(res, 200, { items: store.products });
        return;
      }

      if (pathname === '/api/purchases' && req.method === 'GET') {
        const store = readServerStore();
        sendJson(res, 200, { items: store.purchases });
        return;
      }

      if (pathname === '/api/purchases' && req.method === 'POST') {
        try {
          const input = JSON.parse(rawBody.toString('utf-8') || '{}');
          const store = readServerStore();
          const now = new Date().toISOString();
          const newPurchase = {
            id: input.id || `purch_${crypto.randomUUID()}`,
            productId: input.productId || `prod_${crypto.randomUUID()}`,
            productName: String(input.productName || '').trim(),
            quantity: Number(input.quantity) || 1,
            unit: String(input.unit || 'کیلوگرم'),
            totalAmount: Math.round(Number(input.totalAmount) || 0),
            currency: 'IRT',
            purchaseDate: String(input.purchaseDate || now.slice(0, 10)),
            employeeId: input.employeeId || undefined,
            employeeNameSnapshot: input.employeeNameSnapshot || undefined,
            supplierName: input.supplierName || undefined,
            invoiceNumber: input.invoiceNumber || undefined,
            notes: input.notes || undefined,
            isDemo: false,
            createdAt: now,
            updatedAt: now
          };
          store.purchases = mergeById(store.purchases, [newPurchase]);
          writeServerStore(store);
          sendJson(res, 201, { purchase: newPurchase, product: null });
        } catch {
          sendJson(res, 400, { error: { message: 'خطا در ثبت خرید' } });
        }
        return;
      }

      if (pathname.startsWith('/api/purchases/') && req.method === 'PUT') {
        try {
          const id = pathname.replace('/api/purchases/', '').trim();
          const input = JSON.parse(rawBody.toString('utf-8') || '{}');
          const store = readServerStore();
          const idx = store.purchases.findIndex((p) => p.id === id);
          const now = new Date().toISOString();
          const updated = {
            ...(idx >= 0 ? store.purchases[idx] : { id, createdAt: now }),
            ...input,
            id,
            updatedAt: now
          };
          store.purchases = mergeById(store.purchases, [updated]);
          writeServerStore(store);
          sendJson(res, 200, updated);
        } catch {
          sendJson(res, 400, { error: { message: 'خطا در ویرایش خرید' } });
        }
        return;
      }

      sendJson(res, 404, { error: { message: 'مسیر API یافت نشد' } });
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
